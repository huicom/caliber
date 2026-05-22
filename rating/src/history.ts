import type { Request, Response } from 'express';
import { z } from 'zod';
import { db, ratingSnapshots } from '@arc-agents/db';
import { and, eq, gte, asc } from 'drizzle-orm';

const paramsSchema = z.object({
  chain: z.string().min(1),
  id: z.string().regex(/^\d+$/, 'Agent ID must be numeric'),
});

const querySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(180),
  view: z.enum(['PIT', 'TTC', 'all']).default('all'),
});

/**
 * GET /v1/agents/:chain/:id/rating/history?days=180&view=all
 *
 * Returns the agent's daily rating snapshots over the requested window. Used
 * by the trajectory chart on /agents/[id]. PIT and TTC rows interleave when
 * both exist; the client decides whether to render TTC as a dashed overlay.
 */
export async function ratingHistoryRoute(req: Request, res: Response): Promise<void> {
  const paramsResult = paramsSchema.safeParse(req.params);
  if (!paramsResult.success) {
    res.status(400).json({ error: 'invalid_params' });
    return;
  }

  const queryResult = querySchema.safeParse(req.query);
  if (!queryResult.success) {
    res.status(400).json({ error: 'invalid_query' });
    return;
  }

  const { chain, id } = paramsResult.data;
  const { days, view } = queryResult.data;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  try {
    const conditions = [
      eq(ratingSnapshots.chainId, chain),
      eq(ratingSnapshots.agentId, BigInt(id)),
      gte(ratingSnapshots.computedAt, since),
    ];
    if (view !== 'all') {
      conditions.push(eq(ratingSnapshots.view, view));
    }

    const rows = await db
      .select({
        computedAt: ratingSnapshots.computedAt,
        tier: ratingSnapshots.tier,
        ppd30d: ratingSnapshots.ppd30d,
        lgd: ratingSnapshots.lgd,
        eadUsdc: ratingSnapshots.eadUsdc,
        confidence: ratingSnapshots.confidence,
        view: ratingSnapshots.view,
        methodologyVersion: ratingSnapshots.methodologyVersion,
        interactionCount: ratingSnapshots.interactionCount,
      })
      .from(ratingSnapshots)
      .where(and(...conditions))
      .orderBy(asc(ratingSnapshots.computedAt));

    // Caliber v2.0 column reuse (per WaveM Stage B notes in snapshot-daily.ts):
    //   ppd_30d  storage column → carries `completion_rate_smoothed`
    //   lgd      storage column → carries `forward_success`
    //   ead_usdc storage column → carries `active_escrow_usdc`
    // The API response uses the v2.0 names so external consumers see the
    // current semantics. A column-rename migration is a follow-up.
    res.json({
      chain,
      agent_id: id,
      days,
      view,
      count: rows.length,
      history: rows.map((r) => ({
        date: r.computedAt.toISOString(),
        tier: r.tier,
        completion_rate_smoothed: r.ppd30d ? Number(r.ppd30d) : null,
        forward_success: r.lgd ? Number(r.lgd) : null,
        active_escrow_usdc: r.eadUsdc,
        confidence: r.confidence,
        view: r.view,
        methodology_version: r.methodologyVersion,
        interaction_count: r.interactionCount,
      })),
    });
  } catch (err) {
    console.error('History query error:', err);
    res.status(500).json({
      error: 'internal_error',
      message: err instanceof Error ? err.message : 'Unknown error',
    });
  }
}
