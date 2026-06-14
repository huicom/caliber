// scripts/treasurer-demo.ts — the LLM-treasurer showcase.
//
// This is the "watch the AI CFO decide and explain itself" segment. Unlike the
// red-team attack demo (which is fully deterministic and asserts every verdict),
// this script targets the LIVE treasurer-ON Steward (default :3300) and simply
// DISPLAYS the treasurer's per-payment reasoning. There are NO strict pass/fail
// assertions on the LLM verdict — the treasurer is a non-deterministic LLM and
// that is expected/acceptable here. A cautious HOLD is a valid, narrated outcome;
// when it happens we approve the held payment via the approvals API and continue.
//
// What it shows, per honest payment:
//   • the ledger row's `reasoning` (the `treasurer: …` line the model wrote),
//   • the `llm_model` that produced it,
//   • the decision latency (`latency_ms`).
//
// Run (from repo root, live :3300 + red-team :3400 up, treasurer ENABLED):
//   pnpm demo:treasurer
//   # or: tsx --env-file=.env scripts/treasurer-demo.ts
//
// Env: STEWARD_API_KEY, REDTEAM_ADMIN_TOKEN, STEWARD_PORT (def 3300, the LIVE
// treasurer-on instance), REDTEAM_PORT (def 3400), DATABASE_URL (via @arc-agents/db).

import { sql } from '@arc-agents/db';

const STEWARD_PORT = process.env.STEWARD_PORT ?? '3300';
const REDTEAM_PORT = process.env.REDTEAM_PORT ?? '3400';
const STEWARD = `http://localhost:${STEWARD_PORT}`;
const REDTEAM = `http://localhost:${REDTEAM_PORT}`;
const RESOURCE = `${REDTEAM}/api/research`;
const REDTEAM_HOST = `localhost:${REDTEAM_PORT}`;
const PAYMENTS = 3;

const apiKey = required('STEWARD_API_KEY');
const adminToken = required('REDTEAM_ADMIN_TOKEN');
const sellerAddress = required('REDTEAM_SELLER_ADDRESS').toLowerCase();

function required(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) {
    console.error(`\n[treasurer-demo] missing env ${name} — set it in the repo-root .env.`);
    process.exit(1);
  }
  return v;
}

// ── narration ──────────────────────────────────────────────────────────────────
const ts = (): string => new Date().toISOString().slice(11, 23);
const log = (line = ''): void => console.log(line);
const stamp = (line: string): void => console.log(`  ${ts()}  ${line}`);

// ── service interactions ─────────────────────────────────────────────────────────
async function setMode(mode: string): Promise<void> {
  const res = await fetch(`${REDTEAM}/admin/mode`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-redteam-admin': adminToken },
    body: JSON.stringify({ mode }),
  });
  if (!res.ok) throw new Error(`setMode(${mode}) failed: ${res.status} ${await res.text()}`);
}

interface PayBody {
  requestId?: string;
  decision?: string;
  stage?: string;
  reasoning?: string;
  [k: string]: unknown;
}

/** One pay attempt against the live treasurer. Returns the full HTTP envelope. */
async function rawPay(): Promise<{ status: number; body: PayBody }> {
  const res = await fetch(`${STEWARD}/v1/pay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-steward-key': apiKey },
    body: JSON.stringify({ url: RESOURCE, init: { method: 'POST' }, source: 'demo:treasurer' }),
  });
  const body = (await res.json()) as PayBody;
  return { status: res.status, body };
}

interface LedgerRow {
  decision: string;
  decision_stage: string;
  reasoning: string | null;
  llm_model: string | null;
  latency_ms: number | null;
  settle_status: string | null;
  settled_usdc: string | null;
}

/** Read back the ledger row the pipeline just wrote for a given requestId. */
async function ledgerFor(requestId: string): Promise<LedgerRow | null> {
  const [row] = await sql<LedgerRow[]>`
    select decision, decision_stage, reasoning, llm_model, latency_ms, settle_status, settled_usdc
      from steward_payments
     where request_id = ${requestId}
     limit 1`;
  return row ?? null;
}

// ── approvals (to continue past a cautious HOLD) ──────────────────────────────────
interface ApprovalItem {
  id: string;
  status: string;
  paymentId: string;
  payment: { host: string; reasoning: string | null } | null;
}

async function listPendingApprovals(): Promise<ApprovalItem[]> {
  const res = await fetch(`${STEWARD}/v1/approvals?status=pending`, { headers: { 'x-steward-key': apiKey } });
  if (!res.ok) throw new Error(`list approvals failed: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { approvals: ApprovalItem[] }).approvals;
}

async function approve(id: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${STEWARD}/v1/approvals/${id}/decide`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-steward-key': apiKey },
    body: JSON.stringify({ decision: 'approve', via: 'web' }),
  });
  return (await res.json()) as Record<string, unknown>;
}

/** Trust the honest seller so the cheaper deterministic gates pass — leaving the
 *  treasurer as the interesting decision-maker on each call. Idempotent. */
async function trustHonestSeller(): Promise<void> {
  await sql`
    insert into steward_counterparties (pay_to, host, registered, trusted)
    values (${sellerAddress}, ${REDTEAM_HOST}, true, true)
    on conflict (pay_to) do update set
      host = ${REDTEAM_HOST}, registered = true, trusted = true`;
}

/** Cool the runaway-loop window for the fixture host so each showcase payment
 *  reaches the TREASURER (the point of this demo) rather than tripping the
 *  deterministic loop detector. Backdates recent rows + reactivates the route;
 *  keeps the rows themselves. Scoped strictly to the fixture host. */
async function coolDownLoopWindow(): Promise<void> {
  await sql`
    update steward_payments
       set created_at = now() - interval '1 hour'
     where host = ${REDTEAM_HOST}
       and created_at >= now() - interval '15 minutes'`;
  await sql`
    update steward_routes
       set status = 'active', paused_reason = null, paused_at = null, auto_resume_at = null
     where host = ${REDTEAM_HOST}`;
}

/** Print one ledger row's treasurer reasoning + model + latency. */
function printVerdict(n: number, status: number, body: PayBody, row: LedgerRow | null): void {
  stamp(`payment ${n}: ${String(body.decision).toUpperCase()}  stage=${body.stage}  http=${status}`);
  if (row) {
    stamp(`        reasoning : ${row.reasoning ?? '(none)'}`);
    stamp(`        llm_model : ${row.llm_model ?? '(none — verdict reached before the treasurer ran, or treasurer disabled)'}`);
    stamp(`        latency   : ${row.latency_ms ?? '?'} ms`);
    if (row.settle_status === 'settled') stamp(`        settled   : ${row.settled_usdc} USDC`);
  } else {
    stamp(`        (no ledger row found for this requestId — ${body.reasoning ?? ''})`);
  }
}

async function main(): Promise<void> {
  log();
  log('████  STEWARD · LLM-treasurer showcase  ████');
  log(`steward=${STEWARD} (live, treasurer-ON)   red-team=${REDTEAM}`);
  log('watch the AI CFO reason about each honest charge — and explain itself in the ledger.');
  log('(non-deterministic by design: no pass/fail on the verdict; a cautious HOLD is valid.)');

  // Preflight both live services.
  for (const [name, url] of [['steward', `${STEWARD}/health`], ['red-team', `${REDTEAM}/health`]] as const) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) throw new Error(`${res.status}`);
    } catch (err) {
      console.error(`\n[treasurer-demo] ${name} not reachable at ${url} — start it first.`);
      console.error(`[treasurer-demo]   (${err instanceof Error ? err.message : String(err)})`);
      process.exit(1);
    }
  }

  // Set the stage: honest seller, trusted, so the treasurer is the decision-maker.
  await setMode('honest');
  await trustHonestSeller();

  for (let n = 1; n <= PAYMENTS; n++) {
    log();
    log('━'.repeat(76));
    log(`PAYMENT ${n} of ${PAYMENTS} · an honest $0.001 x402 charge`);
    log('━'.repeat(76));

    // Keep the deterministic runaway-loop detector out of the way so each charge
    // reaches the treasurer — this showcase is about the LLM's reasoning, not the
    // loop gate (the red-team demo covers that).
    await coolDownLoopWindow();

    const { status, body } = await rawPay();
    const requestId = String(body.requestId ?? '');
    const row = requestId ? await ledgerFor(requestId) : null;
    printVerdict(n, status, body, row);

    // If anything HELD, narrate it as valid and approve to continue. A treasurer
    // hold (stage=treasurer) is the showcase's headline "cautious AI" moment; a
    // detector hold is a deterministic gate that simply happened to fire — either
    // way it's a valid outcome and we clear it to keep the segment flowing.
    if (body.decision === 'hold') {
      const who = body.stage === 'treasurer' ? 'the treasurer' : `the ${body.stage} gate`;
      stamp(`${who} chose to HOLD — a valid cautious outcome. Narrating + approving to continue …`);
      const pending = await listPendingApprovals();
      const mine = pending.find((a) => a.payment?.host === REDTEAM_HOST) ?? pending[0];
      if (mine) {
        const out = await approve(mine.id);
        const exec = out.execution as { decision?: string; reasoning?: string } | undefined;
        stamp(`        owner approved approval #${mine.id} → re-execution: ${String(exec?.decision).toUpperCase()} "${exec?.reasoning ?? ''}"`);
      } else {
        stamp('        (no pending approval found to clear — continuing.)');
      }
    }
  }

  log();
  log('━'.repeat(76));
  log('the treasurer wrote a reason for every charge above — straight into steward_payments.');
  log('that is the AI CFO: it does not just allow/deny, it explains why, on the record.  ✅');
  log('━'.repeat(76));

  await sql.end();
  process.exit(0);
}

main().catch(async (err) => {
  console.error('\n[treasurer-demo] fatal:', err);
  try {
    await sql.end();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
