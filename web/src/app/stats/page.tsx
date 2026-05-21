'use client';

import { useEffect, useState } from 'react';
import { api, type StatsResponse, type RatingDistribution } from '@/lib/api';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AgentAvatar } from '@/components/ui/AgentAvatar';
import { ReputationStars } from '@/components/ui/ReputationStars';
import { formatUSDC } from '@/lib/format';
import { Bot, Briefcase, DollarSign } from 'lucide-react';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';

export default function StatsPage() {
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [timeseries, setTimeseries] = useState<
    Array<{ day: string; agents: number; jobs: number; usdc: string }>
  >([]);
  const [distribution, setDistribution] = useState<RatingDistribution | null>(null);
  const [distributionError, setDistributionError] = useState(false);

  useEffect(() => {
    api.stats().then(setStats).catch(() => {});
    api.timeseries().then(setTimeseries).catch(() => {});
    api
      .ratingDistribution('arc')
      .then(setDistribution)
      .catch(() => setDistributionError(true));
  }, []);

  if (!stats) {
    return (
      <main className="mx-auto max-w-7xl px-4 py-8">
        <Skeleton className="h-8 w-48 mb-8" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      </main>
    );
  }

  // API returns counts as strings (bigint serialization) — recharts treats
  // strings as categorical and won't autoscale the Y-axis, so coerce here.
  const chartData = timeseries.map((row) => ({
    day: new Date(row.day + 'T00:00:00').toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    }),
    agents: Number(row.agents) || 0,
    jobs: Number(row.jobs) || 0,
    usdc: parseFloat(row.usdc.toString()) || 0,
  }));

  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <h1 className="text-3xl font-bold mb-8">Stats</h1>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-8">
        <StatCard
          icon={Bot}
          label="Total Agents"
          value={stats.totals.agents.toLocaleString()}
        />
        <StatCard
          icon={Briefcase}
          label="Total Jobs"
          value={stats.totals.jobs.toLocaleString()}
        />
        <StatCard
          icon={DollarSign}
          label="USDC Volume"
          value={`$${formatUSDC(stats.totals.usdcVolume, 0)}`}
        />
      </div>

      <RatingDistributionSection
        distribution={distribution}
        errored={distributionError}
      />

      {chartData.length > 0 && (
        <>
          <div className="grid md:grid-cols-2 gap-6 mb-8">
            <Card>
              <CardHeader>
                <CardTitle>Agent Registrations (30d)</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={250}>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E1E5EA" />
                    <XAxis dataKey="day" tick={{ fill: '#4A5460', fontSize: 12 }} />
                    <YAxis tick={{ fill: '#4A5460', fontSize: 12 }} />
                    <Tooltip
                      contentStyle={{
                        background: '#FFFFFF',
                        border: '1px solid #E1E5EA',
                        borderRadius: '8px',
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="agents"
                      stroke="#0066FF"
                      strokeWidth={2}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Jobs Created (30d)</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E1E5EA" />
                    <XAxis dataKey="day" tick={{ fill: '#4A5460', fontSize: 12 }} />
                    <YAxis tick={{ fill: '#4A5460', fontSize: 12 }} />
                    <Tooltip
                      contentStyle={{
                        background: '#FFFFFF',
                        border: '1px solid #E1E5EA',
                        borderRadius: '8px',
                      }}
                    />
                    <Bar dataKey="jobs" fill="#00B894" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          <Card className="mb-8">
            <CardHeader>
              <CardTitle>USDC Volume (30d)</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={250}>
                <AreaChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E1E5EA" />
                  <XAxis dataKey="day" tick={{ fill: '#4A5460', fontSize: 12 }} />
                  <YAxis tick={{ fill: '#4A5460', fontSize: 12 }} />
                  <Tooltip
                    contentStyle={{
                      background: '#FFFFFF',
                      border: '1px solid #E1E5EA',
                      borderRadius: '8px',
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="usdc"
                    stroke="#0066FF"
                    fill="#0066FF"
                    fillOpacity={0.1}
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </>
      )}

      {stats.topAgents.byReputation.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Top Agents by Reputation</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>Agent</TableHead>
                  <TableHead>Reputation</TableHead>
                  <TableHead>Feedback</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stats.topAgents.byReputation.map((a, i) => (
                  <TableRow key={a.agentId}>
                    <TableCell className="font-mono text-text-dim">
                      {i + 1}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <AgentAvatar id={a.agentId} size={28} />
                        <span className="text-sm">
                          {a.name ?? `#${a.agentId}`}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <ReputationStars score={a.reputationScore} />
                    </TableCell>
                    <TableCell className="font-mono">
                      {a.feedbackCount ?? '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </main>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="border border-border rounded-lg p-4 bg-bg-subtle">
      <Icon className="w-5 h-5 text-text-muted mb-3" />
      <div className="font-mono text-2xl font-bold">{value}</div>
      <div className="text-sm text-text-muted">{label}</div>
    </div>
  );
}

const TIER_ORDER: Array<keyof RatingDistribution['by_tier']> = [
  'Caliber-AAA',
  'Caliber-AA',
  'Caliber-A',
  'Caliber-BBB',
  'Caliber-BB',
  'Caliber-B',
  'Caliber-CCC',
  'Caliber-CC',
  'Caliber-D',
];

const TIER_COLOR: Record<string, string> = {
  'Caliber-AAA': '#00D4A8',
  'Caliber-AA': '#00D4A8',
  'Caliber-A': '#00D4A8',
  'Caliber-BBB': '#FFB547',
  'Caliber-BB': '#FFB547',
  'Caliber-B': '#FF9F45',
  'Caliber-CCC': '#FF9F45',
  'Caliber-CC': '#FF5C5C',
  'Caliber-D': '#FF5C5C',
};

function RatingDistributionSection({
  distribution,
  errored,
}: {
  distribution: RatingDistribution | null;
  errored: boolean;
}) {
  if (errored) {
    return (
      <Card className="mb-8">
        <CardHeader>
          <CardTitle>Rating distribution</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-text-muted">
            Rating service unreachable. Refresh in a moment, or check{' '}
            <a
              href="https://caliber-api.poko.blue/health"
              className="text-accent hover:underline"
            >
              /health
            </a>
            .
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!distribution) {
    return (
      <Card className="mb-8">
        <CardHeader>
          <CardTitle>Rating distribution</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3 text-sm text-text-muted">
            <Skeleton className="h-4 w-4 rounded-full" />
            Computing ratings for all rateable agents… (first load may take up to a minute; subsequent loads are cached for 5 minutes)
          </div>
        </CardContent>
      </Card>
    );
  }

  const data = TIER_ORDER.map((t) => ({
    tier: t.replace('Caliber-', ''),
    fullTier: t,
    count: distribution.by_tier[t] ?? 0,
    color: TIER_COLOR[t],
  }));

  const total = distribution.total_agents;
  const rateable = distribution.rateable_agents;
  const ratedPct = total > 0 ? ((rateable / total) * 100).toFixed(1) : '0';
  const meanPdPct = (distribution.mean_ppd_30d * 100).toFixed(2);

  return (
    <Card className="mb-8">
      <CardHeader>
        <CardTitle className="flex items-center justify-between flex-wrap gap-2">
          <span>Rating distribution</span>
          <span className="text-xs font-mono text-text-dim">
            {rateable.toLocaleString()} / {total.toLocaleString()} agents rated ({ratedPct}%)
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid lg:grid-cols-[1fr_auto] gap-6 items-start">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={data} margin={{ top: 10, right: 8, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E1E5EA" vertical={false} />
              <XAxis dataKey="tier" tick={{ fill: '#4A5460', fontSize: 12, fontFamily: 'monospace' }} />
              <YAxis tick={{ fill: '#4A5460', fontSize: 12 }} allowDecimals={false} />
              <Tooltip
                contentStyle={{
                  background: '#FFFFFF',
                  border: '1px solid #E1E5EA',
                  borderRadius: '8px',
                  fontSize: '13px',
                }}
                labelFormatter={(label) => `Arc-${label}`}
                formatter={(value: number) => [value.toLocaleString(), 'agents']}
              />
              <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                {data.map((entry) => (
                  <Cell key={entry.tier} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>

          <div className="space-y-3 lg:min-w-[200px]">
            <DistStat
              label="Mean 30d PPD"
              value={`${meanPdPct}%`}
            />
            <DistStat
              label="High confidence"
              value={distribution.by_confidence.high.toLocaleString()}
              sub="≥50 interactions"
            />
            <DistStat
              label="Medium"
              value={distribution.by_confidence.medium.toLocaleString()}
              sub="15-49 interactions"
            />
            <DistStat
              label="Low"
              value={distribution.by_confidence.low.toLocaleString()}
              sub="5-14 interactions"
            />
            <DistStat
              label="Unrated"
              value={(
                distribution.unrated.insufficient_interactions +
                distribution.unrated.insufficient_history +
                distribution.unrated.other
              ).toLocaleString()}
              sub={`${distribution.unrated.insufficient_history} too young · ${distribution.unrated.insufficient_interactions} too quiet`}
            />
          </div>
        </div>

        <div className="mt-4 pt-4 border-t border-border flex items-center justify-between flex-wrap gap-3 text-xs text-text-dim">
          <span>
            Computed{' '}
            <time dateTime={distribution.computed_at}>
              {new Date(distribution.computed_at).toLocaleString()}
            </time>{' '}
            · cached 5 min
          </span>
          <Link
            href="/methodology#3-rating-scale"
            className="text-accent hover:underline"
          >
            How tiers are assigned →
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

function DistStat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-border bg-bg-elev px-3 py-2.5">
      <div className="font-mono text-[0.65rem] uppercase tracking-wider text-text-dim">
        {label}
      </div>
      <div className="font-mono text-lg text-fg tabular-nums">{value}</div>
      {sub ? <div className="text-[0.7rem] text-text-dim">{sub}</div> : null}
    </div>
  );
}
