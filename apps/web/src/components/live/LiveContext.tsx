'use client';

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

export interface LiveEvent {
  kind: string;
  blockNumber: string;
  /** Server-sent epoch milliseconds. */
  timestamp: number;
  agentId?: string;
  jobId?: string;
  eventCount?: number;
  eventKinds?: string[];
  [key: string]: unknown;
}

interface LiveContextValue {
  /** Most recent block number observed (from SSE or initial seed). */
  lastBlock: string | null;
  /** Epoch ms of the most recent SSE event. Null if only seeded from /api/feed. */
  lastEventAt: number | null;
  /** Rolling buffer, newest first. Capped at MAX_BUFFER. */
  events: LiveEvent[];
  isConnected: boolean;
}

const MAX_BUFFER = 12;

const LiveContext = createContext<LiveContextValue>({
  lastBlock: null,
  lastEventAt: null,
  events: [],
  isConnected: false,
});

export function LiveProvider({ children }: { children: React.ReactNode }) {
  const [lastBlock, setLastBlock] = useState<string | null>(null);
  const [lastEventAt, setLastEventAt] = useState<number | null>(null);
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [isConnected, setConnected] = useState(false);
  const seededRef = useRef(false);

  // Seed initial last-block from /api/feed once on mount so the nav cursor
  // has something to show before the first SSE event arrives. Block-only —
  // no relative timestamp until live data lands.
  useEffect(() => {
    if (seededRef.current) return;
    seededRef.current = true;
    fetch('/api/feed', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const first = data?.feed?.[0];
        if (first?.block && lastBlock === null) {
          setLastBlock(String(first.block));
        }
      })
      .catch(() => {
        /* ignore — SSE will eventually populate */
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const es = new EventSource('/api/live');

    es.onopen = () => setConnected(true);

    es.addEventListener('arc_event', (e) => {
      try {
        const payload = JSON.parse((e as MessageEvent).data);
        const incoming: LiveEvent[] = Array.isArray(payload.events)
          ? payload.events.map((ev: Record<string, unknown>) => ({
              ...ev,
              kind: String(ev.kind ?? ev.type ?? 'unknown'),
              blockNumber: String(payload.blockNumber),
              timestamp: Number(payload.timestamp),
            }))
          : [
              {
                kind: '__compact__',
                blockNumber: String(payload.blockNumber),
                timestamp: Number(payload.timestamp),
                eventCount: payload.eventCount as number,
                eventKinds: payload.eventKinds as string[],
              },
            ];

        setEvents((prev) => [...incoming, ...prev].slice(0, MAX_BUFFER));
        setLastBlock(String(payload.blockNumber));
        setLastEventAt(Number(payload.timestamp));
      } catch {
        /* ignore parse errors */
      }
    });

    es.onerror = () => {
      setConnected(false);
      // SSE auto-reconnects on its own.
    };

    return () => es.close();
  }, []);

  const value = useMemo<LiveContextValue>(
    () => ({ lastBlock, lastEventAt, events, isConnected }),
    [lastBlock, lastEventAt, events, isConnected],
  );

  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

export function useLive() {
  return useContext(LiveContext);
}

/**
 * Tick-rerender hook for "Xs ago" formatting. Returns a number that
 * increments every `intervalMs` so any consumer that reads Date.now()
 * inline will rerender on each tick.
 */
export function useNowTick(intervalMs = 1000) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
}

export function formatRelative(ms: number | null): string | null {
  if (ms === null) return null;
  const diff = Math.max(0, Date.now() - ms);
  if (diff < 5_000) return 'just now';
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return `${Math.floor(diff / 3_600_000)}h ago`;
}
