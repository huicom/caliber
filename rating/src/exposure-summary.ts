import type { Request, Response } from 'express';
import { z } from 'zod';
import { sql as rawSql } from '@arc-agents/db';
import { METHODOLOGY_VERSION } from '../engine/version';

const querySchema = z.object({
  chain: z.string().min(1).default('arc'),
});

/**
 * GET /v1/ratings/exposure-summary?chain=arc
 *
 * Caliber Rating v2.0 — registry-wide active escrow view.
 *
 * Returns:
 *  - total_active_escrow_usdc — sum of every rated agent's currently-funded
 *    in-flight escrow (the on-chain truth of USDC at stake).
 *  - by_tier — per-tier breakdown: agent count + active escrow under each
 *    tier. The EL (expected loss) framing from v1 is intentionally dropped:
 *    Caliber Rating v2.0 publishes a tier and a score, not a probability
 *    of default, so there's no defensible EL number to multiply by.
 *
 * Cached 5 minutes.
 */

interface CachedResult {
  computedAt: number;
  payload: unknown;
}

const cache = new Map<string, CachedResult>();
const TTL_MS = 5 * 60 * 1000;

export async function exposureSummaryRoute(req: Request, res: Response): Promise<void> {
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_query' });
    return;
  }
  const { chain } = parsed.data;

  const cached = cache.get(chain);
  if (cached && Date.now() - cached.computedAt < TTL_MS) {
    res.json(cached.payload);
    return;
  }

  try {
    // Per-tier roll-up from the LATEST snapshot per agent. Using DISTINCT ON
    // is critical: rating_snapshots is append-only, so an agent rated on day
    // N under tier X and re-rated on day N+1 under tier Y must be counted
    // only as Y. The previous query grouped by date and double-counted
    // agents who had multiple snapshots on the same day (e.g. when
    // snapshot:daily was run twice for a methodology rename).
    // `ead_usdc` is now semantically "active escrow USDC" — column name
    // kept stable for backwards compat.
    const rows = (await rawSql.unsafe(
      `
      WITH latest AS (
        SELECT DISTINCT ON (agent_id) agent_id, tier, ead_usdc
        FROM rating_snapshots
        WHERE chain_id = $1 AND view = 'PIT'
        ORDER BY agent_id, computed_at DESC
      )
      SELECT
        tier,
        COUNT(*)::int AS agent_count,
        COALESCE(SUM(CAST(NULLIF(ead_usdc, '') AS NUMERIC)), 0)::text AS active_escrow
      FROM latest
      GROUP BY tier
      ORDER BY
        CASE tier
          WHEN 'Gold' THEN 0 WHEN 'Silver' THEN 1 WHEN 'Bronze' THEN 2
          WHEN 'Pending' THEN 3 WHEN 'Watch' THEN 4 WHEN 'Dormant' THEN 5
          ELSE 9
        END
      `,
      [chain],
    )) as Array<{ tier: string; agent_count: number; active_escrow: string }>;

    const computedAtRow = (await rawSql.unsafe(
      `SELECT MAX(computed_at)::text AS computed_at FROM rating_snapshots WHERE chain_id = $1 AND view = 'PIT'`,
      [chain],
    )) as Array<{ computed_at: string | null }>;

    let totalAgents = 0;
    let totalEscrow = 0;
    for (const r of rows) {
      totalAgents += r.agent_count;
      totalEscrow += Number(r.active_escrow);
    }

    const payload = {
      chain,
      methodology_version: METHODOLOGY_VERSION,
      computed_at: computedAtRow[0]?.computed_at ?? null,
      total_agents: totalAgents,
      total_active_escrow_usdc: totalEscrow.toFixed(2),
      by_tier: rows.map((r) => ({
        tier: r.tier,
        agent_count: r.agent_count,
        active_escrow_usdc: Number(r.active_escrow).toFixed(2),
      })),
    };

    cache.set(chain, { computedAt: Date.now(), payload });
    res.json(payload);
  } catch (err) {
    console.error('Exposure summary error:', err);
    res.status(500).json({
      error: 'internal_error',
      message: err instanceof Error ? err.message : 'Unknown error',
    });
  }
}
