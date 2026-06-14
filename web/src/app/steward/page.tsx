import { notFound } from 'next/navigation';
import Link from 'next/link';
import { sql } from '@/lib/db';
import { StewardNav } from './_components/StewardNav';
import { getStewardMetrics } from '@/lib/steward-metrics';
import {
  kindColor,
  kindLabel,
  incidentSummary,
} from '@/lib/steward-incidents';

// Steward — Overview. The front door for hackathon judges. One-line pitch, the
// public traction counters (same queries as /api/steward/metrics), the freeze
// banner, and the latest incidents + denials. Caliber stays invisible: copy
// never names the rating engine; any "rated low" string comes from data.
// Behind NEXT_PUBLIC_STEWARD.

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata = {
  title: 'Steward — the CFO layer for your agent',
  description:
    'Steward stops your agent from draining its wallet. Plain-English mandate in, every payment authorized, held, or denied — with the treasurer’s reasoning on the record.',
};

interface MiniIncident {
  id: string;
  created_at: Date;
  kind: string;
  status: string;
  evidence: Record<string, unknown> | null;
}

interface MiniDenial {
  id: string;
  created_at: Date;
  host: string;
  quoted_usdc: string | null;
  reasoning: string | null;
}

function relTime(d: Date): string {
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (Number.isNaN(s) || s < 0) return 'now';
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

function fmtUsdc(v: number): string {
  if (!Number.isFinite(v)) return '0';
  if (v === 0) return '0';
  return v < 1 ? v.toFixed(4) : v.toFixed(2);
}

function Counter({
  value,
  label,
  accent,
}: {
  value: string;
  label: string;
  accent?: boolean;
}) {
  return (
    <div className="border border-[var(--color-hairline)] rounded-[2px] bg-[var(--color-paper)] px-4 py-5">
      <div
        className="font-mono text-3xl sm:text-4xl font-semibold tabular-nums leading-none"
        style={{
          color: accent ? 'var(--color-copper)' : 'var(--color-ink)',
        }}
      >
        {value}
      </div>
      <div className="mt-2 font-mono text-[10px] uppercase tracking-[0.06em] text-[var(--color-mute)]">
        {label}
      </div>
    </div>
  );
}

export default async function StewardPage() {
  if (process.env.NEXT_PUBLIC_STEWARD !== '1') notFound();

  const metrics = await getStewardMetrics();

  const incidents = await sql<MiniIncident[]>`
    SELECT id::text, created_at, kind, status, evidence
    FROM steward_incidents
    ORDER BY created_at DESC, id DESC
    LIMIT 5`;

  const denials = await sql<MiniDenial[]>`
    SELECT id::text, created_at, host, quoted_usdc, reasoning
    FROM steward_payments
    WHERE decision = 'deny'
    ORDER BY created_at DESC, id DESC
    LIMIT 5`;

  return (
    <main className="mx-auto max-w-5xl px-4 sm:px-5 py-10 sm:py-14">
      <StewardNav active="overview" />

      {/* Hero */}
      <section className="mb-10">
        <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--color-copper)] mb-3">
          //steward
        </p>
        <h1 className="text-3xl sm:text-5xl font-semibold text-[var(--color-ink)] tracking-tight mb-4 leading-[1.08]">
          Steward stops your agent from draining its wallet.
        </h1>
        <p className="text-[16px] sm:text-[17px] text-[var(--color-ink)] leading-relaxed max-w-2xl">
          Plain-English mandate in, every payment authorized, held, or denied —
          with the treasurer&apos;s reasoning on the record.
        </p>
      </section>

      {/* Freeze banner */}
      {metrics.frozen ? (
        <div
          className="rounded-[2px] border px-4 py-3 mb-8"
          style={{
            borderColor: 'var(--color-signal-down)',
            background: 'rgba(180,35,24,0.07)',
          }}
        >
          <p
            className="font-mono text-sm font-semibold tracking-wide"
            style={{ color: 'var(--color-signal-down)' }}
          >
            ● TREASURY FROZEN — all payments denied
          </p>
          <p className="text-xs text-[var(--color-ink)] mt-1">
            Lift the freeze from the{' '}
            <Link href="/steward/ledger" className="underline">
              ledger
            </Link>
            .
          </p>
        </div>
      ) : (
        <div className="rounded-[2px] border border-[var(--color-hairline)] bg-[var(--color-bg-elev)] px-4 py-3 mb-8 flex items-center gap-2">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{
              background: 'var(--color-signal-up)',
              boxShadow: '0 0 0 3px rgba(15,122,74,0.18)',
            }}
          />
          <span className="font-mono text-[11px] text-[var(--color-mute)] uppercase tracking-[0.06em]">
            treasury active · freeze available on the ledger
          </span>
        </div>
      )}

      {/* Counters */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-10">
        <Counter
          value={String(metrics.payments.authorized)}
          label="payments authorized"
        />
        <Counter
          value={String(metrics.payments.denied + metrics.payments.held)}
          label="payments blocked"
          accent
        />
        <Counter
          value={String(metrics.incidents.caught)}
          label="incidents caught"
        />
        <Counter
          value={`$${fmtUsdc(metrics.payments.total_usdc_settled)}`}
          label="USDC under management"
        />
      </section>

      {/* Latest incidents + denials */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-10">
        <div>
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--color-copper)]">
              //latest_incidents
            </h2>
            <Link
              href="/steward/incidents"
              className="font-mono text-[11px] text-[var(--color-mute)] hover:text-[var(--color-copper)]"
            >
              all →
            </Link>
          </div>
          <ul className="border border-[var(--color-hairline)] rounded-[2px] divide-y divide-[var(--color-hairline)] bg-[var(--color-paper)]">
            {incidents.length === 0 ? (
              <li className="px-3 py-4 text-sm text-[var(--color-mute)]">
                No incidents yet.
              </li>
            ) : (
              incidents.map((i) => {
                const c = kindColor(i.kind);
                return (
                  <li key={i.id} className="px-3 py-2.5">
                    <Link
                      href={`/steward/incidents/${i.id}`}
                      className="block group"
                    >
                      <div className="flex items-center gap-2 mb-0.5">
                        <span
                          className="font-mono text-[10px] uppercase tracking-[0.04em] font-semibold"
                          style={{ color: c }}
                        >
                          {kindLabel(i.kind)}
                        </span>
                        <span className="font-mono text-[10px] text-[var(--color-mute)] ml-auto">
                          {relTime(i.created_at)}
                        </span>
                      </div>
                      <p className="text-xs text-[var(--color-ink)] leading-snug group-hover:text-[var(--color-copper)]">
                        {incidentSummary(i.kind, i.evidence)}
                      </p>
                    </Link>
                  </li>
                );
              })
            )}
          </ul>
        </div>

        <div>
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--color-copper)]">
              //latest_denials
            </h2>
            <Link
              href="/steward/ledger"
              className="font-mono text-[11px] text-[var(--color-mute)] hover:text-[var(--color-copper)]"
            >
              ledger →
            </Link>
          </div>
          <ul className="border border-[var(--color-hairline)] rounded-[2px] divide-y divide-[var(--color-hairline)] bg-[var(--color-paper)]">
            {denials.length === 0 ? (
              <li className="px-3 py-4 text-sm text-[var(--color-mute)]">
                No denials yet.
              </li>
            ) : (
              denials.map((d) => (
                <li key={d.id} className="px-3 py-2.5">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="font-mono text-[11px] text-[var(--color-ink)] break-all">
                      {d.host}
                    </span>
                    <span className="font-mono text-[10px] text-[var(--color-copper)] ml-auto whitespace-nowrap">
                      ${d.quoted_usdc ?? '—'}
                    </span>
                    <span className="font-mono text-[10px] text-[var(--color-mute)] whitespace-nowrap">
                      {relTime(d.created_at)}
                    </span>
                  </div>
                  <p className="text-xs text-[var(--color-mute)] leading-snug">
                    {d.reasoning ?? '—'}
                  </p>
                </li>
              ))
            )}
          </ul>
        </div>
      </section>

      {/* Footer links + honest note */}
      <section className="border-t border-[var(--color-hairline)] pt-6 space-y-4">
        <div className="flex flex-wrap gap-3">
          <Link
            href="/steward/ledger"
            className="font-mono text-xs px-4 py-2 rounded-[2px] border border-[var(--color-ink)] text-[var(--color-ink)] hover:bg-[var(--color-ink)] hover:text-[var(--color-paper)] transition"
          >
            open the ledger →
          </Link>
          <Link
            href="/steward/incidents"
            className="font-mono text-xs px-4 py-2 rounded-[2px] border border-[var(--color-hairline)] text-[var(--color-ink)] hover:border-[var(--color-copper)] transition"
          >
            view incidents →
          </Link>
        </div>
        <p className="text-xs text-[var(--color-mute)] leading-relaxed max-w-prose">
          {metrics.honest_note}
        </p>
      </section>
    </main>
  );
}
