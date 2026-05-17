import { db, agents, feedbackEvents, validations, jobs } from '@/lib/db';
import { eq, desc } from 'drizzle-orm';
import { ok, notFound, serverError } from '@/lib/api-helpers';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const agentId = BigInt(id);

    const [agent] = await db
      .select()
      .from(agents)
      .where(eq(agents.agentId, agentId))
      .limit(1);
    if (!agent) return notFound('Agent not found');

    const [recentFeedback, allValidations, recentJobs] = await Promise.all([
      db
        .select()
        .from(feedbackEvents)
        .where(eq(feedbackEvents.agentId, agentId))
        .orderBy(desc(feedbackEvents.blockNumber))
        .limit(20),
      db
        .select()
        .from(validations)
        .where(eq(validations.agentId, agentId))
        .orderBy(desc(validations.requestedAtBlock)),
      db
        .select()
        .from(jobs)
        .where(eq(jobs.providerAddress, agent.ownerAddress))
        .orderBy(desc(jobs.createdAtBlock))
        .limit(20),
    ]);

    return ok({
      agent,
      feedback: recentFeedback,
      validations: allValidations,
      recentJobs,
    });
  } catch (err) {
    return serverError('Failed to fetch agent', err);
  }
}
