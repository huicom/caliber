'use client';

import { useEffect, useState } from 'react';
import { api, TIER_ORDER, type CaliberTier, type ExposureSummary } from '@/lib/api';

const TIER_COLOR: Record<CaliberTier, string> = {
  Established: '#00B894',
  Proven:      '#0EA5E9',
  Emerging:    '#14B8A6',
  Provisional: '#94A3B8',
  Watch:       '#F59E0B',
  Inactive:    '#1F2937',
};

function formatUsdc(s: string): string {
  const n = Number(s);
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(4)}`;
}

export function ExposureSummaryPanel() {
  const [data, setData] = useState<ExposureSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .exposureSummary('arc')
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch(() => {
        if (!cancelled) setErrored(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Sort tier breakdown by canonical order so the table reads top→bottom.
  const sortedRows = data
    ? [...data.by_tier].sort(
        (a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier),
      )
    : [];

  return (
    <section className="border border-[var(--color-hairline)] bg-white rounded-[2px] p-5 mb-8">
      <div className="flex items-baseline justify-between mb-4 flex-wrap gap-4">
        <div>
          <h2 className="font-mono text-[13px] text-[var(--color-ink)] tracking-[0.02em]">
            //active_escrow
          </h2>
          <p className="text-xs text-[var(--color-mute)] mt-1 leading-snug">
            What&apos;s currently at stake — funded ERC-8183 escrow across every
            Caliber-rated agent, broken out by tier. Caliber v2.0 does not
            publish an expected-loss claim; this view is observed escrow, not
            a probability-weighted estimate.
          </p>
        </div>
        {data?.computed_at && (
          <span className="font-mono text-[10px] uppercase tracking-[0.05em] text-[var(--color-mute)]">
            as of {String(data.computed_at).slice(0, 10)}
          </span>
        )}
      </div>

      {loading && (
        <div className="text-xs font-mono text-[var(--color-mute)] py-8 text-center">
          // loading exposure data…
        </div>
      )}

      {errored && (
        <div className="text-xs font-mono text-[var(--color-signal-down)] py-4">
          // exposure summary unavailable
        </div>
      )}

      {data && !loading && (
        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <Stat
            label="rated agents"
            value={data.total_agents.toLocaleString()}
            hint="agents with a public Caliber rating today"
          />
          <Stat
            label="total active escrow"
            value={formatUsdc(data.total_active_escrow_usdc)}
            hint="USDC currently in escrow across every rated agent's in-flight jobs"
            copper
          />
        </div>
      )}

      {data && !loading && sortedRows.length > 0 && (
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.05em] text-[var(--color-mute)] mb-2">
            //breakdown_by_tier
          </p>
          <table className="w-full text-xs font-mono">
            <thead className="text-[var(--color-mute)]">
              <tr>
                <th className="text-left pb-2 font-normal">tier</th>
                <th className="text-right pb-2 font-normal">agents</th>
                <th className="text-right pb-2 font-normal">active escrow</th>
                <th className="text-right pb-2 font-normal">avg / agent</th>
              </tr>
            </thead>
            <tbody className="text-[var(--color-ink)]">
              {sortedRows.map((row) => {
                const escrow = Number(row.active_escrow_usdc);
                const avg = row.agent_count > 0 ? escrow / row.agent_count : 0;
                return (
                  <tr key={row.tier} className="border-t border-[var(--color-hairline)]">
                    <td className="py-1.5">
                      <span
                        className="inline-flex items-center gap-2"
                        style={{ color: TIER_COLOR[row.tier] }}
                      >
                        <span
                          className="inline-block w-2 h-2 rounded-full"
                          style={{ background: TIER_COLOR[row.tier] }}
                        />
                        {row.tier}
                      </span>
                    </td>
                    <td className="py-1.5 text-right">{row.agent_count}</td>
                    <td className="py-1.5 text-right">{formatUsdc(row.active_escrow_usdc)}</td>
                    <td className="py-1.5 text-right text-[var(--color-mute)]">
                      {avg > 0 ? formatUsdc(String(avg)) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="text-[10px] text-[var(--color-mute)] mt-3 leading-snug">
            Active escrow = sum of funded in-flight ERC-8183 jobs assigned to
            each rated agent. The v1 "expected loss" column has been removed
            from this view; Caliber v2.0 publishes a tier and a score, not a
            probability of default.
          </p>
        </div>
      )}
    </section>
  );
}

function Stat({
  label,
  value,
  hint,
  copper,
}: {
  label: string;
  value: string;
  hint?: string;
  copper?: boolean;
}) {
  return (
    <div className="border border-[var(--color-hairline)] bg-[var(--color-bg-elev)] rounded-[2px] p-4">
      <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--color-mute)] mb-1">
        {label}
      </div>
      <div
        className={
          'font-mono text-2xl font-medium ' +
          (copper ? 'text-[var(--color-copper)]' : 'text-[var(--color-ink)]')
        }
      >
        {value}
      </div>
      {hint && (
        <div className="text-[10px] text-[var(--color-mute)] mt-1.5 leading-snug">
          {hint}
        </div>
      )}
    </div>
  );
}
