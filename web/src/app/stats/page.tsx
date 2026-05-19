'use client';

import { useEffect, useState } from 'react';
import { api, type StatsResponse } from '@/lib/api';
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
} from 'recharts';

export default function StatsPage() {
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [timeseries, setTimeseries] = useState<
    Array<{ day: string; agents: number; jobs: number; usdc: string }>
  >([]);

  useEffect(() => {
    api.stats().then(setStats).catch(() => {});
    api.timeseries().then(setTimeseries).catch(() => {});
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
                    <CartesianGrid strokeDasharray="3 3" stroke="#222838" />
                    <XAxis dataKey="day" tick={{ fill: '#9095A6', fontSize: 12 }} />
                    <YAxis tick={{ fill: '#9095A6', fontSize: 12 }} />
                    <Tooltip
                      contentStyle={{
                        background: '#12151F',
                        border: '1px solid #222838',
                        borderRadius: '8px',
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="agents"
                      stroke="#5B5BD6"
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
                    <CartesianGrid strokeDasharray="3 3" stroke="#222838" />
                    <XAxis dataKey="day" tick={{ fill: '#9095A6', fontSize: 12 }} />
                    <YAxis tick={{ fill: '#9095A6', fontSize: 12 }} />
                    <Tooltip
                      contentStyle={{
                        background: '#12151F',
                        border: '1px solid #222838',
                        borderRadius: '8px',
                      }}
                    />
                    <Bar dataKey="jobs" fill="#3DDC97" radius={[4, 4, 0, 0]} />
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
                  <CartesianGrid strokeDasharray="3 3" stroke="#222838" />
                  <XAxis dataKey="day" tick={{ fill: '#9095A6', fontSize: 12 }} />
                  <YAxis tick={{ fill: '#9095A6', fontSize: 12 }} />
                  <Tooltip
                    contentStyle={{
                      background: '#12151F',
                      border: '1px solid #222838',
                      borderRadius: '8px',
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="usdc"
                    stroke="#F2C744"
                    fill="#F2C744"
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
