// Spend counters for the policy evaluator (Steward Phase 1, task 13).
//
// The daily-cap and per-counterparty-daily-cap rules need to know how much has
// already settled TODAY (UTC). We sum settled_usdc over allowed steward_payments
// created since 00:00 UTC. Only decision='allow' rows count — held/denied
// intents never moved money, so they don't consume the budget.
//
// These are read INSIDE preSign (before the new payment settles), so the current
// intent is never double-counted: it isn't in the ledger yet.

import { sql } from '@arc-agents/db';

/** Total USDC settled today (UTC) across allowed payments, decimal string. */
export async function todaySpentUsdc(): Promise<string> {
  const [{ total }] = await sql<{ total: string }[]>`
    select coalesce(sum(settled_usdc), 0)::text as total
    from steward_payments
    where decision = 'allow'
      and settled_usdc is not null
      and created_at >= date_trunc('day', now() at time zone 'utc')
  `;
  return total;
}

/** USDC settled today (UTC) to a specific recipient, decimal string. */
export async function counterpartyTodayUsdc(payTo: string): Promise<string> {
  const [{ total }] = await sql<{ total: string }[]>`
    select coalesce(sum(settled_usdc), 0)::text as total
    from steward_payments
    where decision = 'allow'
      and settled_usdc is not null
      and pay_to = ${payTo.toLowerCase()}
      and created_at >= date_trunc('day', now() at time zone 'utc')
  `;
  return total;
}
