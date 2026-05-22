import Link from 'next/link';
import { type RatingSnapshot } from '@arc-agents/db';
import { type CaliberTier } from '@/lib/api';

const TIER_COLOR: Record<CaliberTier, string> = {
  'Caliber-AAA': '#00B894',
  'Caliber-AA': '#1ABC9C',
  'Caliber-A': '#7ED957',
  'Caliber-BBB': '#C2A86A',
  'Caliber-BB': '#E6A23C',
  'Caliber-B': '#F39C12',
  'Caliber-CCC': '#E07845',
  'Caliber-CC': '#C0392B',
  'Caliber-D': '#7E1B0F',
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
  // No snapshot yet — render an honest empty state. Agents that haven't been
  // through a snapshot run (too new, or not rateable) get this.
  if (!snapshot) {
    return (
      <section className="border border-[var(--color-hairline)] bg-white rounded-[2px] p-5">
        <h2 className="font-mono text-[13px] text-[var(--color-ink)] tracking-[0.02em]">
          //rating_exposure
        </h2>
        <p className="text-xs text-[var(--color-mute)] mt-2 leading-snug">
          No Caliber snapshot for this agent yet. Either insufficient
          interactions for a public rating, or the agent will be captured in
          the next daily snapshot at 04:00 UTC.{' '}
          <Link href="/methodology#15-minimum-data-requirement" className="text-[var(--color-copper)] hover:underline">
            §1.5 minimum data requirement →
          </Link>
        </p>
      </section>
    );
  }

  const tier = snapshot.tier as CaliberTier;
  const pd = snapshot.ppd30d ? Number(snapshot.ppd30d) : null;
  const lgd = snapshot.lgd ? Number(snapshot.lgd) : null;
  const eadNum = snapshot.eadUsdc ? Number(snapshot.eadUsdc) : 0;
  const el = pd !== null && lgd !== null ? pd * lgd * eadNum : null;

  return (
    <section className="border border-[var(--color-hairline)] bg-white rounded-[2px] p-5">
      <div className="flex items-baseline justify-between mb-4 flex-wrap gap-3">
        <div>
          <h2 className="font-mono text-[13px] text-[var(--color-ink)] tracking-[0.02em]">
            //rating_exposure
          </h2>
          <p className="text-xs text-[var(--color-mute)] mt-1 leading-snug">
            Current Caliber rating + active escrow exposure. PD × LGD × EAD =
            expected performance loss across this agent&apos;s in-flight book.
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
        <Cell
          label="ppd (30d)"
          hint={`probability of performance default — ${snapshot.confidence} confidence`}
        >
          {pd !== null ? `${(pd * 100).toFixed(2)}%` : '—'}
        </Cell>
        <Cell label="lgd" hint="loss given failure, segmented per §5.3">
          {lgd !== null ? `${(lgd * 100).toFixed(1)}%` : '—'}
        </Cell>
        <Cell
          label="ead"
          hint="funded escrow currently in flight (§6)"
          copper
        >
          {formatUsdc(snapshot.eadUsdc)}
        </Cell>
        <Cell label="expected loss" hint="pd × lgd × ead">
          {el !== null ? formatUsdc(el.toFixed(2)) : '—'}
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
