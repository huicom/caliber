import { db, agents } from '@/lib/db';
import { count, desc, asc, and, ilike, or, sql as drizzleSql } from 'drizzle-orm';
import { z } from 'zod';
import {
  ok,
  badRequest,
  serverError,
  parseQuery,
  paginationSchema,
} from '@/lib/api-helpers';

export const dynamic = 'force-dynamic';

const schema = paginationSchema.extend({
  // Override the paginationSchema limit cap so a tier-filter view can fetch
  // the full rateable set (~860 agents) in one round-trip — client-side tier
  // filters need the full dataset to work, since the server has no rating
  // column to filter on.
  limit: z.coerce.number().int().min(1).max(1000).default(20),
  sort: z.enum(['recent', 'reputation', 'earned', 'jobs', 'rating']).default('rating'),
  search: z.string().optional(),
  minReputation: z.coerce.number().min(0).max(100).optional(),
  validated: z.enum(['true', 'false']).optional(),
  // When true, restrict to agents that *could* be rated by the rating engine
  // — i.e. ones whose interaction count plausibly clears the §1.5 minimum
  // (≥5). We approximate "interactions" as feedback_count + jobs_completed
  // since validation counts are joined separately and aren't in this row.
  ratedOnly: z.enum(['true', 'false']).optional(),
});

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const parsed = parseQuery(url, schema);
    if (!parsed.ok) return badRequest(parsed.error);
    const q = parsed.data;

    const whereParts = [];
    if (q.search) {
      const pattern = `%${q.search}%`;
      whereParts.push(
        or(
          ilike(agents.name, pattern),
          ilike(agents.ownerAddress, pattern),
          drizzleSql`agent_id::text ILIKE ${pattern}`,
        ),
      );
    }
    if (q.minReputation !== undefined) {
      whereParts.push(drizzleSql`reputation_score >= ${q.minReputation}`);
    }
    if (q.validated === 'true') {
      whereParts.push(drizzleSql`validation_status = 'PASSED'`);
    }
    if (q.ratedOnly === 'true') {
      // Match the /stats panel exactly: an agent is "rated" iff the daily
      // snapshot job wrote a v2.0.1 rating for them. The earlier legacy
      // heuristic (feedback + jobs + validations ≥ 5) used the v1 minimum-
      // interactions floor and excluded testnet-calibration agents with
      // only 1-2 jobs (Bronze min 1, Gold/Silver min 2).
      whereParts.push(
        drizzleSql`EXISTS (
          SELECT 1 FROM rating_snapshots
          WHERE agent_id = agents.agent_id
            AND chain_id = agents.chain_id
            AND view = 'PIT'
        )`,
      );
    }

    const whereClause = whereParts.length > 0 ? and(...whereParts) : undefined;

    let orderBy;
    switch (q.sort) {
      case 'reputation':
        orderBy = desc(agents.reputationScore);
        break;
      case 'earned':
        orderBy = desc(agents.usdcEarned);
        break;
      case 'jobs':
        orderBy = desc(agents.jobsCompleted);
        break;
      case 'rating':
        // No precomputed rating column — sort by total interaction count
        // (feedback + jobs) so the most-rateable agents bubble up. The
        // client then re-sorts the visible page by Arc-tier.
        orderBy = desc(
          drizzleSql`(COALESCE(feedback_count, 0) + COALESCE(jobs_completed, 0))`,
        );
        break;
      case 'recent':
      default:
        orderBy = desc(agents.registeredAtBlock);
    }

    const [rows, totalRow] = await Promise.all([
      db
        .select({
          agentId: agents.agentId,
          ownerAddress: agents.ownerAddress,
          name: agents.name,
          agentType: agents.agentType,
          capabilities: agents.capabilities,
          reputationScore: agents.reputationScore,
          feedbackCount: agents.feedbackCount,
          validationStatus: agents.validationStatus,
          jobsCompleted: agents.jobsCompleted,
          usdcEarned: agents.usdcEarned,
          registeredAtBlock: agents.registeredAtBlock,
        })
        .from(agents)
        .where(whereClause)
        .orderBy(orderBy)
        .limit(q.limit)
        .offset(q.offset),
      db
        .select({ count: count() })
        .from(agents)
        .where(whereClause),
    ]);

    return ok({
      agents: rows,
      total: Number(totalRow[0]?.count ?? 0),
      limit: q.limit,
      offset: q.offset,
    });
  } catch (err) {
    return serverError('Failed to list agents', err);
  }
}
