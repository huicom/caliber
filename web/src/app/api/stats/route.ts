import { db, agents, jobs } from '@/lib/db';
import { count, sum, desc, gte, eq, and, sql as drizzleSql } from 'drizzle-orm';
import { ok, serverError } from '@/lib/api-helpers';
import { cached } from '@/lib/cache';

export const dynamic = 'force-dynamic';

async function computeStats() {
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [
    totalAgentsRow,
    totalJobsRow,
    completedJobsAggRow,
    last24hAgentsRow,
    last24hJobsRow,
    last24hUsdcRow,
    topAgentsByReputation,
    topAgentsByEarnings,
  ] = await Promise.all([
    db.select({ count: count() }).from(agents),
    db.select({ count: count() }).from(jobs),
    db
      .select({ count: count(), sum: sum(jobs.budgetUsdc) })
      .from(jobs)
      .where(eq(jobs.status, 'Completed')),
    db
      .select({ count: count() })
      .from(agents)
      .where(gte(agents.createdAt, oneDayAgo)),
    db
      .select({ count: count() })
      .from(jobs)
      .where(gte(jobs.createdAt, oneDayAgo)),
    db
      .select({ sum: sum(jobs.budgetUsdc) })
      .from(jobs)
      .where(
        and(eq(jobs.status, 'Completed'), gte(jobs.createdAt, oneDayAgo)),
      ),
    db
      .select({
        agentId: agents.agentId,
        name: agents.name,
        reputationScore: agents.reputationScore,
        feedbackCount: agents.feedbackCount,
      })
      .from(agents)
      .where(drizzleSql`reputation_score IS NOT NULL`)
      .orderBy(desc(agents.reputationScore))
      .limit(10),
    db
      .select({
        agentId: agents.agentId,
        name: agents.name,
        usdcEarned: agents.usdcEarned,
        jobsCompleted: agents.jobsCompleted,
      })
      .from(agents)
      .orderBy(desc(agents.usdcEarned))
      .limit(10),
  ]);

  return {
    totals: {
      agents: Number(totalAgentsRow[0]?.count ?? 0),
      jobs: Number(totalJobsRow[0]?.count ?? 0),
      completedJobs: Number(completedJobsAggRow[0]?.count ?? 0),
      usdcVolume: completedJobsAggRow[0]?.sum ?? '0',
    },
    last24h: {
      newAgents: Number(last24hAgentsRow[0]?.count ?? 0),
      newJobs: Number(last24hJobsRow[0]?.count ?? 0),
      usdcVolume: last24hUsdcRow[0]?.sum ?? '0',
    },
    topAgents: {
      byReputation: topAgentsByReputation,
      byEarnings: topAgentsByEarnings,
    },
    updatedAt: new Date().toISOString(),
  };
}

export async function GET() {
  try {
    const stats = await cached('stats:global', 30_000, computeStats);
    return ok(stats);
  } catch (err) {
    return serverError('Stats query failed', err);
  }
}
