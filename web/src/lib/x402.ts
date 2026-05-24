// Client-side x402 helper. Intercepts 402 responses from the rating API,
// pays the demanded USDC amount via the active wallet client, waits for
// confirmation, and replays the original request with x-payment-proof.
//
// Usage:
//   import { fetchWithX402 } from '@/lib/x402';
//   const res = await fetchWithX402(url, init, {
//     account, walletClient, publicClient,
//     onPayment: (hint) => setStep('paying'),
//     onPaid: (hash) => setStep('attesting'),
//   });

import type { Abi, PublicClient, WalletClient } from 'viem';
import usdcAbi from './contracts/abis/USDC.json';

export interface X402Hint {
  scheme: string;
  chainId: number;
  asset: `0x${string}`;
  amount: string; // microUSDC, as string
  decimals: number;
  recipient: `0x${string}`;
  resource: string;
  description?: string;
  maxTxAgeSeconds?: number;
}

export interface X402Context {
  account: `0x${string}`;
  walletClient: WalletClient;
  publicClient: PublicClient;
  onPayment?: (hint: X402Hint) => void;
  onPaid?: (txHash: `0x${string}`) => void;
}

export class X402Error extends Error {
  constructor(message: string, public readonly reason?: string) {
    super(message);
    this.name = 'X402Error';
  }
}

async function payHint(hint: X402Hint, ctx: X402Context): Promise<`0x${string}`> {
  ctx.onPayment?.(hint);

  const hash = await ctx.walletClient.writeContract({
    chain: ctx.walletClient.chain,
    account: ctx.account,
    address: hint.asset,
    abi: usdcAbi as Abi,
    functionName: 'transfer',
    args: [hint.recipient, BigInt(hint.amount)],
  });

  await ctx.publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
  ctx.onPaid?.(hash);
  return hash;
}

/**
 * Drop-in replacement for fetch() that handles HTTP 402 by paying the demanded
 * USDC amount and retrying with proof. Falls through to the underlying fetch
 * behavior for non-402 responses.
 *
 * Throws X402Error if:
 *   - The 402 response is malformed (no x402 hint)
 *   - The retry itself returns 402 (payment was rejected by the server)
 */
export async function fetchWithX402(
  url: string,
  init: RequestInit,
  ctx: X402Context,
): Promise<Response> {
  const first = await fetch(url, init);
  if (first.status !== 402) return first;

  const body = await first.clone().json().catch(() => null);
  const hint = body?.x402 as X402Hint | undefined;
  if (!hint || !hint.asset || !hint.recipient || !hint.amount) {
    throw new X402Error('402 response missing x402 payment hint', 'malformed_hint');
  }

  const txHash = await payHint(hint, ctx);

  const headers = new Headers(init.headers);
  headers.set('x-payment-proof', txHash);
  const second = await fetch(url, { ...init, headers });
  if (second.status === 402) {
    const retryBody = await second.json().catch(() => ({}));
    throw new X402Error(
      `payment rejected by server: ${retryBody.reason ?? 'unknown'}`,
      retryBody.reason,
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
