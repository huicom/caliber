import { db, feedbackEvents } from '@/lib/db';
import { eq, count, desc } from 'drizzle-orm';
import {
  ok,
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
    const parsed = parseQuery(new URL(req.url), paginationSchema);
    if (!parsed.ok) return badRequest(parsed.error);

    const [rows, totalRow] = await Promise.all([
      db
        .select()
        .from(feedbackEvents)
        .where(eq(feedbackEvents.agentId, agentId))
        .orderBy(desc(feedbackEvents.blockNumber))
        .limit(parsed.data.limit)
        .offset(parsed.data.offset),
      db
        .select({ count: count() })
        .from(feedbackEvents)
        .where(eq(feedbackEvents.agentId, agentId)),
    ]);

    return ok({
      feedback: rows,
      total: Number(totalRow[0]?.count ?? 0),
      limit: parsed.data.limit,
      offset: parsed.data.offset,
    });
  } catch (err) {
    return serverError('Failed to fetch feedback', err);
  }
}
