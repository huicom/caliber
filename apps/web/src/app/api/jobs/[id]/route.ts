import { db, agents, jobs, jobEvents } from '@/lib/db';
import { eq, desc, asc } from 'drizzle-orm';
import { ok, notFound, serverError } from '@/lib/api-helpers';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const jobId = BigInt(id);

    const [job] = await db
      .select()
      .from(jobs)
      .where(eq(jobs.jobId, jobId))
      .limit(1);
    if (!job) return notFound('Job not found');

    const [timeline, provider] = await Promise.all([
      db
        .select()
        .from(jobEvents)
        .where(eq(jobEvents.jobId, jobId))
        .orderBy(asc(jobEvents.blockNumber)),
      db
        .select({
          agentId: agents.agentId,
          name: agents.name,
          reputationScore: agents.reputationScore,
        })
        .from(agents)
        .where(eq(agents.ownerAddress, job.providerAddress))
        .limit(1),
    ]);

    return ok({
      job,
      timeline,
      provider: provider[0] ?? null,
    });
  } catch (err) {
    return serverError('Failed to fetch job', err);
  }
}
