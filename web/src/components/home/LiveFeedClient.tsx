'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import {
  useLive,
  useNowTick,
  formatRelative,
  type LiveEvent,
} from '@/components/live/LiveContext';
import { cn } from '@/lib/utils';

export interface SeedEvent {
  kind: string;
  ref_id: string | null;
  actor: string | null;
  block: number | string | null;
  extra: string | null;
}

interface FeedRow {
  key: string;
  kind: string;
  block: number;
  refId: string | null;
  actor: string | null;
  extra: string | null;
  timestamp: number | null; // epoch ms; null for seeded historical
  isLive: boolean;
}

const PILL_STYLE: Record<string, string> = {
  AgentRegistered: 'bg-accent/15 text-accent border-accent/30',
  FeedbackGiven: 'bg-warn/15 text-warn border-warn/30',
  JobCreated: 'bg-accent-2/15 text-accent-2 border-accent-2/30',
  JobCompleted: 'bg-accent/15 text-accent border-accent/30',
  JobSubmitted: 'bg-fg-mute/10 text-fg-mute border-border-hi',
  JobFunded: 'bg-fg-mute/10 text-fg-mute border-border-hi',
  BudgetSet: 'bg-fg-mute/10 text-fg-mute border-border-hi',
  __compact__: 'bg-fg-mute/10 text-fg-mute border-border-hi',
};

const PILL_LABEL: Record<string, string> = {
  AgentRegistered: 'AGENT',
  FeedbackGiven: 'FEEDBACK',
  JobCreated: 'JOB',
  JobCompleted: 'PAID',
  JobSubmitted: 'DELIVERY',
  JobFunded: 'ESCROW',
  BudgetSet: 'BUDGET',
  __compact__: 'BLOCK',
};

const KIND_MAP: Record<string, string> = {
  agent_registered: 'AgentRegistered',
  feedback_given: 'FeedbackGiven',
};

function normalizeKind(k: string): string {
  return KIND_MAP[k] ?? k;
}

function actionText(row: FeedRow): React.ReactNode {
  const ref = row.refId ?? '?';
  const agentLink = (id: string) => (
    <Link href={`/agents/${id}`} className="text-fg hover:text-accent transition-colors">
      Agent #{id}
    </Link>
  );
  const jobLink = (id: string) => (
    <Link href={`/jobs/${id}`} className="text-fg hover:text-accent transition-colors">
      Job #{id}
    </Link>
  );

  switch (row.kind) {
    case 'AgentRegistered':
      return (
        <>
          {agentLink(ref)}
          <span className="text-fg-dim mx-1.5">→</span>
          <span className="text-fg-mute">
            registered{row.extra ? ` as "${row.extra}"` : ''}
          </span>
        </>
      );
    case 'FeedbackGiven':
      return (
        <>
          {agentLink(ref)}
          <span className="text-fg-dim mx-1.5">→</span>
          <span className="text-fg-mute">
            feedback recorded{row.extra ? ` · score ${row.extra}` : ''}
          </span>
        </>
      );
    case 'JobCreated':
      return (
        <>
          {jobLink(ref)}
          <span className="text-fg-dim mx-1.5">→</span>
          <span className="text-fg-mute">new job posted</span>
        </>
      );
    case 'JobCompleted':
      return (
        <>
          {jobLink(ref)}
          <span className="text-fg-dim mx-1.5">→</span>
          <span className="text-accent">USDC released</span>
        </>
      );
    case 'JobSubmitted':
      return (
        <>
          {jobLink(ref)}
          <span className="text-fg-dim mx-1.5">→</span>
          <span className="text-fg-mute">deliverable submitted</span>
        </>
      );
    case 'JobFunded':
      return (
        <>
          {jobLink(ref)}
          <span className="text-fg-dim mx-1.5">→</span>
          <span className="text-fg-mute">escrow funded</span>
        </>
      );
    case 'BudgetSet':
      return (
        <>
          {jobLink(ref)}
          <span className="text-fg-dim mx-1.5">→</span>
          <span className="text-fg-mute">budget set</span>
        </>
      );
    case '__compact__':
      return (
        <span className="text-fg-mute">
          batched block · multiple events
        </span>
      );
    default:
      return <span className="text-fg-mute">{row.kind}</span>;
  }
}

function EventPill({ kind }: { kind: string }) {
  const style = PILL_STYLE[kind] ?? 'bg-fg-mute/10 text-fg-mute border-border-hi';
  const label = PILL_LABEL[kind] ?? kind.toUpperCase().slice(0, 8);
  return (
    <span
      className={cn(
        'font-mono text-[10px] tracking-[0.1em] px-2 py-0.5 rounded border',
        'shrink-0 whitespace-nowrap',
        style,
      )}
    >
      {label}
    </span>
  );
}

function FeedRowItem({ row }: { row: FeedRow }) {
  const ago =
    row.timestamp !== null ? formatRelative(row.timestamp) : null;
  const blockLabel = `#${row.block.toLocaleString()}`;

  return (
    <li
      className={cn(
        'px-4 py-3 flex items-center gap-3 text-sm',
        row.isLive && 'row-enter',
      )}
    >
      <div className="font-mono text-[11px] w-24 shrink-0 leading-tight">
        <div className={cn('text-fg', !ago && 'text-fg-dim')}>
          {ago ?? blockLabel}
        </div>
        {ago ? (
          <div className="text-fg-dim text-[10px]">{blockLabel}</div>
        ) : null}
      </div>
      <EventPill kind={row.kind} />
      <div className="flex-1 min-w-0 truncate">
        {actionText(row)}
      </div>
    </li>
  );
}

function dedupeKey(kind: string, block: string | number, refId: string | null) {
  return `${block}-${kind}-${refId ?? 'na'}`;
}

export function LiveFeedClient({ seed }: { seed: SeedEvent[] }) {
  useNowTick(1000);
  const { events, isConnected } = useLive();

  const merged: FeedRow[] = useMemo(() => {
    const out: FeedRow[] = [];
    const seenKeys = new Set<string>();

    // Live events first.
    for (const ev of events as LiveEvent[]) {
      const kind = normalizeKind(ev.kind);
      const refId =
        (ev.agentId as string | undefined) ??
        (ev.jobId as string | undefined) ??
        null;
      const key = dedupeKey(kind, ev.blockNumber, refId);
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      out.push({
        key,
        kind,
        block: Number(ev.blockNumber),
        refId,
        actor: null,
        extra: null,
        timestamp: Number(ev.timestamp),
        isLive: true,
      });
    }

    // Then seeded historical events to fill remaining slots.
    for (const s of seed) {
      const kind = normalizeKind(String(s.kind));
      const key = dedupeKey(kind, String(s.block ?? '0'), s.ref_id);
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      out.push({
        key,
        kind,
        block: Number(s.block ?? 0),
        refId: s.ref_id,
        actor: s.actor,
        extra: s.extra,
        timestamp: null,
        isLive: false,
      });
    }

    return out.slice(0, 6);
  }, [events, seed]);

  // Always render at least 3 visual rows.
  const visibleRows = merged.slice(0, Math.max(3, Math.min(merged.length, 6)));
  const placeholdersNeeded = Math.max(0, 3 - visibleRows.length);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h2 className="font-mono text-xs uppercase tracking-[0.12em] text-fg-dim">
            //live_feed
          </h2>
          <span
            className={cn(
              'live-pulse',
              !isConnected && 'opacity-40 [&::after]:!hidden',
            )}
            aria-hidden
          />
          <span className="font-mono text-[11px] tracking-[0.1em] text-accent">
            LIVE
          </span>
        </div>
        <Link
          href="/live"
          className="text-xs text-fg-dim hover:text-accent transition-colors font-mono"
        >
          full feed →
        </Link>
      </div>
      <div className="border border-border rounded-xl bg-bg-elev overflow-hidden">
        {merged.length === 0 ? (
          <EmptyState />
        ) : (
          <ul className="divide-y divide-border">
            {visibleRows.map((row) => (
              <FeedRowItem key={row.key} row={row} />
            ))}
            {Array.from({ length: placeholdersNeeded }).map((_, i) => (
              <li
                key={`placeholder-${i}`}
                className="px-4 py-3 text-sm text-fg-dim font-mono"
              >
                <span className="text-fg-dim/60">// awaiting next event…</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="px-6 py-10 text-center">
      <div className="inline-flex items-center gap-2 font-mono text-xs text-fg-dim tracking-[0.1em] uppercase">
        <span className="live-pulse opacity-40 [&::after]:!hidden" aria-hidden />
        Indexer connecting
      </div>
      <p className="mt-2 text-sm text-fg-mute">
        Waiting for the first block since you opened this page.
      </p>
    </div>
  );
}
