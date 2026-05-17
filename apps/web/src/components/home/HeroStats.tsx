import { api } from '@/lib/api';
import { Bot, Briefcase, DollarSign, Activity } from 'lucide-react';
import { formatUSDC } from '@/lib/format';

export async function HeroStats() {
  let stats;
  try {
    stats = await api.stats();
  } catch {
    return null;
  }

  const cards = [
    {
      icon: Bot,
      value: stats.totals.agents.toLocaleString(),
      label: 'Total Agents',
    },
    {
      icon: Briefcase,
      value: stats.totals.jobs.toLocaleString(),
      label: 'Total Jobs',
    },
    {
      icon: DollarSign,
      value: `$${formatUSDC(stats.totals.usdcVolume, 0)}`,
      label: 'USDC Volume',
      sub: `${stats.totals.completedJobs.toLocaleString()} completed`,
    },
    {
      icon: Activity,
      value: stats.last24h.newAgents + stats.last24h.newJobs,
      label: 'Activity (24h)',
      sub: `${stats.last24h.newAgents} agents, ${stats.last24h.newJobs} jobs`,
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {cards.map((c) => (
        <div
          key={c.label}
          className="border border-border rounded-lg p-4 bg-bg-subtle"
        >
          <c.icon className="w-5 h-5 text-text-muted mb-3" />
          <div className="font-mono text-2xl font-bold">{c.value}</div>
          <div className="text-sm text-text-muted">{c.label}</div>
          {c.sub && (
            <div className="text-xs text-text-dim mt-1">{c.sub}</div>
          )}
        </div>
      ))}
    </div>
  );
}
