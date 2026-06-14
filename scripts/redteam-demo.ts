// scripts/redteam-demo.ts — the Steward attack-demo orchestration.
//
// Drives a Steward + red-team seller fixture (:3400) pair through the full attack
// sequence, printing a narrated, timestamped transcript. This transcript doubles
// as the demo-video shot list (see docs/steward/DEMO_RUNBOOK.md).
//
// DETERMINISM — the Steward this demo drives:
//   By DEFAULT this script boots its OWN ephemeral Steward child on
//   STEWARD_DEMO_PORT (default 3390) with the LLM treasurer DISABLED and the
//   Telegram bot OFF. That is deliberate: the live :3300 instance runs the LLM
//   treasurer, which is non-deterministic and can HOLD a valid payment — which
//   used to flake STEP 5 (approve loop-hold → re-execute → expect ALLOW). With
//   the treasurer off, every verdict here is reproducible, so all 8 steps pass
//   on every run. The bot is off so the ephemeral instance never opens a second
//   long-poll on the live bot token (avoids the grammY 409). The child is torn
//   down on exit (success, failure, or Ctrl-C) — no orphans, :3390 left free.
//
//   To point the demo at an EXTERNAL Steward instead, set STEWARD_EXTERNAL_URL
//   (e.g. STEWARD_EXTERNAL_URL=http://localhost:3301). Then no child is spawned
//   and the script targets that instance verbatim (its treasurer setting is
//   yours to own). NOTE: the service's own STEWARD_PORT (set in .env, used to
//   boot the live :3300 service) is intentionally NOT the override knob — it
//   would otherwise always force the demo onto the treasurer-on live instance
//   and reintroduce the flake. Use STEWARD_EXTERNAL_URL for an explicit target.
//
// What it proves, in order:
//   1. Baseline      honest mode → ALLOW + settled (prints the txRef).
//   2. Overcharge    10× price   → DENY at the policy per-tx cap.
//   3. Redirect      attacker payTo → DENY at the redirect detector (expected/got).
//   4. Sanctioned    OFAC SDN payTo → DENY at the SDN screen (stage 'sdn') + sdn_hit
//                                   incident; nothing settles, before any signature.
//   5. Loop bait     rapid-fire   → runaway-loop HOLD + route paused; next call
//                                   refused at the route-pause gate; then the
//                                   approvals queue is shown + approved (route
//                                   reactivates, payment re-executes).
//   5. Garbage       malformed body → ALLOW (money moved) but a conformance incident.
//   6. Freeze        kill switch  → 423 FROZEN, then unfreeze + a clean ALLOW.
//   7. Epilogue      the traction counters straight from steward_payments / incidents.
//
// Every refusal is a REAL pipeline verdict and every settled allow is a REAL row
// in steward_payments — the epilogue reads the same table back to prove it.
//
// Run (from repo root, the red-team fixture :3400 already up):
//   pnpm demo:redteam
//   # or: tsx --env-file=.env scripts/redteam-demo.ts
//
// Env it reads: STEWARD_API_KEY, REDTEAM_ADMIN_TOKEN, REDTEAM_PORT (def 3400),
// STEWARD_DEMO_PORT (def 3390, the ephemeral instance), STEWARD_EXTERNAL_URL
// (OPTIONAL — when set, target that external instance instead of spawning one),
// DATABASE_URL (via @arc-agents/db).
//
// Idempotent: it resets the red-team host's route + freeze state at the start so
// it can be re-run back-to-back. It writes steward_state directly via
// @arc-agents/db for the freeze step (the web /api/steward/freeze route is the
// product path; the direct write here keeps the script self-contained — it fires
// the same pg_notify so an open console still reconciles live).

import { createSteward, StewardRefusal, type StewardResult, type StewardClient } from '@caliber/steward-client';
import { sql } from '@arc-agents/db';
import { startEphemeralSteward, type EphemeralSteward } from './lib/ephemeral-steward.js';

// ── config ───────────────────────────────────────────────────────────────────
// When STEWARD_EXTERNAL_URL is set, target that external instance and DON'T
// spawn a child. Otherwise boot an ephemeral deterministic instance on
// STEWARD_DEMO_PORT (treasurer OFF, bot OFF) — see the header for why. We do
// NOT key off STEWARD_PORT: .env sets it to 3300 to boot the live (treasurer-on)
// service, and honoring that here would always drag the demo back onto the
// non-deterministic instance — the exact flake this refactor removes.
const EXTERNAL_STEWARD_URL = process.env.STEWARD_EXTERNAL_URL?.trim() || null;
const DEMO_PORT = Number(process.env.STEWARD_DEMO_PORT?.trim() || '3390');
const REDTEAM_PORT = process.env.REDTEAM_PORT ?? '3400';
const REDTEAM = `http://localhost:${REDTEAM_PORT}`;
const RESOURCE = `${REDTEAM}/api/research`;
const REDTEAM_HOST = `localhost:${REDTEAM_PORT}`;

const apiKey = required('STEWARD_API_KEY');
const adminToken = required('REDTEAM_ADMIN_TOKEN');
const sellerAddress = required('REDTEAM_SELLER_ADDRESS').toLowerCase();
// A KNOWN OFAC-sanctioned address (verified isSanctioned → true). Mirrors the
// redteam fixture's `sanctioned` mode recipient. Overridable via env.
const sanctionedAddress = (
  process.env.REDTEAM_SANCTIONED_ADDRESS?.trim() || '0x098B716B8Aaf21512996dC57EB0615e2383E2f96'
).toLowerCase();

// These are bound in main() once the target Steward URL is known (the ephemeral
// instance gets a fresh port; an external one is taken from STEWARD_EXTERNAL_URL).
let STEWARD = '';
let steward: StewardClient;

function required(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) {
    console.error(`\n[demo] missing env ${name} — set it in the repo-root .env (see .env.example).`);
    process.exit(1);
  }
  return v;
}

// ── narration helpers ──────────────────────────────────────────────────────────
let stepNo = 0;
const ts = (): string => new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
const log = (line = ''): void => console.log(line);
const stamp = (line: string): void => console.log(`  ${ts()}  ${line}`);

function step(title: string): void {
  stepNo += 1;
  log();
  log('━'.repeat(76));
  log(`STEP ${stepNo} · ${title}`);
  log('━'.repeat(76));
}

function expect(label: string, ok: boolean): void {
  stamp(`${ok ? 'PASS' : 'FAIL'} — ${label}`);
  if (!ok) failures.push(`STEP ${stepNo}: ${label}`);
}

const failures: string[] = [];

// ── service interactions ────────────────────────────────────────────────────────
async function setMode(mode: string): Promise<void> {
  const res = await fetch(`${REDTEAM}/admin/mode`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-redteam-admin': adminToken },
    body: JSON.stringify({ mode }),
  });
  if (!res.ok) throw new Error(`setMode(${mode}) failed: ${res.status} ${await res.text()}`);
  stamp(`red-team fixture → mode "${mode}"`);
}

/** A single pay attempt. Returns the allow result, or null on a refusal (logged). */
async function pay(source?: string): Promise<StewardResult | null> {
  try {
    const res = await steward.pay(RESOURCE, { method: 'POST', headers: source ? { 'x-demo-source': source } : undefined });
    stamp(`ALLOW   stage=${res.stage}  reasoning="${res.reasoning}"`);
    if (res.quote) stamp(`        quote ${res.quote.amountUsdc} USDC → ${res.quote.payTo}`);
    if (res.txRef) stamp(`        txRef ${res.txRef}`);
    // The pipeline surfaces conformance violations + delivered payload on the result.
    const extra = res as StewardResult & { conformance?: { rule: string; detail: string }[] };
    if (extra.conformance?.length) {
      stamp(`        conformance violations: ${extra.conformance.map((c) => c.rule).join(', ')}`);
    }
    return res;
  } catch (err) {
    if (err instanceof StewardRefusal) {
      stamp(
        `${err.decision.toUpperCase()}    stage=${err.stage}  http=${err.httpStatus}  ` +
          `reasoning="${err.reasoning}"`,
      );
      return null;
    }
    stamp(`ERROR   ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }
}

/** Raw pay that returns the full HTTP envelope (status + body) — for assertions on holds. */
async function rawPay(): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${STEWARD}/v1/pay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-steward-key': apiKey },
    body: JSON.stringify({ url: RESOURCE, init: { method: 'POST' } }),
  });
  const body = (await res.json()) as Record<string, unknown>;
  return { status: res.status, body };
}

// ── state resets (keep the run idempotent) ──────────────────────────────────────
async function reactivateRedteamRoute(): Promise<void> {
  await sql`
    update steward_routes
       set status = 'active', paused_reason = null, paused_at = null, auto_resume_at = null
     where host = ${REDTEAM_HOST}`;
}

/**
 * Clear the red-team host's recent payment history so the runaway-loop detector
 * (which counts ALL recent payments to a host in its trailing window) starts each
 * run from a clean slate — otherwise leftover rows from a prior run keep the route
 * tripped. Scoped strictly to the fixture host; deletes the dependent
 * approvals/incidents first to respect the FKs. Does not touch any other host's
 * traffic (dogfood/external rows are untouched).
 */
async function clearRedteamHistory(): Promise<void> {
  await sql`
    delete from steward_approvals
     where payment_id in (select id from steward_payments where host = ${REDTEAM_HOST})`;
  await sql`delete from steward_incidents where host = ${REDTEAM_HOST}`;
  await sql`
    update steward_payments set incident_id = null where host = ${REDTEAM_HOST}`;
  await sql`delete from steward_payments where host = ${REDTEAM_HOST}`;
  await sql`delete from steward_routes where host = ${REDTEAM_HOST}`;
  // Also clear ALL counterparties registered to the fixture host. The sanctioned
  // step (stepSanctioned) deliberately swaps the host's registered recipient to
  // the sanctioned address; if a prior run was interrupted between that swap and
  // the re-trust at the step's end, a stale sanctioned counterparty would survive
  // and the next run's baseline would mis-fire the redirect detector. Scoping the
  // wipe to the fixture host keeps real (dogfood/external) counterparties intact.
  await sql`delete from steward_counterparties where host = ${REDTEAM_HOST}`;
}

/**
 * Cool the runaway-loop window down WITHOUT deleting evidence: backdate the
 * fixture host's existing payment rows so they fall outside the detector's
 * trailing window, and reactivate the route. Used after the loop step so the
 * deliberately-hot window doesn't re-trip on the steps that follow — while the
 * rows themselves survive for the epilogue counters.
 */
async function coolDownRedteamWindow(): Promise<void> {
  await sql`
    update steward_payments
       set created_at = now() - interval '1 hour'
     where host = ${REDTEAM_HOST}
       and created_at >= now() - interval '15 minutes'`;
  await reactivateRedteamRoute();
}

/**
 * Establish the honest seller as a KNOWN counterparty for the red-team host —
 * i.e. "Steward has paid this seller honestly before". This is what makes the
 * baseline a clean ALLOW (not a new-counterparty hold) and gives the redirect
 * detector a recipient-on-record to compare the attacker payTo against. Mirrors
 * the service's own trustCounterparty() upsert; idempotent on the payTo key.
 */
async function trustHonestSeller(): Promise<void> {
  await sql`
    insert into steward_counterparties (pay_to, host, registered, trusted)
    values (${sellerAddress}, ${REDTEAM_HOST}, true, true)
    on conflict (pay_to) do update set
      host = ${REDTEAM_HOST}, registered = true, trusted = true`;
}

/**
 * Trust the sanctioned address as THE registered counterparty for the red-team
 * host, so the cheaper deterministic gates (new-counterparty hold, redirect
 * detector) all PASS — leaving the OFAC SDN screen as the gate that fires. This
 * is the load-bearing point of the step: even a counterparty Steward has paid
 * before is re-screened, and a sanctions hit blocks it before signing. We also
 * clear any 24h SDN cache so the screen actually hits the oracle on camera.
 */
async function trustSanctionedSeller(): Promise<void> {
  await sql`
    insert into steward_counterparties (pay_to, host, registered, trusted)
    values (${sanctionedAddress}, ${REDTEAM_HOST}, true, true)
    on conflict (pay_to) do update set
      host = ${REDTEAM_HOST}, registered = true, trusted = true,
      sdn_result = null, sdn_checked_at = null`;
  // Remove the honest seller registration for this host so findByHost resolves
  // unambiguously to the sanctioned address (the redirect detector compares the
  // quote's payTo against the host's registered recipient).
  await sql`delete from steward_counterparties where host = ${REDTEAM_HOST} and pay_to = ${sellerAddress}`;
}

async function setFrozen(frozen: boolean, reason: string | null): Promise<void> {
  const value = { frozen, reason, by: 'redteam-demo', at: new Date().toISOString() };
  const json = JSON.stringify(value);
  await sql`
    insert into steward_state (key, value, updated_at)
    values ('frozen', ${json}::jsonb, now())
    on conflict (key) do update set value = ${json}::jsonb, updated_at = now()`;
  // Same notify the web /api/steward/freeze route fires, so an open console reconciles.
  await sql`select pg_notify('steward_events', ${JSON.stringify({ kind: 'freeze', frozen, reason })})`;
}

// ── approvals queue ─────────────────────────────────────────────────────────────
interface ApprovalItem {
  id: string;
  status: string;
  paymentId: string;
  payment: { host: string; reasoning: string | null; decisionStage: string } | null;
}

async function listPendingApprovals(): Promise<ApprovalItem[]> {
  const res = await fetch(`${STEWARD}/v1/approvals?status=pending`, {
    headers: { 'x-steward-key': apiKey },
  });
  if (!res.ok) throw new Error(`list approvals failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { approvals: ApprovalItem[] };
  return json.approvals;
}

async function decideApproval(id: string, decision: 'approve' | 'deny'): Promise<Record<string, unknown>> {
  const res = await fetch(`${STEWARD}/v1/approvals/${id}/decide`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-steward-key': apiKey },
    body: JSON.stringify({ decision, via: 'web' }),
  });
  return (await res.json()) as Record<string, unknown>;
}

// ── steps ────────────────────────────────────────────────────────────────────────
async function stepBaseline(): Promise<void> {
  step('Baseline — honest seller, one paid call');
  stamp('the agent asks Steward to pay an x402-gated resource it has never paid before.');
  await setMode('honest');
  const res = await pay('demo:baseline');
  expect('honest payment ALLOWED and settled (txRef present)', !!res && res.decision === 'allow' && !!res.txRef);
}

async function stepOvercharge(): Promise<void> {
  step('Overcharge — seller quotes 10× the going rate');
  stamp('same resource, same recipient — but the price jumps to $0.01 (cap is $0.005).');
  await setMode('overcharge');
  const { status, body } = await rawPay();
  stamp(`verdict: ${String(body.decision).toUpperCase()}  stage=${body.stage}  http=${status}`);
  stamp(`reasoning: "${body.reasoning}"`);
  expect('overcharge REFUSED at the policy/price guard (deny or hold)', body.decision === 'deny' || body.decision === 'hold');
}

async function stepRedirect(): Promise<void> {
  step('Redirect — honest price, but payTo points at an attacker wallet');
  stamp('the seller answers the 402 with a different recipient than the one we trust.');
  await setMode('redirect');
  const { status, body } = await rawPay();
  stamp(`verdict: ${String(body.decision).toUpperCase()}  stage=${body.stage}  http=${status}`);
  stamp(`reasoning: "${body.reasoning}"`);
  const denied = body.decision === 'deny' && body.stage === 'detector';
  // The reasoning carries the expected vs got address — surface it explicitly.
  if (typeof body.reasoning === 'string' && /expected .* got /.test(body.reasoning)) {
    const m = body.reasoning.match(/expected (\S+), got (\S+)/);
    if (m) stamp(`        expected → ${m[1]}`), stamp(`        got      → ${m[2]} (attacker)`);
  }
  expect('redirect DENIED at the redirect detector with expected/got addresses', denied);
}

async function stepSanctioned(): Promise<void> {
  step('Sanctioned — payTo is on the OFAC SDN list (Chainalysis on-chain oracle)');
  stamp('honest price + payload, and a counterparty Steward has paid before — but the');
  stamp('recipient is a KNOWN OFAC-sanctioned address. Steward re-screens every payTo.');
  // Make the sanctioned address the trusted recipient so the new-counterparty
  // and redirect gates pass — the SDN screen is what must fire.
  await trustSanctionedSeller();
  await setMode('sanctioned');
  const { status, body } = await rawPay();
  stamp(`verdict: ${String(body.decision).toUpperCase()}  stage=${body.stage}  http=${status}`);
  stamp(`reasoning: "${body.reasoning}"`);
  const denied = body.decision === 'deny' && body.stage === 'sdn' && status === 403;
  expect('sanctioned payTo DENIED at the OFAC SDN screen (stage sdn, HTTP 403)', denied);

  // No settlement happened; the SDN columns + sdn_hit incident landed.
  const [pay] = await sql<{ decision: string; settle_status: string; sdn_source: string | null; sdn_result: unknown }[]>`
    select decision, settle_status, sdn_source, sdn_result
    from steward_payments
    where host = ${REDTEAM_HOST} and decision_stage = 'sdn'
    order by created_at desc limit 1`;
  stamp(`        ledger row: decision=${pay?.decision} settle=${pay?.settle_status} sdn_source="${pay?.sdn_source ?? ''}"`);
  expect('the SDN deny ledger row carries sdn_source + sdn_result and never settled',
    !!pay && pay.decision === 'deny' && pay.settle_status === 'n/a' && !!pay.sdn_source);

  const [{ count }] = await sql<{ count: number }[]>`
    select count(*)::int as count from steward_incidents
     where kind = 'sdn_hit' and host = ${REDTEAM_HOST}
       and created_at > now() - interval '2 minutes'`;
  stamp(`        steward_incidents(kind=sdn_hit) in last 2m: ${count}`);
  expect('an sdn_hit incident was opened with the screening evidence', count > 0);

  // Re-trust the honest seller so the steps that follow have a clean recipient
  // on record (the loop/garbage/freeze steps all pay the honest seller).
  await sql`delete from steward_counterparties where host = ${REDTEAM_HOST} and pay_to = ${sanctionedAddress}`;
  await trustHonestSeller();
}

async function stepLoopbait(): Promise<void> {
  step('Loop bait — a “retry now” response that baits a runaway payment loop');
  stamp('reset the route so the loop counter starts clean, then hammer the endpoint.');
  await reactivateRedteamRoute();
  await setMode('loopbait');

  // Fire rapid calls until the runaway-loop detector trips (route gets paused).
  // The detector counts ALL recent settled payments in its window, so the exact
  // trip count depends on history — we drive until we observe the loop HOLD, then
  // one more to show the route-pause refusal.
  let tripped = false;
  let routePauseObserved = false;
  const MAX = 8;
  for (let i = 1; i <= MAX; i++) {
    const { status, body } = await rawPay();
    const decision = String(body.decision);
    const reasoning = String(body.reasoning ?? '');
    if (decision === 'allow') {
      stamp(`call ${i}: ALLOW  (paid — loop counter +1)`);
    } else if (reasoning.startsWith('runaway loop')) {
      stamp(`call ${i}: HOLD   http=${status}  "${reasoning}"`);
      tripped = true;
    } else if (reasoning.startsWith('route paused')) {
      stamp(`call ${i}: HOLD   http=${status}  "${reasoning}"  ← route is now paused; calls refused before any network hop`);
      routePauseObserved = true;
      if (tripped) break; // we've shown both the trip and the follow-on refusal
    } else {
      stamp(`call ${i}: ${decision.toUpperCase()}  http=${status}  "${reasoning}"`);
    }
  }
  expect('runaway-loop detector tripped a HOLD and paused the route', tripped);
  expect('the next call was refused at the route-pause gate', routePauseObserved);

  // Show the approvals queue + approve-to-execute (reactivates route, re-runs the pay).
  stamp('the held payments are now in the approvals queue:');
  const pending = await listPendingApprovals();
  const loopHold = pending.find((a) => a.payment?.reasoning?.startsWith('runaway loop'));
  for (const a of pending.slice(0, 5)) {
    stamp(`        approval #${a.id}  payment ${a.paymentId}  "${a.payment?.reasoning ?? ''}"`);
  }
  expect('at least one pending approval is queued for the loop hold', pending.length > 0);

  if (loopHold) {
    stamp(`owner approves approval #${loopHold.id} (console; Telegram during the event) → route reactivates + payment re-executes:`);
    await setMode('honest'); // approve replays the held request; serve it honestly
    const out = await decideApproval(loopHold.id, 'approve');
    const exec = out.execution as { decision?: string; stage?: string; reasoning?: string } | undefined;
    stamp(`        approval ${String((out.approval as { status?: string })?.status)}  ` +
      `→ re-execution: ${String(exec?.decision).toUpperCase()} stage=${exec?.stage} "${exec?.reasoning ?? ''}"`);
    expect('approving the loop hold reactivated the route and re-executed the payment', exec?.decision === 'allow');
  }

  // The loop deliberately made the trailing window "hot"; cool it down (keeping
  // the rows for the epilogue) so the steps that follow start from a calm route.
  await coolDownRedteamWindow();
}

async function stepGarbage(): Promise<void> {
  step('Garbage — seller takes the money but delivers a malformed response');
  stamp('honest price + recipient, so the payment SETTLES — but the body fails Tier-0 conformance.');
  await setMode('garbage');
  const res = await pay('demo:garbage');
  const extra = res as (StewardResult & { conformance?: { rule: string }[] }) | null;
  const hasConformance = !!extra?.conformance?.length;
  // Cross-check the incident landed in the ledger (the console /steward/incidents row).
  const [{ count }] = await sql<{ count: number }[]>`
    select count(*)::int as count from steward_incidents
     where kind = 'conformance' and host = ${REDTEAM_HOST}
       and created_at > now() - interval '2 minutes'`;
  stamp(`        steward_incidents(kind=conformance) in last 2m: ${count}`);
  expect('garbage payment ALLOWED (money moved) but flagged non-conformant', !!res && res.decision === 'allow' && (hasConformance || count > 0));
}

async function stepFreeze(): Promise<void> {
  step('Freeze — the owner pulls the kill switch');
  stamp('writing steward_state.frozen = true (the same row the web /api/steward/freeze route sets).');
  await setMode('honest');
  await setFrozen(true, 'demo: owner-triggered freeze');
  const { status, body } = await rawPay();
  stamp(`verdict while frozen: ${String(body.decision).toUpperCase()}  stage=${body.stage}  http=${status}`);
  stamp(`reasoning: "${body.reasoning}"`);
  expect('every payment DENIED at the freeze gate with HTTP 423', status === 423 && body.decision === 'deny' && body.stage === 'frozen');

  stamp('owner lifts the freeze; payments flow again.');
  await setFrozen(false, null);
  const res = await pay('demo:post-unfreeze');
  expect('after unfreeze, an honest payment is ALLOWED again', !!res && res.decision === 'allow');
}

async function stepEpilogue(): Promise<void> {
  step('Epilogue — every number above is a real row in steward_payments');
  stamp(`counters below are scoped to THIS demo run (host ${REDTEAM_HOST}).`);
  const decisions = await sql<{ decision: string; n: number }[]>`
    select decision, count(*)::int as n from steward_payments
     where host = ${REDTEAM_HOST} group by decision order by decision`;
  const incidents = await sql<{ kind: string; n: number }[]>`
    select kind, count(*)::int as n from steward_incidents
     where host = ${REDTEAM_HOST} group by kind order by n desc`;
  const settled = await sql<{ total: string | null }[]>`
    select coalesce(sum(settled_usdc), 0)::text as total from steward_payments
     where host = ${REDTEAM_HOST} and settle_status = 'settled'`;

  log();
  stamp('steward_payments by decision:');
  for (const d of decisions) stamp(`        ${d.decision.padEnd(6)} ${d.n}`);
  stamp('steward_incidents by kind:');
  if (incidents.length === 0) stamp('        (none yet)');
  for (const i of incidents) stamp(`        ${i.kind.padEnd(16)} ${i.n}`);
  stamp(`total settled USDC this run: ${settled[0]?.total ?? '0'}`);
  log();
  stamp('every row carries a `source` tag, so demo vs external traffic is split — never conflated.');
}

// ── main ────────────────────────────────────────────────────────────────────────
/** Confirm the red-team fixture is reachable (the Steward we boot ourselves). */
async function preflightRedteam(): Promise<void> {
  try {
    const res = await fetch(`${REDTEAM}/health`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) throw new Error(`${res.status}`);
  } catch (err) {
    console.error(`\n[demo] red-team is not reachable at ${REDTEAM}/health — start it first.`);
    console.error(`[demo]   red-team: cd services/redteam && pnpm start`);
    console.error(`[demo]   (${err instanceof Error ? err.message : String(err)})`);
    process.exit(1);
  }
}

/** Confirm an EXTERNAL Steward (STEWARD_EXTERNAL_URL path) is reachable. */
async function preflightExternalSteward(): Promise<void> {
  try {
    const res = await fetch(`${STEWARD}/health`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) throw new Error(`${res.status}`);
  } catch (err) {
    console.error(`\n[demo] external steward not reachable at ${STEWARD}/health — start it first.`);
    console.error(`[demo]   steward: cd services/steward && pnpm start`);
    console.error(`[demo]   (${err instanceof Error ? err.message : String(err)})`);
    process.exit(1);
  }
}

// Holds the spawned child (null when targeting an external instance). Torn down
// in finally + on signals so a crashed step never leaves an orphan on :3390.
let ephemeral: EphemeralSteward | null = null;
let tornDown = false;

async function teardown(): Promise<void> {
  if (tornDown) return;
  tornDown = true;
  if (ephemeral) {
    log();
    stamp(`tearing down ephemeral steward on :${ephemeral.port} …`);
    await ephemeral.stop();
    stamp(`ephemeral steward stopped (port ${ephemeral.port} freed).`);
  }
  try {
    await sql.end();
  } catch {
    /* ignore */
  }
}

async function runDemo(): Promise<void> {
  // Idempotent reset so the script can be re-run back-to-back:
  //  • lift any leftover freeze,
  //  • wipe the fixture host's prior payment history (so the runaway-loop window
  //    starts clean and a leftover pause doesn't poison the early steps),
  //  • trust the honest seller so the baseline is a clean ALLOW.
  await setFrozen(false, null);
  await clearRedteamHistory();
  await trustHonestSeller();

  await stepBaseline();
  await stepOvercharge();
  await stepRedirect();
  await stepSanctioned();
  await stepLoopbait();
  await stepGarbage();
  await stepFreeze();
  await stepEpilogue();

  // Leave the fixture + route in a clean, honest state.
  await setMode('honest');
  await reactivateRedteamRoute();

  log();
  log('━'.repeat(76));
  if (failures.length === 0) {
    log('RESULT · all steps produced their expected verdict.  ✅');
  } else {
    log(`RESULT · ${failures.length} step(s) did NOT match expectation:`);
    for (const f of failures) log(`   ✗ ${f}`);
  }
  log('━'.repeat(76));
}

async function main(): Promise<void> {
  log();
  log('████  STEWARD · red-team attack demo  ████');

  await preflightRedteam();

  // Resolve the target Steward: external (STEWARD_EXTERNAL_URL set) or ephemeral.
  if (EXTERNAL_STEWARD_URL) {
    STEWARD = EXTERNAL_STEWARD_URL;
    log(`steward=${STEWARD} (EXTERNAL — STEWARD_EXTERNAL_URL set; not spawning a child)   red-team=${REDTEAM}`);
    log('a CFO standing between an AI agent and every USDC charge it tries to make.');
    await preflightExternalSteward();
  } else {
    log(`booting ephemeral deterministic steward on :${DEMO_PORT} (treasurer OFF, bot OFF) …`);
    ephemeral = await startEphemeralSteward(DEMO_PORT, {
      onLog: (line) => {
        // Surface only the listen + any error lines so the transcript stays clean.
        if (/listening on|error|failed|treasurer/i.test(line)) console.log(`  ${line}`);
      },
    });
    STEWARD = ephemeral.baseUrl;
    log(`steward=${STEWARD} (ephemeral, deterministic)   red-team=${REDTEAM}`);
    log('a CFO standing between an AI agent and every USDC charge it tries to make.');
  }

  // Bind the client now that the target URL is known.
  steward = createSteward({ baseUrl: STEWARD, apiKey });

  await runDemo();
}

// Tear the child down on Ctrl-C / kill, then exit non-zero (interrupted).
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    void (async () => {
      console.error(`\n[demo] received ${sig} — tearing down …`);
      await teardown();
      process.exit(130);
    })();
  });
}

main()
  .then(async () => {
    await teardown();
    process.exit(failures.length === 0 ? 0 : 1);
  })
  .catch(async (err) => {
    console.error('\n[demo] fatal:', err);
    await teardown();
    process.exit(1);
  });
