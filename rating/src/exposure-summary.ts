import type { Request, Response } from 'express';
import { z } from 'zod';
import { sql as rawSql } from '@arc-agents/db';

const querySchema = z.object({
  chain: z.string().min(1).default('arc'),
});

/**
 * GET /v1/ratings/exposure-summary?chain=arc
 *
 * Aggregates today's PIT snapshots into a registry-wide exposure view:
 *  - total_ead_usdc — sum of every rated agent's currently-funded escrow
 *  - total_el_usdc  — sum of PD × LGD × EAD across all rated agents
 *  - by_tier        — per-tier breakdown (agent count + EAD + EL)
 *
 * Source is the most recent calendar-day batch of snapshots so the number
 * matches the trajectory + distribution charts. Cached 5 minutes; the
 * snapshot cron only fires daily so longer cache windows are fine but
 * 5 min matches the other rating endpoints.
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
    // Pull the per-tier roll-up from the freshest snapshot day. The ead_usdc
    // column stores a stringified decimal; NULLIF + CAST handles empties.
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
        COALESCE(SUM(CAST(NULLIF(ead_usdc, '') AS NUMERIC)), 0)::text AS total_ead,
        COALESCE(
          SUM(
            CAST(NULLIF(ead_usdc, '') AS NUMERIC)
            * COALESCE(ppd_30d, 0)
            * COALESCE(lgd, 0)
          ),
          0
        )::text AS total_el
      FROM rating_snapshots, latest_day
      WHERE rating_snapshots.chain_id = $1
        AND rating_snapshots.view = 'PIT'
        AND DATE(rating_snapshots.computed_at) = latest_day.d
      GROUP BY tier
      ORDER BY tier
      `,
      [chain],
    )) as Array<{ tier: string; agent_count: number; total_ead: string; total_el: string }>;

    const computedAtRow = (await rawSql.unsafe(
      `SELECT MAX(computed_at)::text AS computed_at FROM rating_snapshots WHERE chain_id = $1 AND view = 'PIT'`,
      [chain],
    )) as Array<{ computed_at: string | null }>;

    let totalAgents = 0;
    let totalEadNum = 0;
    let totalElNum = 0;
    for (const r of rows) {
      totalAgents += r.agent_count;
      totalEadNum += Number(r.total_ead);
      totalElNum += Number(r.total_el);
    }

    const payload = {
      chain,
      computed_at: computedAtRow[0]?.computed_at ?? null,
      total_agents: totalAgents,
      total_ead_usdc: totalEadNum.toFixed(2),
      total_el_usdc: totalElNum.toFixed(2),
      by_tier: rows.map((r) => ({
        tier: r.tier,
        agent_count: r.agent_count,
        ead_usdc: Number(r.total_ead).toFixed(2),
        el_usdc: Number(r.total_el).toFixed(2),
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
