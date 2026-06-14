// OFAC SDN screening — the impure on-chain read (Steward Phase 1, brief §5 step 5).
//
// Screens a seller's payTo against the free, keyless Chainalysis on-chain
// sanctions oracle: `isSanctioned(address) returns (bool)` deployed at a fixed
// address on Ethereum MAINNET. Sanctions status is address-based and
// chain-agnostic, so we screen on mainnet regardless of the fact that Steward's
// payments settle on Arc. No API key, no registration — the oracle is published
// "for anyone to use".
//
// Honest labeling, everywhere: exact-match screening against the published
// sanctions list. NOT "KYT", NOT "compliance", NOT a "compliant" determination.
//
// The pure parts (the source label, cache-freshness logic) live in
// @caliber/steward-core; only the viem call + DB cache live here.

import { createPublicClient, http, getAddress, type Address } from 'viem';
import { mainnet } from 'viem/chains';
import { sql } from '@arc-agents/db';
import { SDN_SOURCE, isSdnCacheFresh, type SdnResult } from '@caliber/steward-core';

/** Thrown when the SDN oracle could not be reached (RPC down / timeout). The
 *  pipeline must NOT swallow this — it fails closed (holds the payment). */
export class SdnError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'SdnError';
  }
}

/** The minimal ABI for the oracle's single read method. */
const SANCTIONS_ABI = [
  {
    type: 'function',
    name: 'isSanctioned',
    stateMutability: 'view',
    inputs: [{ name: 'addr', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

/** Hard ceiling on the oracle round-trip before we give up and fail closed. */
const RPC_TIMEOUT_MS = 5000;

function oracleAddress(): Address {
  const raw = process.env.SDN_ORACLE_ADDRESS?.trim();
  if (!raw) throw new SdnError('SDN_ORACLE_ADDRESS not set — cannot perform OFAC SDN screening');
  try {
    return getAddress(raw);
  } catch {
    throw new SdnError(`SDN_ORACLE_ADDRESS is not a valid address: ${raw}`);
  }
}

function oracleRpc(): string {
  const raw = process.env.SDN_ORACLE_RPC?.trim();
  if (!raw) throw new SdnError('SDN_ORACLE_RPC not set — cannot perform OFAC SDN screening');
  return raw;
}

/**
 * In-process memo (short-lived) layered ON TOP of the 24h DB cache. Keyed by the
 * lowercased address. Bounded by the DB cache TTL — entries here are still
 * subject to the same freshness check, so a stale memo is ignored.
 */
const memo = new Map<string, SdnResult>();

/** Read the 24h cache from steward_counterparties (by payTo). Null on miss/stale. */
async function readCache(payTo: string): Promise<SdnResult | null> {
  const lc = payTo.toLowerCase();
  const memoed = memo.get(lc);
  if (memoed && isSdnCacheFresh(memoed.checkedAt)) return memoed;

  const rows = await sql<{ sdn_result: SdnResult | null; sdn_checked_at: string | null }[]>`
    select sdn_result, sdn_checked_at
    from steward_counterparties
    where pay_to = ${lc}
    limit 1
  `;
  const r = rows[0];
  if (!r || !r.sdn_result || !isSdnCacheFresh(r.sdn_checked_at)) return null;
  // Normalize the persisted result so callers always get the canonical shape.
  const result: SdnResult = {
    sanctioned: !!r.sdn_result.sanctioned,
    source: r.sdn_result.source ?? SDN_SOURCE,
    checkedAt: r.sdn_checked_at ?? r.sdn_result.checkedAt,
  };
  memo.set(lc, result);
  return result;
}

/** Persist a fresh screen onto the counterparty cache (upsert by payTo). */
async function writeCache(payTo: string, result: SdnResult): Promise<void> {
  const lc = payTo.toLowerCase();
  memo.set(lc, result);
  const json = JSON.stringify(result);
  // Insert a bare row if the counterparty isn't registered yet (SDN screening
  // runs on the payTo of a quote we may never have transacted with before), or
  // update the cache columns if it already exists. Does NOT mark registered/
  // trusted — that's the TOFU/approval path's job.
  await sql`
    insert into steward_counterparties (pay_to, host, registered, sdn_result, sdn_checked_at)
    values (${lc}, '', false, ${json}::jsonb, ${result.checkedAt})
    on conflict (pay_to) do update set
      sdn_result = ${json}::jsonb,
      sdn_checked_at = ${result.checkedAt}
  `;
}

/**
 * Screen `payTo` against the OFAC SDN list via the Chainalysis on-chain oracle.
 *
 * Reads the 24h cache first; on a miss or stale entry it calls the oracle (with
 * a hard {@link RPC_TIMEOUT_MS} timeout) and writes the result back. Throws
 * {@link SdnError} on any RPC failure / timeout — callers MUST fail closed
 * (hold the payment), never swallow it.
 */
export async function screenSdn(payTo: string): Promise<SdnResult> {
  const cached = await readCache(payTo).catch(() => null);
  if (cached) return cached;

  const address = oracleAddress();
  const rpc = oracleRpc();

  let normalized: Address;
  try {
    normalized = getAddress(payTo);
  } catch {
    throw new SdnError(`payTo is not a valid address: ${payTo}`);
  }

  const client = createPublicClient({
    chain: mainnet,
    transport: http(rpc, { timeout: RPC_TIMEOUT_MS, retryCount: 1 }),
  });

  let sanctioned: boolean;
  try {
    const onchain = await Promise.race([
      client.readContract({
        address,
        abi: SANCTIONS_ABI,
        functionName: 'isSanctioned',
        args: [normalized],
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new SdnError(`SDN oracle timed out after ${RPC_TIMEOUT_MS}ms`)), RPC_TIMEOUT_MS),
      ),
    ]);
    sanctioned = onchain as boolean;
  } catch (err) {
    if (err instanceof SdnError) throw err;
    throw new SdnError(
      `OFAC SDN oracle read failed: ${err instanceof Error ? err.message : String(err)}`,
      err,
    );
  }

  const result: SdnResult = {
    sanctioned,
    source: SDN_SOURCE,
    checkedAt: new Date().toISOString(),
  };
  // Cache best-effort: a write failure must not turn a successful screen into a
  // hold, so swallow it (the next call simply re-screens).
  await writeCache(payTo, result).catch((e) =>
    console.error('[steward] SDN cache write failed (non-fatal):', e),
  );
  return result;
}
