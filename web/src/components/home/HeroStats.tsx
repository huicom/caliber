import { db, agents, jobs } from '@/lib/db';
import { count, sum, eq, and, gte } from 'drizzle-orm';
import { StatBlock } from '@/components/ui/StatBlock';
import { formatUSDC } from '@/lib/format';

interface Totals {
  agents: number;
  jobs: number;
  completedJobs: number;
  usdcVolume: string;
  newJobs24h: number;
}

async function fetchTotals(): Promise<Totals | null> {
  try {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [agentsRow, jobsRow, completedRow, last24hJobsRow] = await Promise.all([
      db.select({ count: count() }).from(agents),
      db.select({ count: count() }).from(jobs),
      db
        .select({ count: count(), sum: sum(jobs.budgetUsdc) })
        .from(jobs)
        .where(eq(jobs.status, 'Completed')),
      db
        .select({ count: count() })
        .from(jobs)
        .where(and(gte(jobs.createdAt, oneDayAgo))),
    ]);
    return {
      agents: Number(agentsRow[0]?.count ?? 0),
      jobs: Number(jobsRow[0]?.count ?? 0),
      completedJobs: Number(completedRow[0]?.count ?? 0),
      usdcVolume: String(completedRow[0]?.sum ?? '0'),
      newJobs24h: Number(last24hJobsRow[0]?.count ?? 0),
    };
  } catch {
    return null;
  }
}

export async function HeroStats() {
  const t = await fetchTotals();

  if (!t) {
    return (
      <>
        <StatBlock label="Agents indexed" value="—" />
        <StatBlock label="Jobs settled" value="—" />
        <StatBlock label="Total earned (USDC)" value="—" sub="stats unavailable" />
      </>
    );
  }

  return (
    <>
      <StatBlock label="Agents indexed" value={t.agents.toLocaleString()} />
      <StatBlock
        label="Jobs settled"
        value={t.completedJobs.toLocaleString()}
        sub={`of ${t.jobs.toLocaleString()} total`}
      />
      <StatBlock
        label="Total earned (USDC)"
        value={
          <span>
            <span className="text-fg-dim mr-0.5">$</span>
            {formatUSDC(t.usdcVolume, 0)}
          </span>
        }
        sub={`${t.newJobs24h} new jobs · 24h`}
      />
    </>
  );
}

export function HeroStatsSkeleton() {
  return (
    <>
      <StatBlock label="Agents indexed" value="" loading />
      <StatBlock label="Jobs settled" value="" loading />
      <StatBlock label="Total earned (USDC)" value="" loading />
    </>
  );
}
