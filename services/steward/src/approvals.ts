// Hold/approval lifecycle (Steward Phase 1, task 16).
//
// Every HOLD the pipeline reaches enqueues a steward_approvals row (status
// 'pending', expires in 30m) and stores the original request in
// steward_payments.request_init. This module is the other half: list the pending
// approvals with payment context, and DECIDE them.
//
//   deny    → status 'denied'; nothing executes.
//   approve → status 'approved'; for a new-counterparty hold, mark the
//             counterparty trusted; then RE-EXECUTE the stored request through
//             the pipeline with a one-shot bypass that suppresses EXACTLY the
//             rule(s) that caused this hold (other rules still apply; freeze
//             still wins). A NEW ledger row is written, reasoning prefixed
//             "approved hold #<id>: …".
//   expired → expires_at in the past → reject 410 and mark 'expired'.

import { db, sql, stewardApprovals, stewardPayments } from '@arc-agents/db';
import type { StewardApproval, StewardPayment } from '@arc-agents/db';
import { eq } from 'drizzle-orm';
import { trustCounterparty } from './counterparties.js';
import { reactivateRoute } from './routes-state.js';
import { notifyApproval } from './ledger.js';
import type { StewardPipeline, PayIntent, PayOutcome, ApprovedContext, SignedSpec } from './pipeline.js';
import type { DeliverySpec } from '@caliber/steward-core';
import type { Hex } from 'viem';

/**
 * WS-1 — rehydrate a signed DeliverySpec stored on a held payment. JSON
 * serialization (via the BigInt.toJSON monkeypatch) turned the spec's bigint
 * fields into strings; coerce validUntil/nonce back to bigint so the replayed
 * intent re-verifies + re-hashes identically. Returns undefined for the legacy
 * (no-spec) held rows.
 */
function reReadSpec(stored: unknown): SignedSpec | undefined {
  if (!stored || typeof stored !== 'object') return undefined;
  const s = stored as { spec?: Record<string, unknown>; buyerSig?: unknown; sellerSig?: unknown };
  if (!s.spec || typeof s.buyerSig !== 'string') return undefined;
  const raw = s.spec;
  const spec: DeliverySpec = {
    chain: raw.chain as Hex,
    buyer: raw.buyer as DeliverySpec['buyer'],
    seller: raw.seller as DeliverySpec['seller'],
    sellerUrlHash: raw.sellerUrlHash as Hex,
    schemaHash: raw.schemaHash as Hex,
    maxBytes: Number(raw.maxBytes),
    deadlineMs: Number(raw.deadlineMs),
    requireJson: Boolean(raw.requireJson),
    requireOkField: Boolean(raw.requireOkField),
    validUntil: BigInt(raw.validUntil as string | number),
    nonce: BigInt(raw.nonce as string | number),
  };
  return {
    spec,
    buyerSig: s.buyerSig as Hex,
    sellerSig: typeof s.sellerSig === 'string' ? (s.sellerSig as Hex) : undefined,
  };
}

/** Shape returned by GET /v1/approvals. */
export interface ApprovalListItem {
  id: string;
  status: string;
  paymentId: string;
  incidentId: string | null;
  requestedAt: string;
  expiresAt: string | null;
  decidedAt: string | null;
  decidedVia: string | null;
  payment: {
    host: string;
    sellerUrl: string;
    payTo: string | null;
    quotedUsdc: string | null;
    decisionStage: string;
    reasoning: string | null;
  } | null;
}

/** List approvals, optionally filtered by status (default 'pending'). */
export async function listApprovals(status?: string): Promise<ApprovalListItem[]> {
  const rows = await sql<
    {
      id: string;
      status: string;
      payment_id: string;
      incident_id: string | null;
      requested_at: string;
      expires_at: string | null;
      decided_at: string | null;
      decided_via: string | null;
      host: string;
      seller_url: string;
      pay_to: string | null;
      quoted_usdc: string | null;
      decision_stage: string;
      reasoning: string | null;
    }[]
  >`
    select
      a.id::text, a.status, a.payment_id::text, a.incident_id::text,
      a.requested_at::text, a.expires_at::text, a.decided_at::text, a.decided_via,
      p.host, p.seller_url, p.pay_to, p.quoted_usdc::text as quoted_usdc,
      p.decision_stage, p.reasoning
    from steward_approvals a
    join steward_payments p on p.id = a.payment_id
    ${status ? sql`where a.status = ${status}` : sql``}
    order by a.requested_at desc
    limit 200
  `;
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    paymentId: r.payment_id,
    incidentId: r.incident_id,
    requestedAt: r.requested_at,
    expiresAt: r.expires_at,
    decidedAt: r.decided_at,
    decidedVia: r.decided_via,
    payment: {
      host: r.host,
      sellerUrl: r.seller_url,
      payTo: r.pay_to,
      quotedUsdc: r.quoted_usdc,
      decisionStage: r.decision_stage,
      reasoning: r.reasoning,
    },
  }));
}

/** Result of a decide call (shaped for the HTTP route). */
export interface DecideResult {
  httpStatus: number;
  body: Record<string, unknown>;
}

/**
 * Derive the one-shot bypass for an approved hold from the held payment row:
 * which rule(s) to suppress on re-execution, and whether a route needs
 * reactivating.
 */
function bypassFor(payment: StewardPayment): { suppress: string[]; reactivateRoute: boolean } {
  const hits = (payment.detectorHits as { detector?: string }[] | null) ?? [];
  const detector = hits[0]?.detector;

  if (detector === 'route_pause') return { suppress: ['route_paused'], reactivateRoute: true };
  if (detector === 'runaway_loop') return { suppress: ['runaway_loop'], reactivateRoute: true };
  if (detector === 'price_spike') return { suppress: ['price_spike'], reactivateRoute: false };

  // Policy holds (stage 'approval'): the rule is the leading token of reasoning,
  // e.g. "new_counterparty: first payment …" or "approval_threshold: …".
  const rule = payment.reasoning?.split(':')[0]?.trim();
  if (rule) return { suppress: [rule], reactivateRoute: false };

  // Fallback: suppress nothing recognizable — re-execution will likely re-hold.
  return { suppress: [], reactivateRoute: false };
}

/**
 * Decide a held approval. `pipeline` is needed to re-execute the stored request
 * on approve.
 */
export async function decideApproval(
  approvalId: bigint,
  decision: 'approve' | 'deny',
  via: 'web' | 'telegram',
  pipeline: StewardPipeline,
): Promise<DecideResult> {
  const [approval] = (await db
    .select()
    .from(stewardApprovals)
    .where(eq(stewardApprovals.id, approvalId))) as StewardApproval[];

  if (!approval) {
    return { httpStatus: 404, body: { error: 'not_found', message: `no approval #${approvalId}` } };
  }
  if (approval.status !== 'pending') {
    return {
      httpStatus: 409,
      body: { error: 'already_decided', message: `approval #${approvalId} is ${approval.status}`, status: approval.status },
    };
  }

  // Expiry: a pending approval past its expires_at is rejected (410) and marked.
  if (approval.expiresAt && approval.expiresAt.getTime() <= Date.now()) {
    await db
      .update(stewardApprovals)
      .set({ status: 'expired', decidedAt: new Date(), decidedVia: via })
      .where(eq(stewardApprovals.id, approvalId));
    await notifyApproval(approvalId, 'expired', approval.paymentId, 'approval expired before decision');
    return {
      httpStatus: 410,
      body: { error: 'expired', message: `approval #${approvalId} expired`, status: 'expired' },
    };
  }

  const [payment] = (await db
    .select()
    .from(stewardPayments)
    .where(eq(stewardPayments.id, approval.paymentId))) as StewardPayment[];

  if (decision === 'deny') {
    await db
      .update(stewardApprovals)
      .set({ status: 'denied', decidedAt: new Date(), decidedVia: via })
      .where(eq(stewardApprovals.id, approvalId));
    await notifyApproval(approvalId, 'denied', approval.paymentId, payment?.reasoning ?? 'denied');
    return {
      httpStatus: 200,
      body: { approval: { id: approvalId.toString(), status: 'denied', paymentId: approval.paymentId.toString() } },
    };
  }

  // ── approve ────────────────────────────────────────────────────────────────
  if (!payment || !payment.requestInit) {
    return {
      httpStatus: 422,
      body: { error: 'no_request_init', message: `payment #${approval.paymentId} has no stored request to re-execute` },
    };
  }

  const bypass = bypassFor(payment);

  // Mark the approval approved first so a re-execution failure doesn't leave it
  // pending forever.
  await db
    .update(stewardApprovals)
    .set({ status: 'approved', decidedAt: new Date(), decidedVia: via })
    .where(eq(stewardApprovals.id, approvalId));
  await notifyApproval(approvalId, 'approved', approval.paymentId, payment.reasoning ?? 'approved');

  // For a new-counterparty hold, mark the counterparty trusted+registered so the
  // re-execution (and all future payments) sail through.
  const suppressedNewCp = bypass.suppress.includes('new_counterparty');
  if (suppressedNewCp && payment.payTo) {
    await trustCounterparty(payment.payTo, payment.host);
  }
  // For a route-paused / runaway-loop hold, reactivate the route.
  if (bypass.reactivateRoute) {
    await reactivateRoute(payment.host);
  }

  const stored = payment.requestInit as {
    url: string;
    init?: PayIntent['init'];
    source?: string;
    expect?: PayIntent['expect'];
    // WS-1: a held payment may carry a signed spec (bigint fields stored as
    // strings via the JSON round-trip — reReadSpec coerces them back).
    spec?: unknown;
  };
  const intent: PayIntent = {
    url: stored.url,
    init: stored.init,
    source: stored.source,
    expect: stored.expect ?? undefined,
    spec: reReadSpec(stored.spec),
  };
  const approvedCtx: ApprovedContext = {
    approvalId,
    suppress: bypass.suppress,
    routeReactivateHost: bypass.reactivateRoute ? payment.host : undefined,
  };

  let result: PayOutcome;
  try {
    result = await pipeline.run(intent, approvedCtx);
  } catch (err) {
    return {
      httpStatus: 500,
      body: {
        approval: { id: approvalId.toString(), status: 'approved', paymentId: approval.paymentId.toString() },
        execution: { error: 'execution_failed', message: err instanceof Error ? err.message : String(err) },
      },
    };
  }

  return {
    httpStatus: result.httpStatus,
    body: {
      approval: { id: approvalId.toString(), status: 'approved', paymentId: approval.paymentId.toString() },
      execution: result.body,
    },
  };
}
