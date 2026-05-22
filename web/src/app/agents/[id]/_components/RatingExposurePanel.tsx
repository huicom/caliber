import Link from 'next/link';
import { type RatingSnapshot } from '@arc-agents/db';
import { type CaliberTier } from '@/lib/api';

// Caliber Rating v2.0 — Track Record panel.
// Replaces the v1 PD/LGD/EAD/EL exposure panel. The five cells now show
// tier, score (0-100), completion %, forward-looking success %, and active
// escrow. No expected-loss claim — Caliber v2.0 doesn't publish one.

const TIER_COLOR: Record<CaliberTier, string> = {
  Established: '#00B894',
  Proven:      '#0EA5E9',
  Emerging:    '#14B8A6',
  Provisional: '#94A3B8',
  Watch:       '#F59E0B',
  Inactive:    '#1F2937',
};

function formatUsdc(s: string | null | undefined, fallback = '—'): string {
  if (!s) return fallback;
  const n = Number(s);
  if (Number.isNaN(n)) return fallback;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n > 0) return `$${n.toFixed(4)}`;
  return '$0';
}

interface Props {
  snapshot: RatingSnapshot | null;
}

export function RatingExposurePanel({ snapshot }: Props) {
  if (!snapshot) {
    return (
      <section className="border border-[var(--color-hairline)] bg-white rounded-[2px] p-5">
        <h2 className="font-mono text-[13px] text-[var(--color-ink)] tracking-[0.02em]">
          //track_record
        </h2>
        <p className="text-xs text-[var(--color-mute)] mt-2 leading-snug">
          No Caliber snapshot for this agent yet. Either insufficient
          interactions for a public rating, or the agent will be captured in
          the next daily snapshot at 04:00 UTC.{' '}
          <Link href="/methodology#what-we-look-at-the-core-table" className="text-[var(--color-copper)] hover:underline">
            see methodology →
          </Link>
        </p>
      </section>
    );
  }

  const tier = snapshot.tier as CaliberTier;
  // v2.0 column reuse (per snapshot-daily.ts + history.ts):
  //   ppd_30d  storage → completion_rate_smoothed
  //   lgd      storage → forward_success
  //   ead_usdc storage → active_escrow_usdc
  const completion = snapshot.ppd30d ? Number(snapshot.ppd30d) : null;
  const forward = snapshot.lgd ? Number(snapshot.lgd) : null;

  return (
    <section className="border border-[var(--color-hairline)] bg-white rounded-[2px] p-5">
      <div className="flex items-baseline justify-between mb-4 flex-wrap gap-3">
        <div>
          <h2 className="font-mono text-[13px] text-[var(--color-ink)] tracking-[0.02em]">
            //track_record
          </h2>
          <p className="text-xs text-[var(--color-mute)] mt-1 leading-snug">
            Caliber Rating v2.0 — tier, score, smoothed completion, and
            current escrow under this agent&apos;s in-flight book.
          </p>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.05em] text-[var(--color-mute)]">
          as of {snapshot.computedAt.toISOString().slice(0, 10)} ·{' '}
          methodology v{snapshot.methodologyVersion}
        </span>
      </div>

      <div className="grid sm:grid-cols-2 md:grid-cols-5 gap-3">
        <Cell label="tier" copper>
          <span style={{ color: TIER_COLOR[tier] ?? 'var(--color-ink)' }}>{tier}</span>
        </Cell>
        <Cell label="confidence" hint={`based on ${snapshot.interactionCount ?? 0} interactions`}>
          {snapshot.confidence}
        </Cell>
        <Cell label="completion" hint="credibility-weighted, blended with population mean">
          {completion !== null ? `${(completion * 100).toFixed(1)}%` : '—'}
        </Cell>
        <Cell label="forward success" hint="next-job estimate, recency-weighted">
          {forward !== null ? `${(forward * 100).toFixed(1)}%` : '—'}
        </Cell>
        <Cell label="active escrow" hint="USDC currently funded for this agent (§v2.0 Step 1)" copper>
          {formatUsdc(snapshot.eadUsdc)}
        </Cell>
      </div>

      <p className="font-mono text-[10px] text-[var(--color-mute)] mt-4 leading-snug">
        // {snapshot.interactionCount ?? 0} interactions in lookback window ·
        snapshot view: {snapshot.view} ·{' '}
        <Link
          href={`/rating/arc/${String(snapshot.agentId)}`}
          className="text-[var(--color-copper)] hover:underline"
        >
          factor breakdown →
        </Link>
      </p>
    </section>
  );
}

function Cell({
  label,
  hint,
  copper,
  children,
}: {
  label: string;
  hint?: string;
  copper?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="border border-[var(--color-hairline)] bg-[var(--color-bg-elev)] rounded-[2px] p-3">
      <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--color-mute)] mb-1">
        {label}
      </div>
      <div
        className={
          'font-mono text-lg font-medium ' +
          (copper ? 'text-[var(--color-copper)]' : 'text-[var(--color-ink)]')
        }
      >
        {children}
      </div>
      {hint && (
        <div className="text-[10px] text-[var(--color-mute)] mt-1.5 leading-snug">
          {hint}
        </div>
      )}
    </div>
  );
}
