'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

// Shared row shape — matches the SSE `payment` payload from services/steward
// exactly, and the page normalizes its initial DB rows into the same shape.
export interface LedgerRow {
  id: number | string;
  createdAt: string;
  host: string;
  sellerUrl: string;
  quotedUsdc: string | null;
  settledUsdc: string | null;
  decision: 'allow' | 'hold' | 'deny' | string;
  decisionStage: string | null;
  reasoning: string | null;
  payTo: string | null;
  source: string | null;
}

export interface FreezeState {
  frozen: boolean;
  reason?: string | null;
}

const DECISION_STYLE: Record<
  string,
  { label: string; fg: string; bg: string; border: string }
> = {
  allow: {
    label: 'allow',
    fg: 'var(--color-signal-up)',
    bg: 'rgba(15,122,74,0.08)',
    border: 'rgba(15,122,74,0.35)',
  },
  deny: {
    label: 'deny',
    fg: 'var(--color-signal-down)',
    bg: 'rgba(180,35,24,0.08)',
    border: 'rgba(180,35,24,0.35)',
  },
  hold: {
    label: 'hold',
    fg: 'var(--color-signal-watch)',
    bg: 'rgba(180,83,9,0.08)',
    border: 'rgba(180,83,9,0.35)',
  },
};

function fmtUsdc(v: string | null): string {
  if (v == null) return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return v;
  return n.toFixed(n < 1 ? 4 : 3);
}

function relTime(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (Number.isNaN(s) || s < 0) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function DecisionBadge({ decision }: { decision: string }) {
  const s = DECISION_STYLE[decision] ?? {
    label: decision,
    fg: 'var(--color-mute)',
    bg: 'var(--color-bg-elev)',
    border: 'var(--color-hairline)',
  };
  return (
    <span
      style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 11,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
        color: s.fg,
        background: s.bg,
        border: `1px solid ${s.border}`,
        borderRadius: 2,
        padding: '2px 7px',
        whiteSpace: 'nowrap',
      }}
    >
      {s.label}
    </span>
  );
}

function LedgerRowView({ row }: { row: LedgerRow }) {
  const [expanded, setExpanded] = useState(false);
  const isDeny = row.decision === 'deny';
  const reasoning = row.reasoning ?? '';
  const longReason = reasoning.length > 80;

  return (
    <>
      <tr
        className="border-b border-[var(--color-hairline)] hover:bg-[var(--color-bg-elev)] transition-colors align-top"
        style={isDeny ? { background: 'rgba(180,35,24,0.035)' } : undefined}
      >
        <td className="p-2 align-top font-mono text-[11px] text-[var(--color-mute)] whitespace-nowrap">
          {relTime(row.createdAt)}
        </td>
        <td className="p-2 align-top font-mono text-xs text-[var(--color-ink)] break-all max-w-[180px]">
          {row.host}
          {row.source ? (
            <span className="block text-[10px] text-[var(--color-mute)]">
              via {row.source}
            </span>
          ) : null}
        </td>
        <td className="p-2 align-top font-mono text-xs whitespace-nowrap">
          <span className="text-[var(--color-copper)]">
            ${fmtUsdc(row.quotedUsdc)}
          </span>
          <span className="text-[var(--color-mute)]">
            {' → '}
            {row.settledUsdc != null ? `$${fmtUsdc(row.settledUsdc)}` : '—'}
          </span>
        </td>
        <td className="p-2 align-top">
          <DecisionBadge decision={row.decision} />
        </td>
        <td className="p-2 align-top font-mono text-[11px] text-[var(--color-mute)] whitespace-nowrap">
          {row.decisionStage ?? '—'}
        </td>
        <td
          className={
            'p-2 align-top text-xs leading-snug ' +
            (isDeny
              ? 'text-[var(--color-ink)] font-medium'
              : 'text-[var(--color-mute)]')
          }
        >
          {reasoning ? (
            <span title={reasoning}>
              {expanded || !longReason
                ? reasoning
                : reasoning.slice(0, 80) + '…'}
              {longReason ? (
                <button
                  type="button"
                  onClick={() => setExpanded((e) => !e)}
                  className="ml-1 text-[var(--color-copper)] hover:underline font-mono text-[10px]"
                >
                  {expanded ? 'less' : 'more'}
                </button>
              ) : null}
            </span>
          ) : (
            <span className="text-[var(--color-mute)]">—</span>
          )}
        </td>
      </tr>
    </>
  );
}

export function LiveLedger({
  initialRows,
  initialFreeze,
}: {
  initialRows: LedgerRow[];
  initialFreeze: FreezeState;
}) {
  const [rows, setRows] = useState<LedgerRow[]>(initialRows);
  const [freeze, setFreeze] = useState<FreezeState>(initialFreeze);
  const [connected, setConnected] = useState(false);
  const [pending, setPending] = useState(false);
  const seen = useRef<Set<string>>(
    new Set(initialRows.map((r) => String(r.id))),
  );

  // SSE subscription — prepend payments, reconcile freeze.
  useEffect(() => {
    const es = new EventSource('/api/steward/live');
    es.addEventListener('connected', () => setConnected(true));
    es.addEventListener('steward_event', (ev) => {
      try {
        const msg = JSON.parse((ev as MessageEvent).data);
        if (msg.kind === 'payment' && msg.payment) {
          const p = msg.payment as LedgerRow;
          const key = String(p.id);
          if (seen.current.has(key)) return;
          seen.current.add(key);
          setRows((prev) => [p, ...prev].slice(0, 200));
        } else if (msg.kind === 'freeze') {
          setFreeze({ frozen: !!msg.frozen, reason: msg.reason ?? null });
        }
      } catch {
        // ignore malformed
      }
    });
    es.onerror = () => setConnected(false);
    return () => es.close();
  }, []);

  const toggleFreeze = useCallback(
    async (next: boolean) => {
      const reason = next
        ? window.prompt('Reason for freezing the treasury?', 'manual freeze') ??
          'manual freeze'
        : null;
      // Optimistic; SSE + server response reconcile.
      setFreeze({ frozen: next, reason });
      setPending(true);
      try {
        const res = await fetch('/api/steward/freeze', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ frozen: next, reason }),
        });
        const state = (await res.json()) as FreezeState;
        setFreeze(state);
      } catch {
        // reconcile from server truth
        try {
          const state = (await (
            await fetch('/api/steward/freeze')
          ).json()) as FreezeState;
          setFreeze(state);
        } catch {
          /* leave optimistic value */
        }
      } finally {
        setPending(false);
      }
    },
    [],
  );

  return (
    <>
      {/* Freeze control */}
      {freeze.frozen ? (
        <div
          className="rounded-[2px] border px-4 py-3 mb-6 flex items-center justify-between gap-4 flex-wrap"
          style={{
            borderColor: 'var(--color-signal-down)',
            background: 'rgba(180,35,24,0.07)',
          }}
        >
          <div>
            <p
              className="font-mono text-sm font-semibold tracking-wide"
              style={{ color: 'var(--color-signal-down)' }}
            >
              ● TREASURY FROZEN — all payments denied
            </p>
            {freeze.reason ? (
              <p className="text-xs text-[var(--color-ink)] mt-1">
                reason: {freeze.reason}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            disabled={pending}
            onClick={() => toggleFreeze(false)}
            className="font-mono text-xs px-3 py-1.5 rounded-[2px] border border-[var(--color-ink)] text-[var(--color-ink)] hover:bg-[var(--color-ink)] hover:text-[var(--color-paper)] transition disabled:opacity-50"
          >
            {pending ? 'working…' : 'unfreeze treasury'}
          </button>
        </div>
      ) : (
        <div className="rounded-[2px] border border-[var(--color-hairline)] bg-[var(--color-bg-elev)] px-4 py-3 mb-6 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{
                background: connected
                  ? 'var(--color-signal-up)'
                  : 'var(--color-mute)',
                boxShadow: connected
                  ? '0 0 0 3px rgba(15,122,74,0.18)'
                  : 'none',
              }}
            />
            <span className="font-mono text-[11px] text-[var(--color-mute)] uppercase tracking-[0.06em]">
              {connected ? 'live · treasury active' : 'connecting…'}
            </span>
          </div>
          <button
            type="button"
            disabled={pending}
            onClick={() => toggleFreeze(true)}
            className="font-mono text-xs px-3 py-1.5 rounded-[2px] border border-[var(--color-signal-down)] text-[var(--color-signal-down)] hover:bg-[var(--color-signal-down)] hover:text-[var(--color-paper)] transition disabled:opacity-50"
          >
            {pending ? 'working…' : 'freeze treasury'}
          </button>
        </div>
      )}

      {/* Ledger table */}
      <div className="relative w-full overflow-auto border border-[var(--color-hairline)] rounded-[2px] bg-[var(--color-paper)]">
        <table className="w-full caption-bottom text-sm border-collapse">
          <thead className="[&_tr]:border-b">
            <tr className="border-b border-[var(--color-hairline)]">
              {['time', 'host', 'amount', 'decision', 'stage', 'reasoning'].map(
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
                  No payments yet — the ledger fills as your agent asks to pay.
                </td>
              </tr>
            ) : (
              rows.map((r) => <LedgerRowView key={String(r.id)} row={r} />)
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
