import type { Request, Response } from 'express';
import { z } from 'zod';
import { sql as rawSql } from '@arc-agents/db';

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
    // Per-tier roll-up from the freshest snapshot day. `ead_usdc` in the
    // schema is now semantically "active escrow USDC" — column name kept
    // stable so older clients don't break, but the methodology meaning
    // changed at v2.0 (it no longer feeds an EL formula).
    const rows = (await rawSql.unsafe(
      `
      WITH latest_day AS (
        SELECT MAX(DATE(computed_at)) AS d
        FROM rating_snapshots
        WHERE chain_id = $1 AND view = 'PIT'
      )
      SELECT
        tier,
        COUNT(*)::int AS agent_count,
        COALESCE(SUM(CAST(NULLIF(ead_usdc, '') AS NUMERIC)), 0)::text AS active_escrow
      FROM rating_snapshots, latest_day
      WHERE rating_snapshots.chain_id = $1
        AND rating_snapshots.view = 'PIT'
        AND DATE(rating_snapshots.computed_at) = latest_day.d
      GROUP BY tier
      ORDER BY tier
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
      methodology_version: '2.0.0',
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
