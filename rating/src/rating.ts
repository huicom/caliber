import type { Request, Response } from 'express';
import { z } from 'zod';
import { rateAgent } from '../engine/rating';
import type { RatingView } from '../engine/types';

const paramsSchema = z.object({
  chain: z.string().min(1),
  id: z.string().regex(/^\d+$/, 'Agent ID must be numeric'),
});

const querySchema = z.object({
  view: z.enum(['PIT', 'TTC']).optional().default('PIT'),
});

/**
 * GET /v1/agents/:chain/:id/rating
 * Returns the live rating for an ERC-8004 agent, computed on-demand by the
 * Caliber engine. Always includes methodology_version so consumers can pin
 * to a known scorecard release.
 */
export async function ratingRoute(req: Request, res: Response): Promise<void> {
  const params = paramsSchema.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({
      error: 'invalid_params',
      message: params.error.issues.map((i) => i.message).join('; '),
    });
    return;
  }
  const query = querySchema.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: 'invalid_query', message: 'view must be PIT or TTC' });
    return;
  }

  try {
    const result = await rateAgent(
      BigInt(params.data.id),
      params.data.chain,
      query.data.view as RatingView,
    );
    res.json(result);
  } catch (err) {
    res.status(500).json({
      error: 'internal_error',
      message: err instanceof Error ? err.message : 'Unknown error',
    });
  }
}
