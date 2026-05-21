import { db, jobs, jobDrafts } from '@/lib/db';
import { count, desc, eq, and, sql, getTableColumns } from 'drizzle-orm';
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
  status: z
    .enum(['Open', 'Funded', 'Submitted', 'Completed', 'Rejected', 'Expired'])
    .optional(),
  sort: z.enum(['recent', 'biggest']).default('recent'),
  // W1.B: "Gated by Caliber" filter — true = only jobs posted through the
  // RatingGateway (have a job_drafts row joined on onchain_job_id);
  // false = only jobs posted directly to AgenticCommerce.
  gated: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
});

// LEFT JOIN to job_drafts on text equality; the indexer stores onchain_job_id
// as text (PATCH'd after the on-chain tx confirms in PostJobForm).
const draftJoinCondition = sql`${jobDrafts.onchainJobId} = ${jobs.jobId}::text`;

// Subquery so the LEFT JOIN against agents doesn't multiply rows when one
// owner address controls multiple agent IDs.
const providerAgentIdExpr = sql<string | null>`(
  SELECT a.agent_id::text
  FROM agents a
  WHERE a.owner_address = ${jobs.providerAddress}
    AND a.chain_id = ${jobs.chainId}
  LIMIT 1
)`;

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const parsed = parseQuery(url, schema);
    if (!parsed.ok) return badRequest(parsed.error);
    const q = parsed.data;

    const whereParts = [];
    if (q.status) {
      whereParts.push(eq(jobs.status, q.status));
    }
    if (q.gated === true) {
      whereParts.push(sql`${jobDrafts.onchainJobId} IS NOT NULL`);
    } else if (q.gated === false) {
      whereParts.push(sql`${jobDrafts.onchainJobId} IS NULL`);
    }
    const whereClause =
      whereParts.length > 0 ? and(...whereParts) : undefined;

    const orderBy =
      q.sort === 'biggest' ? desc(jobs.budgetUsdc) : desc(jobs.createdAtBlock);

    const [rows, totalRow] = await Promise.all([
      db
        .select({
          ...getTableColumns(jobs),
          minTier: jobDrafts.minTier,
          minConfidence: jobDrafts.minConfidence,
          providerAgentId: providerAgentIdExpr.as('provider_agent_id'),
        })
        .from(jobs)
        .leftJoin(jobDrafts, draftJoinCondition)
        .where(whereClause)
        .orderBy(orderBy)
        .limit(q.limit)
        .offset(q.offset),
      db
        .select({ count: count() })
        .from(jobs)
        .leftJoin(jobDrafts, draftJoinCondition)
        .where(whereClause),
    ]);

    return ok({
      jobs: rows,
      total: Number(totalRow[0]?.count ?? 0),
      limit: q.limit,
      offset: q.offset,
    });
  } catch (err) {
    return serverError('Failed to list jobs', err);
  }
}
