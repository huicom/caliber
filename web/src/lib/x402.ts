// Client-side x402 helper for Circle Gateway batched-settlement payments.
//
// Migrated from the homegrown on-chain-USDC-transfer variant to Circle's
// official @circle-fin/x402-batching/client SDK. The flow:
//
//   1. Caller hits the protected endpoint (no payment headers).
//   2. Server (createGatewayMiddleware) returns 402 with payment requirements
//      encoded as JSON — networks, asset, amount, payTo, scheme, etc.
//   3. We pick the Arc Testnet requirement, hand it to BatchEvmScheme which
//      signs an EIP-3009 TransferWithAuthorization (off-chain, NO gas, NO
//      on-chain tx) against the GatewayWallet contract.
//   4. We retry with X-PAYMENT: <base64 of signed payload>.
//   5. Server forwards the payload to Circle's facilitator for verification
//      and queues the payment for batched settlement to the Seller Wallet's
//      Gateway Balance. Resource flows back to the caller.
//
// Funding note: callers must have a Gateway Balance — fund via either the
// Circle CLI (`circle gateway deposit`) or programmatically via
// GatewayClient.deposit. The Caliber funder wallet's drip currently funds
// the user's USDC balance, not Gateway balance — a v2 follow-up.

import type { Abi, WalletClient } from 'viem';
import { BatchEvmScheme } from '@circle-fin/x402-batching/client';
import type { BatchEvmSigner } from '@circle-fin/x402-batching';
import {
  encodePaymentSignatureHeader,
  decodePaymentRequiredHeader,
} from '@x402/core/http';
import usdcAbi from './contracts/abis/USDC.json';

void usdcAbi; // referenced by future helpers (deposit flow)

export interface X402Hint {
  scheme: string;
  chainId: number;
  asset: `0x${string}`;
  amount: string;
  decimals: number;
  recipient: `0x${string}`;
  resource: string;
  description?: string;
  maxTxAgeSeconds?: number;
}

export interface X402Context {
  account: `0x${string}`;
  walletClient: WalletClient;
  publicClient: unknown;
  onPayment?: (hint: X402Hint) => void;
  onPaid?: (txHash: `0x${string}`) => void;
}

export class X402Error extends Error {
  constructor(
    message: string,
    public readonly reason?: string,
  ) {
    super(message);
    this.name = 'X402Error';
  }
}

interface PaymentRequirement {
  scheme: string;
  network: string;
  asset: string;
  amount: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra?: Record<string, unknown>;
}

interface PaymentRequiredResponse {
  x402Version: number;
  accepts: PaymentRequirement[];
  error?: string;
}

/**
 * Wraps wagmi's walletClient as a BatchEvmSigner so the Circle SDK can sign
 * EIP-3009 TransferWithAuthorization on the user's behalf without us
 * touching their private key.
 */
function makeBatchSigner(account: `0x${string}`, walletClient: WalletClient): BatchEvmSigner {
  return {
    address: account,
    async signTypedData(params) {
      // viem's signTypedData expects { account, ... }; the SDK's signature is
      // missing it, so we inject the connected account.
      return walletClient.signTypedData({
        account,
        domain: params.domain,
        types: params.types,
        primaryType: params.primaryType,
        message: params.message,
      });
    },
  };
}

/**
 * Drop-in fetch replacement that handles HTTP 402 by signing an EIP-3009
 * TransferWithAuthorization (Circle Gateway batched payment) and retrying
 * with the X-PAYMENT header. Falls through for non-402 responses.
 */
export async function fetchWithX402(
  url: string,
  init: RequestInit,
  ctx: X402Context,
): Promise<Response> {
  const first = await fetch(url, init);
  if (first.status !== 402) return first;

  // Circle Gateway encodes the payment requirements in the
  // `payment-required` header (base64 JSON), not the body. Fall back to
  // the body shape too in case a non-Circle facilitator is ever wired in.
  const headerValueRaw = first.headers.get('payment-required');
  let body: PaymentRequiredResponse | null = null;
  if (headerValueRaw) {
    try {
      body = decodePaymentRequiredHeader(headerValueRaw) as unknown as PaymentRequiredResponse;
    } catch {
      throw new X402Error('failed to decode payment-required header', 'header_decode_failed');
    }
  } else {
    body = (await first.clone().json().catch(() => null)) as PaymentRequiredResponse | null;
  }
  if (!body?.accepts || body.accepts.length === 0) {
    throw new X402Error('402 response missing accepts[] payment requirements', 'malformed_402');
  }
  // Pick the cheapest accept (Circle Gateway typically returns one).
  const requirement = body.accepts[0]!;

  // Build a hint object for the UI (mirrors our old X402Hint shape).
  const decimals = 6; // Circle Gateway USDC = 6 decimals on every supported chain
  const hint: X402Hint = {
    scheme: requirement.scheme,
    chainId: Number(requirement.network.split(':')[1] ?? '0'),
    asset: requirement.asset as `0x${string}`,
    amount: requirement.amount,
    decimals,
    recipient: requirement.payTo as `0x${string}`,
    resource: url,
    description: 'Caliber signed rating attestation (Circle Gateway)',
  };
  ctx.onPayment?.(hint);

  // Sign the EIP-3009 authorization via Circle's BatchEvmScheme.
  const signer = makeBatchSigner(ctx.account, ctx.walletClient);
  const scheme = new BatchEvmScheme(signer);
  const payload = await scheme.createPaymentPayload(body.x402Version, requirement);

  // Encode for the X-PAYMENT header (base64 JSON). The PaymentPayload shape
  // expected by encodePaymentSignatureHeader is the @x402/core full type;
  // BatchEvmScheme returns the subset { x402Version, payload } and the
  // header encoder fills in the rest from the requirement.
  const headerValue = encodePaymentSignatureHeader({
    x402Version: body.x402Version,
    scheme: requirement.scheme,
    network: requirement.network,
    payload: payload.payload,
  } as unknown as Parameters<typeof encodePaymentSignatureHeader>[0]);

  // The signed authorization itself isn't an on-chain tx — Circle settles
  // in batches — so there's no txHash to report at this stage. Fire onPaid
  // with a sentinel "signed" pseudo-hash so the UI moves forward.
  ctx.onPaid?.('0xsigned' as `0x${string}`);

  const headers = new Headers(init.headers);
  headers.set('X-PAYMENT', headerValue);
  const second = await fetch(url, { ...init, headers });
  if (second.status === 402) {
    const retryBody = await second.json().catch(() => ({}));
    throw new X402Error(
      `Circle Gateway rejected signed payment: ${retryBody.error ?? 'unknown'}`,
      retryBody.error,
    );
  }
  return second;
}

/** Format microUSDC amount to "0.001 USDC" for display. */
export function formatX402Price(hint: X402Hint): string {
  const amount = BigInt(hint.amount);
  let denom = BigInt(1);
  for (let i = 0; i < hint.decimals; i++) denom = denom * BigInt(10);
  const whole = amount / denom;
  const frac = amount % denom;
  if (frac === BigInt(0)) return `${whole.toString()} USDC`;
  const fracStr = frac.toString().padStart(hint.decimals, '0').replace(/0+$/, '');
  return `${whole.toString()}.${fracStr} USDC`;
}
