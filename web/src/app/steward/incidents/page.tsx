import { notFound } from 'next/navigation';
import Link from 'next/link';
import { sql } from '@/lib/db';
import { StewardNav } from '../_components/StewardNav';
import {
  kindColor,
  kindLabel,
  incidentSummary,
} from '@/lib/steward-incidents';

// Steward — Incidents. Every time a detector or screen caught something: a
// redirected payTo, an overcharge, a runaway loop, a sanctions hit. Newest
// first. Behind NEXT_PUBLIC_STEWARD.

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata = {
  title: 'Steward — Incidents',
  description: 'Every payment Steward caught and why.',
};

interface IncidentRow {
  id: string;
  created_at: Date;
  kind: string;
  severity: string;
  status: string;
  host: string | null;
  evidence: Record<string, unknown> | null;
}

function relTime(d: Date): string {
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (Number.isNaN(s) || s < 0) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function KindBadge({ kind }: { kind: string }) {
  const c = kindColor(kind);
  return (
    <span
      style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 11,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
        color: c,
        background: `${c}14`,
        border: `1px solid ${c}59`,
        borderRadius: 2,
        padding: '2px 7px',
        whiteSpace: 'nowrap',
      }}
    >
      {kindLabel(kind)}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const open = status === 'open';
  return (
    <span
      className="font-mono text-[10px] uppercase tracking-[0.05em]"
      style={{
        color: open ? 'var(--color-copper)' : 'var(--color-mute)',
        fontWeight: open ? 600 : 400,
      }}
    >
      {open ? '● open' : 'resolved'}
    </span>
  );
}

export default async function StewardIncidentsPage() {
  if (process.env.NEXT_PUBLIC_STEWARD !== '1') notFound();

  const rows = await sql<IncidentRow[]>`
    SELECT id::text, created_at, kind, severity, status, host, evidence
    FROM steward_incidents
    ORDER BY created_at DESC, id DESC
    LIMIT 100`;

  return (
    <main className="mx-auto max-w-5xl px-4 sm:px-5 py-10 sm:py-14">
      <StewardNav active="incidents" />

      <section className="mb-8">
        <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--color-copper)] mb-2">
          //steward_incidents
        </p>
        <h1 className="text-3xl sm:text-4xl font-semibold text-[var(--color-ink)] tracking-tight mb-3">
          Incidents
        </h1>
        <p className="text-[15px] text-[var(--color-ink)] leading-relaxed max-w-prose">
          Every time Steward caught something before signing — a redirected
          payee, an overcharge, a runaway loop, a sanctions hit. Each row links
          to the full evidence.
        </p>
      </section>

      <div className="relative w-full overflow-auto border border-[var(--color-hairline)] rounded-[2px] bg-[var(--color-paper)]">
        <table className="w-full caption-bottom text-sm border-collapse">
          <thead>
            <tr className="border-b border-[var(--color-hairline)]">
              {['time', 'kind', 'severity', 'host', 'status', 'what happened'].map(
                (h) => (
                  <th
                    key={h}
                    className="h-9 px-2 text-left align-middle font-mono text-[10px] uppercase tracking-[0.06em] text-[var(--color-mute)] font-medium"
                  >
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="p-6 text-center text-sm text-[var(--color-mute)]"
                >
                  No incidents yet — nothing has tripped a detector or screen.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr
                  key={r.id}
                  className="border-b border-[var(--color-hairline)] hover:bg-[var(--color-bg-elev)] transition-colors align-top"
                >
                  <td className="p-2 align-top font-mono text-[11px] text-[var(--color-mute)] whitespace-nowrap">
                    <Link
                      href={`/steward/incidents/${r.id}`}
                      className="hover:text-[var(--color-copper)]"
                    >
                      {relTime(r.created_at)}
                    </Link>
                  </td>
                  <td className="p-2 align-top">
                    <KindBadge kind={r.kind} />
                  </td>
                  <td className="p-2 align-top font-mono text-[11px] text-[var(--color-ink)] whitespace-nowrap">
                    {r.severity}
                  </td>
                  <td className="p-2 align-top font-mono text-xs text-[var(--color-mute)] break-all max-w-[160px]">
                    {r.host ?? '—'}
                  </td>
                  <td className="p-2 align-top whitespace-nowrap">
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="p-2 align-top text-xs leading-snug text-[var(--color-ink)]">
                    <Link
                      href={`/steward/incidents/${r.id}`}
                      className="hover:text-[var(--color-copper)]"
                    >
                      {incidentSummary(r.kind, r.evidence)}
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-6 text-sm text-[var(--color-mute)] leading-relaxed border-t border-[var(--color-hairline)] pt-6">
        An incident is a payment Steward refused or held, plus the evidence for
        the call. The treasurer&apos;s plain-English narrative is attached to
        each one.
      </p>
    </main>
  );
}
