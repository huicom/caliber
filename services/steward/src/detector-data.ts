// DB glue for the runtime detectors (Steward Phase 1, task 16).
//
// The pure detector functions live in @caliber/steward-core; this module feeds
// them the ledger-derived numbers they compare:
//   • recentPaymentCount  — runaway-loop window count
//   • trailingMedianUsdc  — price-spike trailing median over settled rows
// Kept separate from spend.ts (policy spend counters) so the detector queries
// are easy to find.

import { sql } from '@arc-agents/db';

/**
 * How many payment intents we've sent to a host inside the trailing window. ALL
 * decisions count (allow/hold/deny) — a loop of held/denied attempts is still a
 * loop hammering the same host, and we want the breaker to trip on the pattern,
 * not only on settled money. The current (not-yet-ledgered) intent is excluded
 * by construction: this is read inside preSign, before its own row is written.
 */
export async function recentPaymentCount(host: string, windowMinutes: number): Promise<number> {
  const [{ count }] = await sql<{ count: number }[]>`
    select count(*)::int as count
    from steward_payments
    where host = ${host.toLowerCase()}
      and created_at >= now() - (${windowMinutes} || ' minutes')::interval
  `;
  return count;
}

/** A host's trailing price stats: settled-sample count + median quote. */
export interface PriceStats {
  /** Number of settled payments backing the median. */
  sampleCount: number;
  /** Trailing median settled price (decimal USDC string), or null if none. */
  medianUsdc: string | null;
}

/**
 * Trailing median price for a host over the last `window` settled payments
 * (default 20). Median via percentile_cont over settled_usdc. Returns
 * sampleCount so the caller can honor the cold-start cutoff (<5 → skip).
 */
export async function trailingPriceStats(host: string, window = 20): Promise<PriceStats> {
  const rows = await sql<{ sample_count: number; median: string | null }[]>`
    with recent as (
      select settled_usdc
      from steward_payments
      where host = ${host.toLowerCase()}
        and decision = 'allow'
        and settle_status = 'settled'
        and settled_usdc is not null
      order by created_at desc
      limit ${window}
    )
    select
      count(*)::int as sample_count,
      percentile_cont(0.5) within group (order by settled_usdc)::text as median
    from recent
  `;
  const r = rows[0];
  return {
    sampleCount: r?.sample_count ?? 0,
    medianUsdc: r?.median ?? null,
  };
}

/** Cache the freshly-computed median onto steward_counterparties (by payTo). */
export async function cachePriceMedian(payTo: string, medianUsdc: string | null): Promise<void> {
  if (medianUsdc === null) return;
  await sql`
    update steward_counterparties
    set price_median_usdc = ${medianUsdc}
    where pay_to = ${payTo.toLowerCase()}
  `;
}
