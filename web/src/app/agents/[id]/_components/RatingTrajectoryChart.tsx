'use client';

import { useEffect, useState } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  ReferenceLine,
} from 'recharts';
import { api, TIER_ORDER, type CaliberTier, type RatingHistoryPoint } from '@/lib/api';

const TIER_TO_Y: Record<CaliberTier, number> = Object.fromEntries(
  TIER_ORDER.map((t, i) => [t, TIER_ORDER.length - 1 - i]),
) as Record<CaliberTier, number>;

const Y_TO_TIER = (y: number): CaliberTier | '' => {
  const idx = TIER_ORDER.length - 1 - Math.round(y);
  return TIER_ORDER[idx] ?? '';
};

interface Props {
  chain: string;
  agentId: string;
}

type WindowDays = 30 | 90 | 180;

export function RatingTrajectoryChart({ chain, agentId }: Props) {
  const [days, setDays] = useState<WindowDays>(180);
  const [points, setPoints] = useState<RatingHistoryPoint[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .ratingHistory(chain, agentId, { days, view: 'all' })
      .then((res) => {
        if (!cancelled) setPoints(res.history);
      })
      .catch(() => {
        if (!cancelled) setPoints([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [chain, agentId, days]);

  const pitPoints = (points ?? [])
    .filter((p) => p.view === 'PIT')
    .map((p) => ({
      ts: new Date(p.date).getTime(),
      pit: TIER_TO_Y[p.tier],
      tier: p.tier,
      completion: p.completion_rate_smoothed,
      confidence: p.confidence,
    }));

  const ttcPoints = (points ?? [])
    .filter((p) => p.view === 'TTC')
    .map((p) => ({
      ts: new Date(p.date).getTime(),
      ttc: TIER_TO_Y[p.tier],
      tier: p.tier,
    }));

  // Merge PIT and TTC on date for the chart's data array (recharts wants one
  // row per x value with both line keys present where they exist).
  const dataByTs = new Map<number, Record<string, number | string | null>>();
  for (const p of pitPoints) {
    dataByTs.set(p.ts, {
      ts: p.ts,
      pit: p.pit,
      tier: p.tier,
      completion: p.completion,
      confidence: p.confidence,
    });
  }
  for (const p of ttcPoints) {
    const row = dataByTs.get(p.ts) ?? { ts: p.ts };
    row.ttc = p.ttc;
    dataByTs.set(p.ts, row);
  }
  const data = Array.from(dataByTs.values()).sort(
    (a, b) => Number(a.ts) - Number(b.ts),
  );

  const hasTtc = ttcPoints.length > 0;
  const empty = !loading && data.length === 0;
  const single = data.length === 1;

  return (
    <section className="border border-[var(--color-hairline)] bg-white rounded-[2px] p-5">
      <div className="flex items-baseline justify-between mb-4 gap-4 flex-wrap">
        <div>
          <h2 className="font-mono text-[13px] text-[var(--color-ink)] tracking-[0.02em]">
            //rating_trajectory
          </h2>
          <p className="text-xs text-[var(--color-mute)] mt-1 leading-snug">
            Daily snapshot at 04:00 UTC. {hasTtc ? 'Solid PIT, dashed TTC.' : 'Point-in-Time only — TTC needs ≥180 days of history.'}
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
        <div className="h-[280px] flex items-center justify-center text-xs font-mono text-[var(--color-mute)]">
          // loading trajectory…
        </div>
      )}

      {empty && (
        <div className="h-[280px] flex flex-col items-center justify-center gap-2 text-xs font-mono text-[var(--color-mute)] border border-dashed border-[var(--color-hairline)] rounded-[2px]">
          <span>no snapshots yet in this window</span>
          <span className="text-[10px]">
            new snapshots write daily at 04:00 UTC — check back tomorrow
          </span>
        </div>
      )}

      {single && (
        <div className="text-[11px] font-mono text-[var(--color-mute)] mb-2">
          // only one snapshot so far — trajectory will draw a line starting tomorrow
        </div>
      )}

      {!loading && data.length > 0 && (
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={data} margin={{ top: 10, right: 16, bottom: 8, left: 8 }}>
            <CartesianGrid stroke="var(--color-hairline)" strokeDasharray="2 3" vertical={false} />
            <XAxis
              dataKey="ts"
              type="number"
              domain={['dataMin', 'dataMax']}
              scale="time"
              tickFormatter={(t) => new Date(t).toISOString().slice(5, 10)}
              tick={{ fontSize: 10, fontFamily: 'var(--font-family-mono)', fill: 'var(--color-mute)' }}
              stroke="var(--color-hairline)"
            />
            <YAxis
              domain={[0, TIER_ORDER.length - 1]}
              ticks={[0, 2, 4, 6, 8]}
              tickFormatter={(y) => Y_TO_TIER(Number(y)).replace('Caliber-', '')}
              tick={{ fontSize: 10, fontFamily: 'var(--font-family-mono)', fill: 'var(--color-mute)' }}
              stroke="var(--color-hairline)"
              width={50}
            />
            {/* Reference line for the Pending band — most agents on a young
                dataset cluster around insufficient-data tier */}
            <ReferenceLine
              y={TIER_TO_Y['Pending']}
              stroke="var(--color-hairline)"
              strokeDasharray="1 4"
              label={{
                value: 'Pending',
                position: 'right',
                fill: 'var(--color-mute)',
                fontSize: 9,
                fontFamily: 'var(--font-family-mono)',
              }}
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
              labelFormatter={(t) => new Date(Number(t)).toISOString().slice(0, 10)}
              formatter={(_value, name, item) => {
                const payload = item.payload as { tier?: CaliberTier; completion?: number; confidence?: string };
                if (name === 'pit') {
                  return [
                    payload.tier
                      ? `${payload.tier} · completion ${(Number(payload.completion ?? 0) * 100).toFixed(1)}% · ${payload.confidence ?? '?'}`
                      : '—',
                    'PIT',
                  ];
                }
                if (name === 'ttc') {
                  return [payload.tier ?? '—', 'TTC'];
                }
                return [String(_value), name];
              }}
            />
            <Line
              type="stepAfter"
              dataKey="pit"
              stroke="var(--color-copper)"
              strokeWidth={2}
              dot={{ r: 2.5, fill: 'var(--color-copper)', stroke: 'var(--color-copper)' }}
              activeDot={{ r: 4 }}
              isAnimationActive={false}
              connectNulls
            />
            {hasTtc && (
              <Line
                type="stepAfter"
                dataKey="ttc"
                stroke="var(--color-ink)"
                strokeWidth={1.5}
                strokeDasharray="4 3"
                dot={false}
                isAnimationActive={false}
                connectNulls
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      )}
    </section>
  );
}
