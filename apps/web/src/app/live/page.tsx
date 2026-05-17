'use client';

import { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Pause, Play, Radio } from 'lucide-react';

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

const ICONS: Record<string, string> = {
  AgentRegistered: '🤖',
  FeedbackGiven: '⭐',
  JobCreated: '💼',
  JobCompleted: '💸',
  JobSubmitted: '📦',
  JobFunded: '🔒',
  BudgetSet: '💰',
  ValidationRequested: '✅',
  ValidationResponded: '📋',
  __compact__: '📡',
};

const LABELS: Record<string, string> = {
  AgentRegistered: 'New agent registered',
  FeedbackGiven: 'Reputation feedback recorded',
  JobCreated: 'New job posted',
  JobCompleted: 'Job completed, USDC released',
  JobSubmitted: 'Deliverable submitted',
  JobFunded: 'Job escrow funded',
  BudgetSet: 'Budget set',
  ValidationRequested: 'Validation requested',
  ValidationResponded: 'Validation response received',
};

function getDetailLink(event: LiveEvent): string | null {
  if (event.kind === '__compact__') return null;
  if (event.kind === 'AgentRegistered' && event.agentId)
    return `/agents/${event.agentId}`;
  if (
    [
      'JobCreated',
      'JobCompleted',
      'JobSubmitted',
      'JobFunded',
      'BudgetSet',
    ].includes(event.kind) &&
    event.jobId
  )
    return `/jobs/${event.jobId}`;
  return null;
}

export default function LivePage() {
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [paused, setPaused] = useState(false);
  const [filter, setFilter] = useState('all');
  const totalRef = useRef(0);
  const pausedRef = useRef(false);
  const pausedQueue = useRef<LiveEvent[]>([]);

  useEffect(() => {
    const es = new EventSource('/api/live');

    es.addEventListener('connected', () => setConnected(true));
    es.addEventListener('ping', () => setConnected(true));

    es.addEventListener('arc_event', (e) => {
      try {
        const payload = JSON.parse((e as MessageEvent).data);
        let newItems: LiveEvent[];

        if (Array.isArray(payload.events)) {
          newItems = payload.events.map(
            (ev: Record<string, unknown>) => ({
              ...ev,
              kind: String(ev.kind ?? ev.type ?? 'unknown'),
              blockNumber: payload.blockNumber,
              timestamp: payload.timestamp,
            }),
          );
        } else {
          newItems = [
            {
              kind: '__compact__',
              blockNumber: payload.blockNumber,
              timestamp: payload.timestamp,
              eventCount: payload.eventCount as number,
              eventKinds: payload.eventKinds as string[],
            },
          ];
        }

        totalRef.current += newItems.length;

        if (pausedRef.current) {
          pausedQueue.current = [
            ...pausedQueue.current,
            ...newItems,
          ];
        } else {
          setEvents((prev) =>
            [...newItems, ...prev].slice(0, 200),
          );
        }
      } catch {
        // ignore parse errors
      }
    });

    es.onerror = () => {
      setConnected(false);
    };

    return () => es.close();
  }, []);

  const togglePause = () => {
    if (pausedRef.current) {
      setEvents((prev) =>
        [...pausedQueue.current, ...prev].slice(0, 200),
      );
      pausedQueue.current = [];
    }
    pausedRef.current = !pausedRef.current;
    setPaused((p) => !p);
  };

  const display = (() => {
    let list = events;
    if (filter === 'agents')
      list = list.filter((e) => e.kind === 'AgentRegistered');
    else if (filter === 'jobs')
      list = list.filter((e) =>
        [
          'JobCreated',
          'JobSubmitted',
          'JobCompleted',
          'JobFunded',
          'BudgetSet',
        ].includes(e.kind),
      );
    else if (filter === 'feedback')
      list = list.filter((e) => e.kind === 'FeedbackGiven');
    return list.slice(0, 200);
  })();

  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <Radio className="w-6 h-6 text-brand" />
            Live Feed
          </h1>
          <p className="text-text-muted mt-1">
            {totalRef.current} events streamed this session
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span
              className={`w-2.5 h-2.5 rounded-full ${
                connected ? 'bg-success animate-pulse' : 'bg-danger'
              }`}
            />
            <span className="text-sm text-text-dim">
              {connected ? 'Connected' : 'Disconnected'}
            </span>
          </div>
          <Button variant="outline" size="sm" onClick={togglePause}>
            {paused ? (
              <>
                <Play className="w-3 h-3" /> Resume
              </>
            ) : (
              <>
                <Pause className="w-3 h-3" /> Pause
              </>
            )}
          </Button>
        </div>
      </div>

      <div className="flex gap-2 mb-6">
        {['all', 'agents', 'jobs', 'feedback'].map((f) => (
          <Badge
            key={f}
            variant={filter === f ? 'default' : 'outline'}
            className="cursor-pointer"
            onClick={() => setFilter(f)}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </Badge>
        ))}
      </div>

      {display.length === 0 && !paused ? (
        <div className="text-center py-16 text-text-dim">
          <div className="text-4xl mb-4">🤖</div>
          <p className="text-lg">Waiting for first event...</p>
          <p className="text-sm mt-2">
            Events appear here in real time as the indexer processes blocks.
          </p>
        </div>
      ) : (
        <div className="space-y-1">
          {display.map((ev, i) => {
            const link = getDetailLink(ev);
            const isCompact = ev.kind === '__compact__';
            const content = (
              <div className="flex items-start gap-4 border-l-2 border-brand pl-4 py-3 hover:bg-bg-muted/50 transition-colors rounded-r-lg cursor-pointer">
                <span className="text-xl mt-0.5">
                  {ICONS[ev.kind] ?? '⚡'}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">
                    {isCompact
                      ? `${ev.eventCount} events in block ${ev.blockNumber}`
                      : (LABELS[ev.kind] ?? ev.kind)}
                  </p>
                  <p className="text-xs text-text-dim">
                    Block {ev.blockNumber}
                    {' · '}
                    {new Date(ev.timestamp).toLocaleTimeString()}
                    {isCompact && ev.eventKinds
                      ? ` · ${ev.eventKinds.join(', ')}`
                      : ''}
                  </p>
                </div>
              </div>
            );
            return link ? (
              <Link key={`${ev.blockNumber}-${i}`} href={link}>
                {content}
              </Link>
            ) : (
              <div key={`${ev.blockNumber}-${i}`}>{content}</div>
            );
          })}
        </div>
      )}
    </main>
  );
}
