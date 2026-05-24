'use client';

import { useEffect, useState } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from 'recharts';
import { api, type CaliberTier, type DistributionHistoryResponse } from '@/lib/api';

// v2.0.1 metallurgical tier palette. Tokens defined in globals.css :root
// (--tier-gold/silver/bronze/pending/watch/dormant). Hex literals here
// because Recharts can't resolve CSS variables in SVG fills.
const TIER_FILL: Record<CaliberTier, string> = {
  Gold:    '#B8862B',
  Silver:  '#7E8690',
  Bronze:  '#8C5A2C',
  Pending: '#98948C',
  Watch:   '#B45309',
  Dormant: '#A8A39A',
};

type WindowDays = 30 | 90 | 180;

export function TierDistributionHistoryChart() {
  const [days, setDays] = useState<WindowDays>(90);
  const [data, setData] = useState<DistributionHistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .distributionHistory({ days, view: 'PIT' })
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch(() => {
        if (!cancelled) setData(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [days]);

  const empty = !loading && (!data || data.series.length === 0);
  const single = !loading && data && data.series.length === 1;

  return (
    <section className="border border-[var(--color-hairline)] bg-white rounded-[2px] p-5 mb-8">
      <div className="flex items-baseline justify-between mb-4 gap-4 flex-wrap">
        <div>
          <h2 className="font-mono text-[13px] text-[var(--color-ink)] tracking-[0.02em]">
            //tier_distribution_over_time
          </h2>
          <p className="text-xs text-[var(--color-mute)] mt-1 leading-snug">
            Daily snapshot of how the rateable agent population splits across
            Caliber tiers. The shape is the story: a maturing registry should
            narrow on a stable cluster center.
          </p>
        </div>
        <div className="flex gap-1 font-mono text-[11px]">
          {([30, 90, 180] as const).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDays(d)}
              className={
                'px-2.5 py-1 border rounded-[2px] transition-colors ' +
                (days === d
                  ? 'border-[var(--color-ink)] bg-[var(--color-ink)] text-[var(--color-paper)]'
                  : 'border-[var(--color-hairline)] text-[var(--color-mute)] hover:border-[var(--color-ink)] hover:text-[var(--color-ink)]')
              }
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {loading && (
        <div className="h-[320px] flex items-center justify-center text-xs font-mono text-[var(--color-mute)]">
          // loading distribution history…
        </div>
      )}

      {empty && (
        <div className="h-[320px] flex flex-col items-center justify-center gap-2 text-xs font-mono text-[var(--color-mute)] border border-dashed border-[var(--color-hairline)] rounded-[2px]">
          <span>no snapshots yet in this window</span>
          <span className="text-[10px]">
            daily run writes at 04:00 UTC — the chart grows from tomorrow
          </span>
        </div>
      )}

      {single && (
        <div className="text-[11px] font-mono text-[var(--color-mute)] mb-2">
          // only one snapshot so far — the area will form from tomorrow&apos;s second point
        </div>
      )}

      {!loading && data && data.series.length > 0 && (
        <ResponsiveContainer width="100%" height={320}>
          <AreaChart data={data.series} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
            <CartesianGrid stroke="var(--color-hairline)" strokeDasharray="2 3" vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={(d) => String(d).slice(5)}
              tick={{ fontSize: 10, fontFamily: 'var(--font-family-mono)', fill: 'var(--color-mute)' }}
              stroke="var(--color-hairline)"
            />
            <YAxis
              tick={{ fontSize: 10, fontFamily: 'var(--font-family-mono)', fill: 'var(--color-mute)' }}
              stroke="var(--color-hairline)"
              width={40}
            />
            <Tooltip
              contentStyle={{
                background: 'var(--color-paper)',
                border: '1px solid var(--color-ink)',
                borderRadius: 2,
                fontFamily: 'var(--font-family-mono)',
                fontSize: 11,
                padding: '8px 10px',
              }}
              labelStyle={{ color: 'var(--color-ink)', marginBottom: 4 }}
            />
            <Legend
              wrapperStyle={{ fontFamily: 'var(--font-family-mono)', fontSize: 10 }}
              iconSize={10}
              align="right"
              verticalAlign="top"
            />
            {data.tiers.map((tier) => (
              <Area
                key={tier}
                type="monotone"
                dataKey={tier}
                stackId="1"
                stroke={TIER_FILL[tier]}
                fill={TIER_FILL[tier]}
                fillOpacity={0.85}
                isAnimationActive={false}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      )}
    </section>
  );
}
