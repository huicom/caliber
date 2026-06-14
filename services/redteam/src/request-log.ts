// In-memory ring buffer of recent gated requests. Deliberately NOT the
// metered_payments table — the fixture stays standalone (no @arc-agents/db dep).

import type { Mode } from './modes.js';

export interface LoggedRequest {
  timestamp: string;
  mode: Mode;
  /** 'paid' once a payment verified+settled, 'bypass' for the 402 challenge (no payment header). */
  outcome: 'paid' | 'bypass';
  /** Price string for the mode (e.g. '$0.001'). */
  amount: string;
  /** Recipient that the payment settled to (or would settle to). */
  recipient: string;
}

const MAX = 200;
const log: LoggedRequest[] = [];

export function record(entry: LoggedRequest): void {
  log.push(entry);
  if (log.length > MAX) log.splice(0, log.length - MAX);
}

/** Most-recent-first snapshot. */
export function recent(): LoggedRequest[] {
  return [...log].reverse();
}
