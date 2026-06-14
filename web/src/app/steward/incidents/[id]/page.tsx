import { notFound } from 'next/navigation';
import Link from 'next/link';
import { sql } from '@/lib/db';
import { StewardNav } from '../../_components/StewardNav';
import { ResolveButton } from './_components/ResolveButton';
import {
  kindColor,
  kindLabel,
  incidentSummary,
  EVIDENCE_LABELS,
} from '@/lib/steward-incidents';

// Steward — Incident detail. The full record for one caught payment: kind,
// severity, the treasurer's narrative (placeholder until an LLM fills it),
// the evidence as a readable definition list, and the payment it relates to.
// Behind NEXT_PUBLIC_STEWARD.

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface IncidentRow {
  id: string;
  created_at: Date;
  kind: string;
  severity: string;
  status: string;
  host: string | null;
  pay_to: string | null;
  payment_id: string | null;
  evidence: Record<string, unknown> | null;
  narrative: string | null;
  resolved_at: Date | null;
  resolved_by: string | null;
}

interface PaymentRow {
  id: string;
  created_at: Date;
  host: string;
  seller_url: string;
  quoted_usdc: string | null;
  settled_usdc: string | null;
  decision: string;
  decision_stage: string | null;
  reasoning: string | null;
  pay_to: string | null;
}

function fmtTime(d: Date | null): string {
  if (!d) return '—';
  return new Date(d).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

function prettyValue(v: unknown): string {
  if (v == null) return '—';
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
    return String(v);
  }
  return JSON.stringify(v, null, 2);
}

export default async function StewardIncidentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (process.env.NEXT_PUBLIC_STEWARD !== '1') notFound();

  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();

  const [inc] = await sql<IncidentRow[]>`
    SELECT id::text, created_at, kind, severity, status, host, pay_to,
           payment_id::text, evidence, narrative, resolved_at, resolved_by
    FROM steward_incidents
    WHERE id = ${id}::bigint
    LIMIT 1`;

  if (!inc) notFound();

  let payment: PaymentRow | null = null;
  if (inc.payment_id) {
    const rows = await sql<PaymentRow[]>`
      SELECT id::text, created_at, host, seller_url, quoted_usdc, settled_usdc,
             decision, decision_stage, reasoning, pay_to
      FROM steward_payments
      WHERE id = ${inc.payment_id}::bigint
      LIMIT 1`;
    payment = rows[0] ?? null;
  }

  const c = kindColor(inc.kind);
  const evidence = inc.evidence ?? {};
  const evidenceEntries = Object.entries(evidence);

  return (
    <main className="mx-auto max-w-3xl px-4 sm:px-5 py-10 sm:py-14">
      <StewardNav active="incidents" />

      <nav className="font-mono text-[11px] text-[var(--color-mute)] mb-6">
        <Link
          href="/steward/incidents"
          className="hover:text-[var(--color-copper)]"
        >
          incidents
        </Link>
        <span className="mx-2 opacity-50">/</span>
        <span>#{inc.id}</span>
      </nav>

      <section className="mb-8">
        <div className="flex items-center gap-3 flex-wrap mb-3">
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              color: c,
              background: `${c}14`,
              border: `1px solid ${c}59`,
              borderRadius: 2,
              padding: '3px 9px',
            }}
          >
            {kindLabel(inc.kind)}
          </span>
          <span className="font-mono text-xs text-[var(--color-ink)]">
            severity {inc.severity}
          </span>
          <span
            className="font-mono text-[11px] uppercase tracking-[0.05em]"
            style={{
              color:
                inc.status === 'open'
                  ? 'var(--color-copper)'
                  : 'var(--color-mute)',
              fontWeight: inc.status === 'open' ? 600 : 400,
            }}
          >
            {inc.status === 'open' ? '● open' : 'resolved'}
          </span>
        </div>

        <h1 className="text-2xl sm:text-3xl font-semibold text-[var(--color-ink)] tracking-tight mb-2 leading-snug">
          {incidentSummary(inc.kind, inc.evidence)}
        </h1>
        <p className="font-mono text-[11px] text-[var(--color-mute)]">
          {inc.host ? `${inc.host} · ` : ''}
          {fmtTime(inc.created_at)}
        </p>
      </section>

      {/* Narrative */}
      <section className="mb-8">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--color-copper)] mb-2">
          //treasurer_narrative
        </h2>
        {inc.narrative ? (
          <p className="text-[15px] text-[var(--color-ink)] leading-relaxed">
            {inc.narrative}
          </p>
        ) : (
          <p className="text-[15px] italic text-[var(--color-mute)] leading-relaxed">
            Treasurer&apos;s narrative pending.
          </p>
        )}
      </section>

      {/* Evidence */}
      <section className="mb-8">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--color-copper)] mb-3">
          //evidence
        </h2>
        {evidenceEntries.length === 0 ? (
          <p className="text-sm text-[var(--color-mute)]">
            No structured evidence recorded.
          </p>
        ) : (
          <dl className="border border-[var(--color-hairline)] rounded-[2px] divide-y divide-[var(--color-hairline)]">
            {evidenceEntries.map(([k, v]) => (
              <div
                key={k}
                className="grid grid-cols-1 sm:grid-cols-[180px_1fr] gap-1 sm:gap-3 px-3 py-2"
              >
                <dt className="font-mono text-[11px] text-[var(--color-mute)] uppercase tracking-[0.04em]">
                  {EVIDENCE_LABELS[k] ?? k}
                </dt>
                <dd className="font-mono text-xs text-[var(--color-ink)] break-all whitespace-pre-wrap">
                  {prettyValue(v)}
                </dd>
              </div>
            ))}
          </dl>
        )}
        {inc.kind === 'sdn_hit' ? (
          <p className="mt-3 font-mono text-[11px] text-[var(--color-mute)] leading-relaxed">
            OFAC SDN screening (Chainalysis sanctions oracle). Exact-match
            screening against the published sanctions list; not a compliance
            determination.
          </p>
        ) : null}
      </section>

      {/* Linked payment */}
      {payment ? (
        <section className="mb-8">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--color-copper)] mb-3">
            //linked_payment
          </h2>
          <dl className="border border-[var(--color-hairline)] rounded-[2px] divide-y divide-[var(--color-hairline)]">
            {[
              ['Host', payment.host],
              [
                'Quoted → settled',
                `${payment.quoted_usdc ?? '—'} → ${payment.settled_usdc ?? '—'} USDC`,
              ],
              ['Decision', payment.decision],
              ['Stage', payment.decision_stage ?? '—'],
              ['payTo', payment.pay_to ?? '—'],
              ['When', fmtTime(payment.created_at)],
              ['Reasoning', payment.reasoning ?? '—'],
            ].map(([label, value]) => (
              <div
                key={label}
                className="grid grid-cols-1 sm:grid-cols-[180px_1fr] gap-1 sm:gap-3 px-3 py-2"
              >
                <dt className="font-mono text-[11px] text-[var(--color-mute)] uppercase tracking-[0.04em]">
                  {label}
                </dt>
                <dd className="font-mono text-xs text-[var(--color-ink)] break-all whitespace-pre-wrap">
                  {value}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 font-mono text-[11px]">
            <Link
              href="/steward/ledger"
              className="text-[var(--color-copper)] hover:underline"
            >
              → view in ledger
            </Link>
          </p>
        </section>
      ) : null}

      {/* Resolve */}
      <section className="border-t border-[var(--color-hairline)] pt-6 flex items-center justify-between gap-4 flex-wrap">
        <div className="font-mono text-[11px] text-[var(--color-mute)]">
          {inc.status === 'resolved'
            ? `resolved ${fmtTime(inc.resolved_at)}${inc.resolved_by ? ` by ${inc.resolved_by}` : ''}`
            : 'this incident is still open'}
        </div>
        <ResolveButton id={inc.id} initialStatus={inc.status} />
      </section>
    </main>
  );
}
