'use client';

import { useEffect, useState } from 'react';

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
};

export function LiveFeedWidget() {
  const [events, setEvents] = useState<LiveEvent[]>([]);

  useEffect(() => {
    const es = new EventSource('/api/live');

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

        setEvents((prev) => [...newItems, ...prev].slice(0, 8));
      } catch {
        // ignore parse errors
      }
    });

    es.onerror = () => {
      // SSE auto-reconnects
    };

    return () => es.close();
  }, []);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Live Activity</h2>
        <div className="flex items-center gap-1.5 text-xs text-success">
          <span className="w-2 h-2 rounded-full bg-success animate-pulse" />
          Live
        </div>
      </div>
      <div className="border border-border rounded-lg">
        {events.length === 0 ? (
          <div className="p-4 text-text-dim text-sm">
            Waiting for next event...
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {events.map((ev, i) => {
              const isCompact = ev.kind === '__compact__';
              return (
                <li
                  key={`${ev.blockNumber}-${i}`}
                  className="px-4 py-3 text-sm flex items-start gap-3"
                >
                  <span>{ICONS[ev.kind] ?? '⚡'}</span>
                  <div className="flex-1 min-w-0">
                    <p>
                      {isCompact
                        ? `${ev.eventCount} events in block ${ev.blockNumber}`
                        : (LABELS[ev.kind] ?? ev.kind)}
                    </p>
                    <p className="text-xs text-text-dim">
                      Block {ev.blockNumber}
                      {isCompact && ev.eventKinds
                        ? ` · ${ev.eventKinds.join(', ')}`
                        : ''}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <a
        href="/live"
        className="text-brand text-sm mt-3 inline-block hover:underline"
      >
        Watch live feed →
      </a>
    </div>
  );
}
