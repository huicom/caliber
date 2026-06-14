// OFAC SDN screening — pure helpers (Steward Phase 1, brief §5 step 5).
//
// The actual on-chain read (Chainalysis sanctions oracle `isSanctioned`) is an
// IMPURE network call that lives in services/steward/src/sdn.ts. This module
// holds only the pure logic: the constant honest label, and the cache-freshness
// decision (is a cached result still good, or must we re-screen the oracle?).
//
// Honest labeling, everywhere: this is exact-match screening against the
// published sanctions list via the Chainalysis on-chain oracle. It is NOT "KYT",
// NOT "compliance", NOT a "compliant" determination. Keep the words honest.

/** The single source-of-record string stamped on every SDN screen. */
export const SDN_SOURCE = 'Chainalysis on-chain sanctions oracle (OFAC SDN)';

/** Default cache TTL: a cached SDN result is reused for 24h before re-screening. */
export const SDN_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** A persisted SDN screen result (mirrors steward_payments.sdn_result jsonb). */
export interface SdnResult {
  /** True iff the oracle reported the address on a sanctions list. */
  sanctioned: boolean;
  /** Provenance — always SDN_SOURCE. */
  source: string;
  /** ISO timestamp the screen was performed. */
  checkedAt: string;
}

/**
 * Decide whether a cached SDN result is still fresh enough to reuse, given the
 * timestamp it was checked at and "now". A null/absent timestamp or a parse
 * failure is treated as stale (force a re-screen — fail toward checking, never
 * toward trusting a missing cache).
 */
export function isSdnCacheFresh(
  checkedAt: Date | string | null | undefined,
  now: number = Date.now(),
  ttlMs: number = SDN_CACHE_TTL_MS,
): boolean {
  if (!checkedAt) return false;
  const t = checkedAt instanceof Date ? checkedAt.getTime() : Date.parse(checkedAt);
  if (!Number.isFinite(t)) return false;
  return now - t < ttlMs;
}
