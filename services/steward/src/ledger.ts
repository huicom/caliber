// Ledger writes + pg_notify fan-out.
//
// EVERY pipeline outcome lands as one steward_payments row, and EVERY insert is
// followed by a pg_notify('steward_events', …) so the web console's SSE feed
// updates live. The NOTIFY payload contract below is consumed verbatim by a
// console agent — DO NOT change key names/shape without coordinating.
//
// pg NOTIFY has an ~8000-byte payload ceiling; we keep payloads well under 7000
// by emitting only the fields the console renders (no detector_hits / evidence
// blobs go over the wire — those stay in the row, fetched on demand).

import { db, sql, stewardPayments, stewardIncidents, stewardApprovals } from '@arc-agents/db';
import type { NewStewardPayment, NewStewardIncident, NewStewardApproval } from '@arc-agents/db';

const CHANNEL = 'steward_events';

/** Fire one NOTIFY, guarding the payload size. Best-effort: never throws. */
async function notify(payload: Record<string, unknown>): Promise<void> {
  try {
    let json = JSON.stringify(payload);
    if (json.length > 7000) {
      // Shouldn't happen with the trimmed shapes below, but never blow the cap.
      json = JSON.stringify({ kind: (payload as { kind?: string }).kind ?? 'event' });
    }
    await sql`select pg_notify(${CHANNEL}, ${json})`;
  } catch (err) {
    console.error('[steward] pg_notify failed (non-fatal):', err);
  }
}

/** Insert one ledger row, fire its NOTIFY, and return the new row. */
export async function writePayment(row: NewStewardPayment): Promise<{ id: bigint }> {
  const [inserted] = await db.insert(stewardPayments).values(row).returning();
  await notify({
    kind: 'payment',
    payment: {
      id: inserted.id.toString(),
      createdAt: inserted.createdAt.toISOString(),
      host: inserted.host,
      sellerUrl: inserted.sellerUrl,
      quotedUsdc: inserted.quotedUsdc,
      settledUsdc: inserted.settledUsdc,
      decision: inserted.decision,
      decisionStage: inserted.decisionStage,
      reasoning: inserted.reasoning,
      payTo: inserted.payTo,
      source: inserted.source,
    },
  });
  return { id: inserted.id };
}

/** Insert one incident row, fire its NOTIFY, and return the new row id. */
export async function writeIncident(row: NewStewardIncident): Promise<{ id: bigint }> {
  const [inserted] = await db.insert(stewardIncidents).values(row).returning();
  await notify({
    kind: 'incident',
    incident: {
      id: inserted.id.toString(),
      kind: inserted.kind,
      severity: inserted.severity,
      host: inserted.host,
    },
  });
  return { id: inserted.id };
}

/** Set the `incident_id` back-reference on a ledger row (no NOTIFY). */
export async function linkIncident(paymentId: bigint, incidentId: bigint): Promise<void> {
  // postgres-js binds the text form; Postgres casts to bigint on assignment.
  await sql`update steward_payments set incident_id = ${incidentId.toString()} where id = ${paymentId.toString()}`;
}

/**
 * Insert one approval row for a held payment, fire its NOTIFY, return the id.
 * NOTE: the 'approval' NOTIFY kind is NEW (joins payment/incident/freeze on the
 * steward_events channel) — keep the shape stable for the console listener.
 */
export async function writeApproval(
  row: NewStewardApproval,
  reasoning: string,
): Promise<{ id: bigint }> {
  const [inserted] = await db.insert(stewardApprovals).values(row).returning();
  await notify({
    kind: 'approval',
    approval: {
      id: inserted.id.toString(),
      status: inserted.status,
      paymentId: inserted.paymentId.toString(),
      reasoning,
    },
  });
  return { id: inserted.id };
}

/** Fire an 'approval' NOTIFY for a status change (decide/expire). Best-effort. */
export async function notifyApproval(
  approvalId: bigint,
  status: string,
  paymentId: bigint,
  reasoning: string,
): Promise<void> {
  await notify({
    kind: 'approval',
    approval: {
      id: approvalId.toString(),
      status,
      paymentId: paymentId.toString(),
      reasoning,
    },
  });
}
