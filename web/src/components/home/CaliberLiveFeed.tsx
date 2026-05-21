'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import {
  useLive,
  useNowTick,
  formatRelative,
  type LiveEvent,
} from '@/components/live/LiveContext';
import type { SeedEvent } from './LiveFeedClient';

interface FeedRow {
  key: string;
  kind: string;
  block: number;
  refId: string | null;
  actor: string | null;
  extra: string | null;
  timestamp: number | null;
  isLive: boolean;
}

/* Maps internal event kinds → the `.aa-evt--*` modifier in the Caliber design.
 * Keeps the visual taxonomy small (job / fb / att / mig / set / dsp / reg). */
function evtSlot(kind: string): { mod: string; label: string } {
  switch (kind) {
    case 'JobCreated':
      return { mod: 'aa-evt--job', label: 'job' };
    case 'JobFunded':
      return { mod: 'aa-evt--job', label: 'fund' };
    case 'BudgetSet':
      return { mod: 'aa-evt--fb', label: 'budget' };
    case 'JobSubmitted':
      return { mod: 'aa-evt--mig', label: 'submit' };
    case 'JobCompleted':
      return { mod: 'aa-evt--set', label: 'settle' };
    case 'JobRejected':
      return { mod: 'aa-evt--dsp', label: 'dispute' };
    case 'JobExpired':
      return { mod: 'aa-evt--dsp', label: 'expired' };
    case 'FeedbackGiven':
      return { mod: 'aa-evt--fb', label: 'feedback' };
    case 'AgentRegistered':
      return { mod: 'aa-evt--reg', label: 'register' };
    case '__compact__':
      return { mod: 'aa-evt--reg', label: 'batch' };
    default:
      return { mod: 'aa-evt--reg', label: kind.toLowerCase().slice(0, 10) };
  }
}

function shortAddr(addr: string | null): string {
  if (!addr) return '—';
  if (addr.length < 12) return addr;
  return `${addr.slice(0, 8)}…${addr.slice(-3)}`;
}

const KIND_MAP: Record<string, string> = {
  agent_registered: 'AgentRegistered',
  feedback_given: 'FeedbackGiven',
};

function normalizeKind(k: string): string {
  return KIND_MAP[k] ?? k;
}

function rowMessage(row: FeedRow): React.ReactNode {
  const ref = row.refId ?? '?';
  switch (row.kind) {
    case 'JobCreated':
      return (
        <>
          job <Link href={`/jobs/${ref}`} className="aa-mono">#{ref}</Link>{' '}
          posted{row.actor ? <> by <span className="aa-mono">{shortAddr(row.actor)}</span></> : null}
          <div className="aa-feed__sub">new escrow opened · awaiting fund</div>
        </>
      );
    case 'BudgetSet':
      return (
        <>
          budget set on <Link href={`/jobs/${ref}`} className="aa-mono">#{ref}</Link>
          <div className="aa-feed__sub">provider accepted scope · client may fund</div>
        </>
      );
    case 'JobFunded':
      return (
        <>
          job <Link href={`/jobs/${ref}`} className="aa-mono">#{ref}</Link> funded
          <div className="aa-feed__sub">USDC moved into escrow · deliverable due</div>
        </>
      );
    case 'JobSubmitted':
      return (
        <>
          deliverable submitted for <Link href={`/jobs/${ref}`} className="aa-mono">#{ref}</Link>
          <div className="aa-feed__sub">awaiting evaluator approval</div>
        </>
      );
    case 'JobCompleted':
      return (
        <>
          job <Link href={`/jobs/${ref}`} className="aa-mono">#{ref}</Link> settled · USDC released
          <div className="aa-feed__sub">verifier returned <span className="aa-mono">approved</span></div>
        </>
      );
    case 'JobRejected':
      return (
        <>
          job <Link href={`/jobs/${ref}`} className="aa-mono">#{ref}</Link> rejected
          <div className="aa-feed__sub">client may claim refund after expiry</div>
        </>
      );
    case 'JobExpired':
      return (
        <>
          job <Link href={`/jobs/${ref}`} className="aa-mono">#{ref}</Link> expired
          <div className="aa-feed__sub">funds returnable via <span className="aa-mono">claimRefund()</span></div>
        </>
      );
    case 'FeedbackGiven':
      return (
        <>
          feedback recorded for <Link href={`/agents/${ref}`} className="aa-mono">agent #{ref}</Link>
          {row.extra ? <> · score <span className="aa-mono">{row.extra} / 25</span></> : null}
          <div className="aa-feed__sub">factored into next Caliber attestation</div>
        </>
      );
    case 'AgentRegistered':
      return (
        <>
          new subject registered · <Link href={`/agents/${ref}`} className="aa-mono">agent #{ref}</Link>
          <div className="aa-feed__sub">awaiting first attestation · unrated</div>
        </>
      );
    case '__compact__':
      return (
        <>
          batched block · multiple events
          <div className="aa-feed__sub">{row.extra ?? 'see full feed for breakdown'}</div>
        </>
      );
    default:
      return (
        <>
          {row.kind}
          <div className="aa-feed__sub">{row.refId ?? '—'}</div>
        </>
      );
  }
}

function FeedItem({ row }: { row: FeedRow }) {
  const ago = row.timestamp !== null ? formatRelative(row.timestamp) : null;
  const slot = evtSlot(row.kind);
  const blockLabel = `#${row.block.toLocaleString()}`;

  return (
    <li className="aa-feed__item">
      <div className="aa-feed__when">
        <span className="aa-mono">{ago ?? blockLabel}</span>
        {ago ? <span className="aa-mono aa-mute">{blockLabel}</span> : null}
      </div>
      <span className={`aa-evt ${slot.mod}`}>{slot.label}</span>
      <div className="aa-feed__msg">{rowMessage(row)}</div>
    </li>
  );
}

function dedupeKey(kind: string, block: string | number, refId: string | null) {
  return `${block}-${kind}-${refId ?? 'na'}`;
}

/**
 * Caliber-styled live feed. Same data sources as the legacy
 * LiveFeedClient (seed rows from /api/feed via SSR + live LiveContext
 * stream), but renders into the design's `.aa-feed` markup.
 */
export function CaliberLiveFeed({ seed }: { seed: SeedEvent[] }) {
  useNowTick(1000);
  const { events } = useLive();

  const rows = useMemo<FeedRow[]>(() => {
    const seen = new Set<string>();
    const out: FeedRow[] = [];

    // Live events come in newest-first
    for (const e of events) {
      const kind = String(e.kind ?? '');
      const refId = (e.agentId ?? e.jobId ?? null) as string | null;
      const block = Number(e.blockNumber ?? 0);
      const k = dedupeKey(kind, block, refId);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({
        key: `live-${k}`,
        kind,
        block,
        refId,
        actor: (e.actor ?? e.from ?? null) as string | null,
        extra: (e.extra ?? null) as string | null,
        timestamp: e.timestamp ?? null,
        isLive: true,
      });
    }

    // Then seed (historical, no timestamps)
    for (const s of seed) {
      const kind = normalizeKind(s.kind);
      const block = Number(s.block ?? 0);
      const refId = s.ref_id;
      const k = dedupeKey(kind, block, refId);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({
        key: `seed-${k}`,
        kind,
        block,
        refId,
        actor: s.actor,
        extra: s.extra,
        timestamp: null,
        isLive: false,
      });
    }

    return out.slice(0, 8); // design shows ~8 rows
  }, [events, seed]);

  if (rows.length === 0) {
    return (
      <p className="aa-foot-mono" style={{ paddingTop: 16 }}>
        waiting for first indexed event…
      </p>
    );
  }

  return (
    <ol className="aa-feed">
      {rows.map((r) => (
        <FeedItem key={r.key} row={r} />
      ))}
    </ol>
  );
}
