import type { Request, Response } from 'express';
import { z } from 'zod';
import { rateAgent } from '../engine/rating';
import type { RatingResult } from '../engine/types';

const bodySchema = z.object({
  chain: z.string().min(1),
  ids: z.array(z.string().regex(/^\d+$/)).min(1).max(100),
});

const querySchema = z.object({
  chain: z.string().min(1),
  ids: z.string().regex(/^[\d,]+$/),
});

interface BulkSummary {
  agent_id: string;
  rated: boolean;
  rating?: string;
  ppd_30d?: number;
  confidence?: 'high' | 'medium' | 'low';
  reason?: string;
  interactions?: number;
}

function summarize(result: RatingResult): BulkSummary {
  if (!result.rated) {
    return {
      agent_id: result.agent_id,
      rated: false,
      reason: result.reason,
      interactions: result.interactions,
    };
  }
  return {
    agent_id: result.agent_id,
    rated: true,
    rating: result.rating,
    ppd_30d: result.ppd_30d,
    confidence: result.confidence,
    interactions: result.factors.interaction_count,
  };
}

/**
 * GET ?chain=arc&ids=1,2,3   |   POST { chain, ids: [...] }
 * Up to 100 agents per request. The web app uses this to bulk-rate a page
 * of agents in one round-trip.
 */
export async function bulkRatingsRoute(req: Request, res: Response): Promise<void> {
  let chain: string;
  let ids: string[];

  if (req.method === 'GET') {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({
        error: 'invalid_query',
        message: 'Required: ?chain=<arc|base>&ids=1,2,3',
      });
      return;
    }
    chain = parsed.data.chain;
    ids = parsed.data.ids.split(',').filter(Boolean);
  } else {
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'invalid_body',
        message: parsed.error.issues.map((i) => i.message).join('; '),
      });
      return;
    }
    chain = parsed.data.chain;
    ids = parsed.data.ids;
  }

  if (ids.length > 100) {
    res.status(400).json({ error: 'too_many_ids', message: 'Max 100 ids per request' });
    return;
  }

  try {
    const results = await Promise.all(
      ids.map(async (id) => {
        try {
          const result = await rateAgent(BigInt(id), chain, 'PIT');
          return summarize(result);
        } catch {
          return {
            agent_id: id,
            rated: false,
            reason: 'engine_error',
            interactions: 0,
          } as BulkSummary;
        }
      }),
    );
    res.json({ chain, count: results.length, ratings: results });
  } catch (err) {
    res.status(500).json({
      error: 'internal_error',
      message: err instanceof Error ? err.message : 'Unknown error',
    });
  }
}
