// x402 paywall middleware for Caliber attestation endpoints.
//
// Flow:
//   1. Client POSTs without proof. Server returns 402 + payment hint.
//   2. Client transfers USDC to recipient, retries with x-payment-proof: 0x<txhash>.
//   3. Middleware fetches the tx via Arc RPC, validates the USDC.Transfer log
//      (to, amount, recency), records the hash in a replay-prevention set,
//      and calls next(). The downstream attest route returns the signed envelope.
//
// Demo defaults:
//   X402_PRICE_USDC_MICROS  =  1000          (= 0.001 USDC per attestation)
//   X402_RECIPIENT           =  signer addr   (paying back into infra wallet)
//   X402_MAX_TX_AGE_SECONDS  =  300          (5 min tx-confirmation window)
//
// Replay protection is in-memory only — restart of arc-rating.service clears
// the set. Fine for the hackathon; revisit if x402 ships to production.

import type { Request, Response, NextFunction } from 'express';
import { createPublicClient, http, parseAbiItem, getAddress } from 'viem';
import { defineChain } from 'viem';
import { getSigner } from './sign-utils';

const ARC_CHAIN_ID = 5042002;
const USDC_CONTRACT = (process.env.USDC_CONTRACT ||
  '0x3600000000000000000000000000000000000000') as `0x${string}`;

// systemd's EnvironmentFile= doesn't strip inline `# comment` like dotenv
// does, so we defensively parse the leading integer out of each env var.
// Prevents a crash-loop when a `.env` line is "X402_FOO=1000  # comment".
function intFromEnv(raw: string | undefined, fallback: string): string {
  const candidate = (raw ?? '').trim().match(/^\d+/)?.[0];
  return candidate && candidate.length > 0 ? candidate : fallback;
}
const PRICE_MICROS = BigInt(intFromEnv(process.env.X402_PRICE_USDC_MICROS, '1000'));
const MAX_TX_AGE_SECONDS = Number(intFromEnv(process.env.X402_MAX_TX_AGE_SECONDS, '300'));

function getRecipient(): `0x${string}` {
  const fromEnv = process.env.X402_RECIPIENT;
  if (fromEnv) return getAddress(fromEnv);
  // Default to the signer address — fees flow back into the infra wallet.
  return getSigner().address;
}

const arcChain = defineChain({
  id: ARC_CHAIN_ID,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [process.env.ARC_RPC_URL || ''] } },
});

let _client: ReturnType<typeof createPublicClient> | null = null;
function getRpcClient() {
  if (!_client) {
    _client = createPublicClient({ chain: arcChain, transport: http() });
  }
  return _client;
}

// In-memory replay-prevention. One Set per process; lost on restart.
const usedProofs = new Set<string>();

const TRANSFER_EVENT = parseAbiItem(
  'event Transfer(address indexed from, address indexed to, uint256 value)',
);

function paymentHint(req: Request): Record<string, unknown> {
  return {
    scheme: 'evm-transfer',
    chainId: ARC_CHAIN_ID,
    asset: USDC_CONTRACT,
    amount: PRICE_MICROS.toString(),
    decimals: 6,
    recipient: getRecipient(),
    resource: `${req.method} ${req.originalUrl}`,
    description: 'Caliber signed rating attestation',
    maxTxAgeSeconds: MAX_TX_AGE_SECONDS,
  };
}

async function verifyProof(txHash: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    return { ok: false, reason: 'malformed_tx_hash' };
  }
  if (usedProofs.has(txHash.toLowerCase())) {
    return { ok: false, reason: 'proof_already_used' };
  }
  const client = getRpcClient();
  const hash = txHash as `0x${string}`;

  const [receipt, currentBlock] = await Promise.all([
    client.getTransactionReceipt({ hash }).catch(() => null),
    client.getBlockNumber(),
  ]);
  if (!receipt) return { ok: false, reason: 'tx_not_found' };
  if (receipt.status !== 'success') return { ok: false, reason: 'tx_reverted' };

  const block = await client.getBlock({ blockNumber: receipt.blockNumber });
  const ageSeconds = Math.floor(Date.now() / 1000) - Number(block.timestamp);
  if (ageSeconds > MAX_TX_AGE_SECONDS) {
    return { ok: false, reason: 'tx_too_old' };
  }
  if (Number(currentBlock - receipt.blockNumber) < 0) {
    return { ok: false, reason: 'tx_in_future_block' };
  }

  // Find a USDC.Transfer(to=recipient, value>=price) log in this tx.
  const recipient = getRecipient().toLowerCase();
  const usdc = USDC_CONTRACT.toLowerCase();
  let satisfied = false;
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== usdc) continue;
    try {
      // Topic[0] is the event sig; topic[1] = from, topic[2] = to (padded).
      if (log.topics.length < 3) continue;
      const toTopic = log.topics[2]!.toLowerCase();
      if (!toTopic.endsWith(recipient.slice(2))) continue;
      const value = BigInt(log.data);
      if (value >= PRICE_MICROS) {
        satisfied = true;
        break;
      }
    } catch {
      continue;
    }
  }
  if (!satisfied) return { ok: false, reason: 'no_matching_usdc_transfer' };

  usedProofs.add(txHash.toLowerCase());
  return { ok: true };
}

export async function x402Middleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (req.method === 'OPTIONS') {
    next();
    return;
  }

  // Server-to-server bypass for trusted infrastructure (Circle demo path,
  // Caliber Sentinel, etc.) Shared secret deliberately not echoed in 402
  // hints. Falls through to the normal payment flow when unset/wrong.
  const bypass = req.headers['x-x402-bypass'];
  const expected = process.env.X402_BYPASS_TOKEN;
  if (expected && typeof bypass === 'string' && bypass === expected) {
    next();
    return;
  }

  const proof = req.headers['x-payment-proof'];
  if (!proof || typeof proof !== 'string') {
    res.status(402).json({
      error: 'payment_required',
      x402: paymentHint(req),
    });
    return;
  }

  const result = await verifyProof(proof);
  if (!result.ok) {
    res.status(402).json({
      error: 'payment_invalid',
      reason: result.reason,
      x402: paymentHint(req),
    });
    return;
  }

  // Echo the accepted proof so clients can correlate logs.
  res.setHeader('x-payment-accepted', proof);
  next();
}
