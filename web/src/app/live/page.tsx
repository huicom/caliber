'use client';

import { useEffect, useState, useRef, useMemo } from 'react';
import Link from 'next/link';
import { Pause, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Eyebrow } from '@/components/ui/Eyebrow';
import { formatRelative, useNowTick } from '@/components/live/LiveContext';
import { cn } from '@/lib/utils';

interface LiveEvent {
  kind: string;
  blockNumber: string;
  timestamp: number;
  agentId?: string;
  jobId?: string;
  eventCount?: number;
  eventKinds?: string[];
  [key: string]: unknown;
}

type FilterKey = 'all' | 'agents' | 'jobs' | 'feedback' | 'validations';

const PILL_STYLE: Record<string, string> = {
  AgentRegistered: 'bg-accent/15 text-accent border-accent/30',
  FeedbackGiven: 'bg-warn/15 text-warn border-warn/30',
  JobCreated: 'bg-accent-2/15 text-accent-2 border-accent-2/30',
  JobCompleted: 'bg-accent/15 text-accent border-accent/30',
  JobSubmitted: 'bg-fg-mute/10 text-fg-mute border-border-hi',
  JobFunded: 'bg-fg-mute/10 text-fg-mute border-border-hi',
  JobRejected: 'bg-danger/15 text-danger border-danger/30',
  BudgetSet: 'bg-fg-mute/10 text-fg-mute border-border-hi',
  ValidationRequested: 'bg-accent-2/15 text-accent-2 border-accent-2/30',
  ValidationResponded: 'bg-accent/15 text-accent border-accent/30',
  __compact__: 'bg-fg-mute/10 text-fg-mute border-border-hi',
};

const PILL_LABEL: Record<string, string> = {
  AgentRegistered: 'AGENT',
  FeedbackGiven: 'FEEDBACK',
  JobCreated: 'JOB',
  JobCompleted: 'PAID',
  JobSubmitted: 'DELIVERY',
  JobFunded: 'ESCROW',
  JobRejected: 'REJECTED',
  BudgetSet: 'BUDGET',
  ValidationRequested: 'VALIDATE',
  ValidationResponded: 'VERIFIED',
  __compact__: 'BLOCK',
};

const FILTER_MATCHES: Record<FilterKey, (kind: string) => boolean> = {
  all: () => true,
  agents: (k) => k === 'AgentRegistered',
  jobs: (k) =>
    [
      'JobCreated',
      'BudgetSet',
      'JobFunded',
      'JobSubmitted',
      'JobCompleted',
      'JobRejected',
    ].includes(k),
  feedback: (k) => k === 'FeedbackGiven',
  validations: (k) => k === 'ValidationRequested' || k === 'ValidationResponded',
};

function eventLink(ev: LiveEvent): string | null {
  if (ev.kind === '__compact__') return null;
  if (ev.kind === 'AgentRegistered' && ev.agentId) return `/agents/${ev.agentId}`;
  if (
    (ev.kind === 'FeedbackGiven' ||
      ev.kind === 'ValidationRequested' ||
      ev.kind === 'ValidationResponded') &&
    ev.agentId
  )
    return `/agents/${ev.agentId}`;
  if (ev.jobId) return `/jobs/${ev.jobId}`;
  return null;
}

function actionText(ev: LiveEvent): React.ReactNode {
  if (ev.kind === '__compact__') {
    return (
      <span className="text-fg-mute">
        batched block · {ev.eventCount ?? 0} events
        {ev.eventKinds?.length ? ` · ${ev.eventKinds.join(', ')}` : ''}
      </span>
    );
  }
  const agentRef = ev.agentId ? `Agent #${ev.agentId}` : null;
  const jobRef = ev.jobId ? `Job #${ev.jobId}` : null;
  const subject = agentRef ?? jobRef ?? '—';
  const action: Record<string, string> = {
    AgentRegistered: 'registered',
    FeedbackGiven: 'received feedback',
    JobCreated: 'created',
    JobCompleted: 'completed · USDC released',
    JobSubmitted: 'deliverable submitted',
    JobFunded: 'escrow funded',
    JobRejected: 'rejected',
    BudgetSet: 'budget set',
    ValidationRequested: 'validation requested',
    ValidationResponded: 'validation answered',
  };
  return (
    <>
      <span className="text-fg">{subject}</span>
      <span className="text-fg-dim mx-2">→</span>
      <span className="text-fg-mute">
        {action[ev.kind] ?? ev.kind.toLowerCase()}
      </span>
    </>
  );
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

function EventRow({ ev, isFirst }: { ev: LiveEvent; isFirst: boolean }) {
  useNowTick(1000);
  const ago = formatRelative(ev.timestamp) ?? 'just now';
  const blockLabel = `#${Number(ev.blockNumber).toLocaleString()}`;
  const link = eventLink(ev);
  const body = (
    <div
      className={cn(
        'group flex items-center gap-4 px-5 py-3.5 text-sm',
        'transition-colors',
        link && 'hover:bg-bg-elev-2 cursor-pointer',
        isFirst && 'row-enter',
      )}
    >
      <div className="font-mono text-[11px] w-24 shrink-0 leading-tight">
        <div className="text-fg">{ago}</div>
        <div className="text-fg-dim text-[10px]">{blockLabel}</div>
      </div>
      <EventPill kind={ev.kind} />
      <div className="flex-1 min-w-0 truncate">{actionText(ev)}</div>
    </div>
  );
  return link ? <Link href={link}>{body}</Link> : body;
}

export default function LivePage() {
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [paused, setPaused] = useState(false);
  const [filter, setFilter] = useState<FilterKey>('all');
  const totalRef = useRef(0);
  const pausedRef = useRef(false);
  const pausedQueue = useRef<LiveEvent[]>([]);
  const lastSeenKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const es = new EventSource('/api/live');
    es.addEventListener('connected', () => setConnected(true));
    es.addEventListener('ping', () => setConnected(true));

    es.addEventListener('arc_event', (e) => {
      try {
        const payload = JSON.parse((e as MessageEvent).data);
        let newItems: LiveEvent[];

        if (Array.isArray(payload.events)) {
          newItems = payload.events.map((ev: Record<string, unknown>) => ({
            ...ev,
            kind: String(ev.kind ?? ev.type ?? 'unknown'),
            blockNumber: String(payload.blockNumber),
            timestamp: Number(payload.timestamp),
          }));
        } else {
          newItems = [
            {
              kind: '__compact__',
              blockNumber: String(payload.blockNumber),
              timestamp: Number(payload.timestamp),
              eventCount: payload.eventCount as number,
              eventKinds: payload.eventKinds as string[],
            },
          ];
        }

        totalRef.current += newItems.length;

        if (pausedRef.current) {
          pausedQueue.current = [...pausedQueue.current, ...newItems];
        } else {
          setEvents((prev) => [...newItems, ...prev].slice(0, 200));
          if (newItems[0]) {
            lastSeenKeyRef.current = `${newItems[0].blockNumber}-${newItems[0].kind}`;
          }
        }
      } catch {
        // ignore
      }
    });

    es.onerror = () => setConnected(false);
    return () => es.close();
  }, []);

  const togglePause = () => {
    if (pausedRef.current && pausedQueue.current.length > 0) {
      setEvents((prev) =>
        [...pausedQueue.current, ...prev].slice(0, 200),
      );
      pausedQueue.current = [];
    }
    pausedRef.current = !pausedRef.current;
    setPaused((p) => !p);
  };

  const display = useMemo(
    () => events.filter((e) => FILTER_MATCHES[filter](e.kind)).slice(0, 200),
    [events, filter],
  );

  const filters: Array<{ key: FilterKey; label: string }> = [
    { key: 'all', label: 'All' },
    { key: 'agents', label: 'Agents' },
    { key: 'jobs', label: 'Jobs' },
    { key: 'feedback', label: 'Feedback' },
    { key: 'validations', label: 'Validations' },
  ];

  return (
    <main className="mx-auto max-w-[1200px] px-6 md:px-12 pt-12 pb-24">
      {/* === Header === */}
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6 mb-10">
        <div>
          <Eyebrow variant="curly" className="mb-5">
            live_feed
          </Eyebrow>
          <h1 className="text-3xl md:text-4xl font-semibold tracking-tight text-fg">
            Every event,{' '}
            <span className="text-accent">as it lands.</span>
          </h1>
          <p className="mt-3 text-fg-mute text-sm md:text-base max-w-xl">
            Real-time stream of ERC-8004 registry events from our Bangkok-based
            Arc node. New rows slide in at the top.
          </p>
        </div>

        {/* === Status + pause === */}
        <div className="flex items-center gap-3 shrink-0">
          <div
            className={cn(
              'flex items-center gap-2 px-3 py-1.5 rounded-lg border',
              'font-mono text-[11px] tracking-[0.1em] uppercase',
              connected
                ? 'border-accent/30 text-accent bg-accent/5'
                : 'border-danger/30 text-danger bg-danger/5',
            )}
          >
            <span
              className={cn(
                connected ? 'live-pulse' : '',
                'w-2 h-2 rounded-full',
                !connected && 'bg-danger',
              )}
              aria-hidden
            />
            {connected ? 'connected' : 'disconnected'}
          </div>
          <Button variant="ghost" size="sm" onClick={togglePause}>
            {paused ? (
              <>
                <Play /> resume
                {pausedQueue.current.length > 0 && (
                  <span className="ml-1 text-fg-dim">
                    +{pausedQueue.current.length}
                  </span>
                )}
              </>
            ) : (
              <>
                <Pause /> pause
              </>
            )}
          </Button>
        </div>
      </div>

      {/* === Meta strip === */}
      <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2 mb-6 font-mono text-xs">
        <span className="text-fg-dim">
          <span className="text-fg-dim">//</span>
          <span className="text-fg-mute uppercase tracking-[0.1em]">streamed</span>
          <span className="ml-2 text-fg tabular-nums">
            {totalRef.current.toLocaleString()}
          </span>
          <span className="ml-1 text-fg-dim">this session</span>
        </span>
        <span className="text-fg-dim">
          <span className="text-fg-dim">//</span>
          <span className="text-fg-mute uppercase tracking-[0.1em]">buffer</span>
          <span className="ml-2 text-fg tabular-nums">
            {events.length}
          </span>
          <span className="ml-1 text-fg-dim">rows</span>
        </span>
        {paused && pausedQueue.current.length > 0 && (
          <span className="text-warn">
            <span className="text-fg-dim">//</span>
            <span className="uppercase tracking-[0.1em]">queued</span>
            <span className="ml-2 tabular-nums">
              {pausedQueue.current.length}
            </span>
          </span>
        )}
      </div>

      {/* === Filters === */}
      <div className="flex flex-wrap items-center gap-2 mb-6">
        {filters.map((f) => {
          const active = filter === f.key;
          return (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                'font-mono text-[11px] uppercase tracking-[0.1em] px-3 py-1.5 rounded border transition-colors',
                active
                  ? 'border-accent bg-accent/15 text-accent'
                  : 'border-border bg-bg-elev text-fg-mute hover:text-fg hover:border-border-hi',
              )}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {/* === Event list === */}
      <div className="border border-border rounded-xl bg-bg-elev overflow-hidden">
        {display.length === 0 ? (
          <div className="px-8 py-16 text-center">
            <div className="inline-flex items-center gap-2 font-mono text-xs uppercase tracking-[0.1em] text-fg-dim">
              <span
                className={cn(
                  connected ? 'live-pulse' : '',
                  'w-2 h-2 rounded-full',
                  !connected && 'bg-danger',
                )}
                aria-hidden
              />
              {connected ? 'awaiting next event' : 'reconnecting'}
            </div>
            <p className="mt-2 text-sm text-fg-mute">
              {filter === 'all'
                ? 'Events appear here in real time as the indexer processes blocks.'
                : `No ${filter} events received this session yet — try another filter or wait.`}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {display.map((ev, i) => (
              <li key={`${ev.blockNumber}-${ev.kind}-${ev.agentId ?? ev.jobId ?? i}`}>
                <EventRow ev={ev} isFirst={i === 0} />
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="mt-6 font-mono text-[11px] tracking-[0.05em] text-fg-dim">
        // showing latest {display.length} of {events.length} buffered ·
        max 200 rows in memory · auto-reconnects on network drop
      </p>
    </main>
  );
}
