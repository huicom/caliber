import { sql } from '@arc-agents/db';
import type { ParsedEvent } from './parsers';
import { logger } from './logger';

const CHANNEL = 'arc_events';

export interface NotifyPayload {
  blockNumber: string;
  timestamp: number;
  events: Array<{
    kind: ParsedEvent['kind'];
    [key: string]: unknown;
  }>;
}

export async function notifyEvents(blockNumber: bigint, events: ParsedEvent[]): Promise<void> {
  if (events.length === 0) return;

  const payload: NotifyPayload = {
    blockNumber: blockNumber.toString(),
    timestamp: Date.now(),
    events: events.map((e) => {
      return JSON.parse(
        JSON.stringify(e, (_, value) =>
          typeof value === 'bigint' ? value.toString() : value,
        ),
      );
    }),
  };

  const json = JSON.stringify(payload);

  if (json.length > 7000) {
    const compact = {
      blockNumber: payload.blockNumber,
      timestamp: payload.timestamp,
      eventCount: events.length,
      eventKinds: [...new Set(events.map((e) => e.kind))],
    };
    await sql`SELECT pg_notify(${CHANNEL}, ${JSON.stringify(compact)})`;
    logger.info(`Notify (compact) for block ${blockNumber}: ${events.length} events`);
  } else {
    await sql`SELECT pg_notify(${CHANNEL}, ${json})`;
    logger.info(`Notify for block ${blockNumber}: ${events.length} events`);
  }
}
