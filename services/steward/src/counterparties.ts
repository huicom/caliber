// Counterparty registry access — the state the redirect detector reads and that
// trust-on-first-use writes. Keyed by payTo (unique), but the redirect check
// looks one up by HOST: "who have we been paying at this host?".

import { db, sql, stewardCounterparties } from '@arc-agents/db';
import type { StewardCounterparty } from '@arc-agents/db';
import { eq } from 'drizzle-orm';

/** The most-recently-seen registered counterparty for a host, or null. */
export async function findByHost(host: string): Promise<StewardCounterparty | null> {
  const rows = await db
    .select()
    .from(stewardCounterparties)
    .where(eq(stewardCounterparties.host, host.toLowerCase()));
  // A host normally has exactly one registered recipient; if several exist
  // (history), prefer the registered one, else the first.
  const registered = rows.find((r) => r.registered);
  return registered ?? rows[0] ?? null;
}

/**
 * Trust-on-first-use: register a host→payTo pairing the first time we see it.
 * Reached only when the new-counterparty hold did NOT fire (policy
 * newCounterparty='allow', or the rule was suppressed on an approved
 * re-execution). Idempotent on the payTo unique constraint.
 */
export async function registerFirstUse(payTo: string, host: string): Promise<void> {
  await db
    .insert(stewardCounterparties)
    .values({ payTo: payTo.toLowerCase(), host: host.toLowerCase(), registered: true })
    .onConflictDoNothing({ target: stewardCounterparties.payTo });
}

/**
 * Mark a counterparty trusted + registered (approval of a new-counterparty hold).
 * UPSERTs by payTo so it works whether or not TOFU already registered the row.
 * Idempotent.
 */
export async function trustCounterparty(payTo: string, host: string): Promise<void> {
  await sql`
    insert into steward_counterparties (pay_to, host, registered, trusted)
    values (${payTo.toLowerCase()}, ${host.toLowerCase()}, true, true)
    on conflict (pay_to) do update set
      registered = true,
      trusted = true
  `;
}

/** Bump payment_count + total_usdc after a settled payment (upsert by payTo). */
export async function recordSettlement(payTo: string, host: string, amountUsdc: string): Promise<void> {
  await sql`
    insert into steward_counterparties (pay_to, host, registered, payment_count, total_usdc)
    values (${payTo.toLowerCase()}, ${host.toLowerCase()}, true, 1, ${amountUsdc})
    on conflict (pay_to) do update set
      payment_count = steward_counterparties.payment_count + 1,
      total_usdc = steward_counterparties.total_usdc + ${amountUsdc}
  `;
}
