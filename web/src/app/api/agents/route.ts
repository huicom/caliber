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
  sort: z.enum(['recent', 'reputation', 'earned', 'jobs']).default('recent'),
  search: z.string().optional(),
  minReputation: z.coerce.number().min(0).max(100).optional(),
  validated: z.enum(['true', 'false']).optional(),
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
