import type { Request, Response } from 'express';
import { z } from 'zod';
import { sql as rawSql } from '@arc-agents/db';
import { TIER_ORDER } from '../engine/types';

const querySchema = z.object({
  chain: z.string().min(1).default('arc'),
  days: z.coerce.number().int().min(1).max(365).default(90),
  view: z.enum(['PIT', 'TTC']).default('PIT'),
});

/**
 * GET /v1/ratings/distribution/history?chain=arc&days=90&view=PIT
 *
 * Daily tier-count rollup across the entire registry, used by the stacked
 * area chart on /stats. Returns one row per (date, tier) — the client pivots
 * into a wide shape for recharts.
 *
 * 5-minute in-memory cache to keep the query off the hot path; the snapshot
 * cron only fires daily so longer cache windows are fine, but 5 min matches
 * the existing distribution endpoint's TTL.
 */

interface CachedResult {
  computedAt: number;
  payload: unknown;
}

const cache = new Map<string, CachedResult>();
const TTL_MS = 5 * 60 * 1000;

export async function distributionHistoryRoute(req: Request, res: Response): Promise<void> {
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_query' });
    return;
  }
  const { chain, days, view } = parsed.data;

  const cacheKey = `${chain}:${days}:${view}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.computedAt < TTL_MS) {
    res.json(cached.payload);
    return;
  }

  try {
    const rows = (await rawSql.unsafe(
      `
      SELECT
        date_trunc('day', computed_at)::date::text AS day,
        tier,
        COUNT(*)::int AS count
      FROM rating_snapshots
      WHERE chain_id = $1
        AND view = $2
        AND computed_at >= NOW() - ($3 || ' days')::interval
      GROUP BY 1, 2
      ORDER BY 1, 2
      `,
      [chain, view, String(days)],
    )) as Array<{ day: string; tier: string; count: number }>;

    // Pivot to wide format for the chart: one row per day, columns per tier.
    // v2.0 tier set: Established / Proven / Emerging / Provisional / Watch /
    // Inactive (ordered from strongest to weakest for stack rendering).
    const byDay = new Map<string, Record<string, number>>();
    for (const row of rows) {
      const entry = byDay.get(row.day) ?? Object.fromEntries(TIER_ORDER.map((t) => [t, 0]));
      entry[row.tier] = row.count;
      byDay.set(row.day, entry);
    }

    const series = Array.from(byDay.entries())
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([day, counts]) => ({ date: day, ...counts }));

    const payload = {
      chain,
      view,
      days,
      tiers: TIER_ORDER,
      series,
    };

    cache.set(cacheKey, { computedAt: Date.now(), payload });
    res.json(payload);
  } catch (err) {
    console.error('Distribution history error:', err);
    res.status(500).json({
      error: 'internal_error',
      message: err instanceof Error ? err.message : 'Unknown error',
    });
  }
}
