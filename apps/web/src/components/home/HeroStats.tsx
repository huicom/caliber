import { api } from '@/lib/api';
import { StatBlock } from '@/components/ui/StatBlock';
import { formatUSDC } from '@/lib/format';

export async function HeroStats() {
  let stats;
  try {
    stats = await api.stats();
  } catch {
    return <HeroStatsSkeleton />;
  }

  return (
    <>
      <StatBlock
        label="Agents indexed"
        value={stats.totals.agents.toLocaleString()}
      />
      <StatBlock
        label="Jobs settled"
        value={stats.totals.completedJobs.toLocaleString()}
        sub={`of ${stats.totals.jobs.toLocaleString()} total`}
      />
      <StatBlock
        label="Total earned (USDC)"
        value={
          <span>
            <span className="text-fg-dim mr-0.5">$</span>
            {formatUSDC(stats.totals.usdcVolume, 0)}
          </span>
        }
        sub={`${stats.last24h.newJobs} new jobs · 24h`}
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
