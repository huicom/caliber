import { db, agents, jobs } from '@/lib/db';
import { eq, count, desc } from 'drizzle-orm';
import {
  ok,
  notFound,
  parseQuery,
  paginationSchema,
  badRequest,
  serverError,
} from '@/lib/api-helpers';

export const dynamic = 'force-dynamic';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const agentId = BigInt(id);

    const [agent] = await db
      .select({ ownerAddress: agents.ownerAddress })
      .from(agents)
      .where(eq(agents.agentId, agentId))
      .limit(1);
    if (!agent) return notFound('Agent not found');

    const parsed = parseQuery(new URL(req.url), paginationSchema);
    if (!parsed.ok) return badRequest(parsed.error);

    const [rows, totalRow] = await Promise.all([
      db
        .select()
        .from(jobs)
        .where(eq(jobs.providerAddress, agent.ownerAddress))
        .orderBy(desc(jobs.createdAtBlock))
        .limit(parsed.data.limit)
        .offset(parsed.data.offset),
      db
        .select({ count: count() })
        .from(jobs)
        .where(eq(jobs.providerAddress, agent.ownerAddress)),
    ]);

    return ok({
      jobs: rows,
      total: Number(totalRow[0]?.count ?? 0),
      limit: parsed.data.limit,
      offset: parsed.data.offset,
    });
  } catch (err) {
    return serverError('Failed to fetch agent jobs', err);
  }
}
