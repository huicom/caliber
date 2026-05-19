import { db, jobs } from '@/lib/db';
import { count, desc, eq, and } from 'drizzle-orm';
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
});

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
    const whereClause =
      whereParts.length > 0 ? and(...whereParts) : undefined;

    const orderBy =
      q.sort === 'biggest' ? desc(jobs.budgetUsdc) : desc(jobs.createdAtBlock);

    const [rows, totalRow] = await Promise.all([
      db
        .select()
        .from(jobs)
        .where(whereClause)
        .orderBy(orderBy)
        .limit(q.limit)
        .offset(q.offset),
      db
        .select({ count: count() })
        .from(jobs)
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
