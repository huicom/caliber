import type { Request, Response } from 'express';
import { db, agents } from '@arc-agents/db';
import { eq, and, gt } from 'drizzle-orm';
import { rateAgent } from '../engine/rating';
import { TIER_ORDER, type CaliberTier } from '../engine/types';

interface DistributionResponse {
  chain: string;
  computed_at: string;
  total_agents: number;
  rateable_agents: number;
  unrated: {
    insufficient_interactions: number;
    insufficient_history: number;
    other: number;
  };
  by_tier: Record<CaliberTier, number>;
  by_confidence: { high: number; moderate: number; low: number; insufficient: number };
  by_flag_count: { zero: number; one: number; two_or_more: number };
  /** Mean composite score across all rated agents (sanity indicator). */
  mean_score: number;
}

interface CacheEntry {
  data: DistributionResponse;
  expires: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min

async function computeDistribution(chain: string): Promise<DistributionResponse> {
  // Filter on cheap DB-side signals first to avoid running the engine on
  // 14k+ rows pointlessly. The engine still has the final ≥5/≥14d call.
  const candidates = await db
    .select({ agentId: agents.agentId })
    .from(agents)
    .where(and(eq(agents.chainId, chain), gt(agents.registeredAtBlock, 0n)));

  const total_agents = candidates.length;
  const tier_counts: Record<CaliberTier, number> = {
    Established: 0,
    Proven: 0,
    Emerging: 0,
    Provisional: 0,
    Watch: 0,
    Inactive: 0,
  };
  let rateable_agents = 0;
  let conf_high = 0;
  let conf_moderate = 0;
  let conf_low = 0;
  let conf_insufficient = 0;
  let flag_zero = 0;
  let flag_one = 0;
  let flag_multi = 0;
  let unrated_insufficient_interactions = 0;
  let unrated_insufficient_history = 0;
  let unrated_other = 0;
  let score_sum = 0;

  const BATCH_SIZE = 25;
  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    const batch = candidates.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map((c) =>
        rateAgent(c.agentId, chain, 'PIT').catch(
          () => null as null | Awaited<ReturnType<typeof rateAgent>>,
        ),
      ),
    );
    for (const r of results) {
      if (!r) {
        unrated_other++;
        continue;
      }
      if (!r.rated) {
        if (r.reason === 'insufficient_interactions') unrated_insufficient_interactions++;
        else if (r.reason === 'insufficient_history') unrated_insufficient_history++;
        else unrated_other++;
        continue;
      }
      rateable_agents++;
      tier_counts[r.tier] = (tier_counts[r.tier] ?? 0) + 1;
      if (r.confidence === 'high') conf_high++;
      else if (r.confidence === 'moderate') conf_moderate++;
      else if (r.confidence === 'low') conf_low++;
      else conf_insufficient++;
      if (r.flags.length === 0) flag_zero++;
      else if (r.flags.length === 1) flag_one++;
      else flag_multi++;
      score_sum += r.score;
    }
  }

  // Sanity: ensure all tier keys are present even if zero
  for (const t of TIER_ORDER) {
    if (tier_counts[t] === undefined) tier_counts[t] = 0;
  }

  return {
    chain,
    computed_at: new Date().toISOString(),
    total_agents,
    rateable_agents,
    unrated: {
      insufficient_interactions: unrated_insufficient_interactions,
      insufficient_history: unrated_insufficient_history,
      other: unrated_other,
    },
    by_tier: tier_counts,
    by_confidence: {
      high: conf_high,
      moderate: conf_moderate,
      low: conf_low,
      insufficient: conf_insufficient,
    },
    by_flag_count: {
      zero: flag_zero,
      one: flag_one,
      two_or_more: flag_multi,
    },
    mean_score: rateable_agents > 0 ? score_sum / rateable_agents : 0,
  };
}

export async function distributionRoute(req: Request, res: Response): Promise<void> {
  const chain = typeof req.query.chain === 'string' ? req.query.chain : 'arc';
  if (!['arc', 'base'].includes(chain)) {
    res.status(400).json({ error: 'invalid_chain', message: 'chain must be arc or base' });
    return;
  }

  const now = Date.now();
  const cached = cache.get(chain);
  if (cached && cached.expires > now) {
    res.setHeader('X-Cache', 'hit');
    res.json(cached.data);
    return;
  }

  try {
    const data = await computeDistribution(chain);
    cache.set(chain, { data, expires: now + CACHE_TTL_MS });
    res.setHeader('X-Cache', 'miss');
    res.json(data);
  } catch (err) {
    res.status(500).json({
      error: 'internal_error',
      message: err instanceof Error ? err.message : 'Unknown error',
    });
  }
}
