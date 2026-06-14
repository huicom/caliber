// scripts/flagship-demo.ts — Steward Phase 2 flagship: "A rating born from a verified breach."
//
// The narrated end-to-end story:
//   1. SHOW the seller agent's CURRENT Caliber rating (Silver).
//   2. SIGN a DeliverySpec (buyer signs; seller address is the red-team seller) and
//      pay the red-team fixture in GARBAGE mode through an ephemeral, deterministic
//      Steward (treasurer OFF, bot OFF) — the seller takes the money but delivers a
//      malformed body that BREACHES the signed, pre-agreed spec.
//   3. Steward signs a BREACH EvidenceAttestation and records it ON-CHAIN in the
//      EvidenceRegistry on Arc Testnet — SHOW the EvidenceAttested tx hash + the
//      on-chain receipt (a Transaction Receipt with the EvidenceAttested log).
//   4. RUN snapshot:once for the seller agent — the breach observation flows through
//      the Caliber rating engine.
//   5. SHOW the rating DROPPED (Silver → Bronze) + the emitted tier_transitions row.
//
// Every step is real: a real signed spec, a real settled payment, a real on-chain
// attestation, a real feedback_events row, a real rateAgent() recomputation.
//
// Run (from repo root, with the red-team fixture :3400 already up):
//   pnpm demo:flagship
//   # or: tsx --env-file=.env scripts/flagship-demo.ts
//
// Env: STEWARD_API_KEY, REDTEAM_ADMIN_TOKEN, REDTEAM_PORT (def 3400),
//      REDTEAM_SELLER_ADDRESS, EVIDENCE_REGISTRY_ADDRESS, RATING_SIGNER_PRIVATE_KEY,
//      STEWARD_PRIVATE_KEY (gas), ARC_RPC_URL, ARC_CHAIN_ID, DATABASE_URL.

import 'dotenv/config';
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () {
  return this.toString();
};

import { sql } from '@arc-agents/db';
import {
  buildDeliverySpec,
  signDeliverySpec,
  caliberDomain,
  type DeliverySpec,
} from '@caliber/steward-core';
import {
  createPublicClient,
  http,
  defineChain,
  decodeEventLog,
  type Abi,
  type Log,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { rateAgent } from '../rating/engine/rating.js';
import { startEphemeralSteward, type EphemeralSteward } from './lib/ephemeral-steward.js';
import { seedFlagshipAgent, FLAGSHIP_AGENT_ID } from './lib/seed-flagship-agent.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

// ── config ───────────────────────────────────────────────────────────────────
const DEMO_PORT = Number(process.env.STEWARD_FLAGSHIP_PORT?.trim() || '3390');
const REDTEAM_PORT = process.env.REDTEAM_PORT ?? '3400';
const REDTEAM = `http://localhost:${REDTEAM_PORT}`;
const RESOURCE = `${REDTEAM}/api/research`;
const apiKey = required('STEWARD_API_KEY');
const adminToken = required('REDTEAM_ADMIN_TOKEN');
const sellerAddress = required('REDTEAM_SELLER_ADDRESS').toLowerCase();
const registry = required('EVIDENCE_REGISTRY_ADDRESS');
const rpcUrl = required('ARC_RPC_URL');
const chainId = Number(process.env.ARC_CHAIN_ID ?? '5042002');

// A deterministic buyer wallet for the signed spec (the buyer signature is
// mandatory; the seller address is the red-team seller — buyer-only spec, which is
// accepted by the pipeline).
const BUYER_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as Hex;
const buyer = privateKeyToAccount(BUYER_KEY);

function required(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) {
    console.error(`\n[flagship] missing env ${name} — set it in the repo-root .env (see .env.example).`);
    process.exit(1);
  }
  return v;
}

// ── narration ──────────────────────────────────────────────────────────────────
let stepNo = 0;
const ts = (): string => new Date().toISOString().slice(11, 23);
const log = (line = ''): void => console.log(line);
const stamp = (line: string): void => console.log(`  ${ts()}  ${line}`);
function step(title: string): void {
  stepNo += 1;
  log();
  log('━'.repeat(76));
  log(`STEP ${stepNo} · ${title}`);
  log('━'.repeat(76));
}
const failures: string[] = [];
function expect(label: string, ok: boolean): void {
  stamp(`${ok ? 'PASS' : 'FAIL'} — ${label}`);
  if (!ok) failures.push(`STEP ${stepNo}: ${label}`);
}

// ── chain ──
const arc = defineChain({
  id: chainId,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
});
const pub = createPublicClient({ chain: arc, transport: http(rpcUrl) });
const EVIDENCE_ABI = (
  JSON.parse(
    readFileSync(
      resolve(REPO_ROOT, 'contracts/out/EvidenceRegistry.sol/EvidenceRegistry.json'),
      'utf8',
    ),
  ) as { abi: readonly unknown[] }
).abi;

// ── red-team fixture admin ──
async function setMode(mode: string): Promise<void> {
  const res = await fetch(`${REDTEAM}/admin/mode`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-redteam-admin': adminToken },
    body: JSON.stringify({ mode }),
  });
  if (!res.ok) throw new Error(`setMode(${mode}) failed: ${res.status} ${await res.text()}`);
  stamp(`red-team fixture → mode "${mode}"`);
}

// Build + buyer-sign a DeliverySpec for the red-team research endpoint that
// REQUIRES JSON. The garbage payload (text/html) breaches requireJson.
async function buildSignedSpec(): Promise<{ spec: DeliverySpec; buyerSig: Hex }> {
  const spec = buildDeliverySpec({
    chain: 'arc',
    buyer: buyer.address,
    seller: sellerAddress as Hex,
    sellerUrl: RESOURCE,
    expect: { json: true, okField: true },
    maxBytes: 1024 * 1024,
    deadlineMs: 30_000,
    requireJson: true,
    requireOkField: true,
    validUntil: Math.floor(Date.now() / 1000) + 3600,
    nonce: BigInt(Date.now()),
  });
  const buyerSig = await signDeliverySpec(spec, buyer, caliberDomain('arc'));
  return { spec, buyerSig };
}

interface PayBody {
  decision: string;
  stage: string;
  reasoning: string;
  paymentId?: string;
  txRef?: string;
  conformance?: { rule: string; detail?: string }[];
}

async function paySignedSpec(
  steward: EphemeralSteward,
  spec: DeliverySpec,
  buyerSig: Hex,
): Promise<{ status: number; body: PayBody }> {
  // spec bigints serialize via the BigInt.toJSON monkeypatch (→ strings); the
  // server coerces them back. Send the spec verbatim.
  const res = await fetch(`${steward.baseUrl}/v1/pay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-steward-key': apiKey },
    body: JSON.stringify({
      url: RESOURCE,
      init: { method: 'POST' },
      source: 'demo:flagship',
      spec: { spec, buyerSig },
    }),
  });
  const body = (await res.json()) as PayBody;
  return { status: res.status, body };
}

// Poll steward_evidence until the breach evidence for this payment is recorded.
async function waitForEvidence(paymentId: bigint, timeoutMs = 60_000): Promise<{
  id: string;
  onchain_tx: string | null;
  verdict: number;
  agent_id: string;
  feedback_event_id: string | null;
} | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const rows = await sql<
      { id: string; onchain_tx: string | null; verdict: number; agent_id: string; feedback_event_id: string | null }[]
    >`
      select id::text, onchain_tx, verdict, agent_id::text, feedback_event_id::text
      from steward_evidence where payment_id = ${paymentId.toString()}
      order by id desc limit 1`;
    if (rows.length && rows[0].onchain_tx) return rows[0];
    await new Promise((r) => setTimeout(r, 1500));
  }
  // Return whatever exists even without an onchain_tx (so the demo can report it).
  const rows = await sql<
    { id: string; onchain_tx: string | null; verdict: number; agent_id: string; feedback_event_id: string | null }[]
  >`
    select id::text, onchain_tx, verdict, agent_id::text, feedback_event_id::text
    from steward_evidence where payment_id = ${paymentId.toString()} order by id desc limit 1`;
  return rows[0] ?? null;
}

function snapshotOnce(agentId: bigint): string {
  const res = spawnSync(
    'pnpm',
    ['--filter', '@arc-agents/rating', 'snapshot:once', '--', '--agent', agentId.toString()],
    { cwd: REPO_ROOT, encoding: 'utf8', env: process.env },
  );
  return (res.stdout ?? '') + (res.stderr ?? '');
}

// ── main ──
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

async function preflightRedteam(): Promise<void> {
  try {
    const res = await fetch(`${REDTEAM}/health`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) throw new Error(`${res.status}`);
  } catch (err) {
    console.error(`\n[flagship] red-team not reachable at ${REDTEAM}/health — start it first:`);
    console.error('[flagship]   cd services/redteam && pnpm start');
    console.error(`[flagship]   (${err instanceof Error ? err.message : String(err)})`);
    process.exit(1);
  }
}

async function main(): Promise<void> {
  log();
  log('████  STEWARD · flagship — a rating born from a verified breach  ████');
  log('a signed-spec breach → on-chain evidence → a measurable Caliber downgrade.');

  await preflightRedteam();

  // ── seed the rated seller (idempotent) ──
  step('Seed — a Caliber-rated seller, mapped to the red-team seller address');
  stamp('seeding a clean, clearly-synthetic rated agent (owner = the red-team seller)…');
  const seed = await seedFlagshipAgent(sellerAddress);
  stamp(`seeded agent #${seed.agentId} · owner ${seed.sellerAddress}`);
  stamp(`        ${seed.completedJobs} completed jobs + ${seed.positiveFeedback} positive validations`);

  // ── STEP: show the baseline rating ──
  step('Before — the seller’s current Caliber rating');
  const before = await rateAgent(FLAGSHIP_AGENT_ID, 'arc', 'PIT');
  if (!before.rated) {
    stamp(`agent unexpectedly UNRATED (${before.reason}) — aborting`);
    failures.push('baseline agent is not rated');
    return;
  }
  stamp(`tier=${before.tier}  score=${before.score}  confidence=${before.confidence}`);
  stamp(`        network-endorsement sub-score = ${before.factors.network_endorsement}`);
  expect('seller starts with a real Caliber rating', before.rated);

  // Write a baseline snapshot so the AFTER snapshot has a prior to diff against.
  stamp('writing a baseline snapshot (prior state for the transition diff)…');
  snapshotOnce(FLAGSHIP_AGENT_ID);

  // ── boot the ephemeral steward (deterministic; evidence issuance ON via env) ──
  step('Boot — an ephemeral deterministic Steward (treasurer OFF, bot OFF)');
  ephemeral = await startEphemeralSteward(DEMO_PORT, {
    onLog: (line) => {
      if (/listening on|evidence|EvidenceAttested|error|failed/i.test(line)) console.log(`  ${line}`);
    },
  });
  stamp(`steward=${ephemeral.baseUrl}  red-team=${REDTEAM}`);

  // ── STEP: sign the spec + pay in garbage mode ──
  step('Breach — buyer + seller signed a DeliverySpec; the seller delivers garbage');
  stamp('buyer signs a DeliverySpec that REQUIRES a JSON body (the pre-agreed contract).');
  const { spec, buyerSig } = await buildSignedSpec();
  stamp(`        spec: requireJson=true requireOkField=true seller=${sellerAddress}`);
  await setMode('garbage');
  stamp('Steward pays the x402 charge — then the seller returns malformed text/html.');
  const { status, body } = await paySignedSpec(ephemeral, spec, buyerSig);
  stamp(`verdict: ${body.decision.toUpperCase()}  stage=${body.stage}  http=${status}`);
  stamp(`reasoning: "${body.reasoning}"`);
  if (body.conformance?.length) {
    stamp(`        conformance breach: ${body.conformance.map((c) => c.rule).join(', ')}`);
  }
  const settledBreach = body.decision === 'allow' && !!body.conformance?.length;
  expect('payment SETTLED (money moved) but the signed spec was BREACHED', settledBreach);
  if (!body.paymentId) {
    failures.push('no paymentId returned — cannot trace evidence');
    return;
  }
  const paymentId = BigInt(body.paymentId);

  // ── STEP: on-chain evidence ──
  step('Evidence — Steward records an on-chain EvidenceAttestation (BREACH)');
  stamp('the rating signer signs a BREACH verdict over the spec; gas paid by the Steward wallet.');
  const evidence = await waitForEvidence(paymentId);
  if (!evidence) {
    stamp('no steward_evidence row appeared — aborting');
    failures.push('no evidence row recorded');
    return;
  }
  stamp(`steward_evidence #${evidence.id}  verdict=${evidence.verdict} (1=BREACH)  agent=${evidence.agent_id}`);
  if (evidence.onchain_tx) {
    stamp(`        EvidenceAttested tx: ${evidence.onchain_tx}`);
    // Read the on-chain receipt + decode the EvidenceAttested event (cast-equivalent).
    try {
      const receipt = await pub.getTransactionReceipt({ hash: evidence.onchain_tx as Hex });
      stamp(`        receipt: status=${receipt.status} block=${receipt.blockNumber} gasUsed=${receipt.gasUsed}`);
      const ev = receipt.logs
        .filter((l: Log) => l.address.toLowerCase() === registry.toLowerCase())
        .map((l: Log) => {
          try {
            return decodeEventLog({ abi: EVIDENCE_ABI as Abi, data: l.data, topics: l.topics });
          } catch {
            return null;
          }
        })
        .find((d) => d && d.eventName === 'EvidenceAttested');
      if (ev) {
        const a = ev.args as unknown as Record<string, unknown>;
        stamp(`        EvidenceAttested(agentId=${a.agentId}, paymentId=${a.paymentId}, verdict=${a.verdict}, tier=${a.verifyingTier})`);
      }
      expect('an EvidenceAttested event is on-chain on Arc Testnet', receipt.status === 'success' && !!ev);
    } catch (e) {
      stamp(`        receipt read failed: ${e instanceof Error ? e.message : String(e)}`);
      expect('an EvidenceAttested event is on-chain on Arc Testnet', false);
    }
  } else {
    stamp('        on-chain send did not confirm (row recorded for retry).');
    expect('an EvidenceAttested event is on-chain on Arc Testnet', false);
  }
  // The synthetic validator-feedback row that bridges into the rating engine.
  if (evidence.feedback_event_id) {
    const [fb] = await sql<{ score: string; tag: string | null; validator_address: string; tx_hash: string }[]>`
      select score::text, tag, validator_address, tx_hash from feedback_events where id = ${evidence.feedback_event_id}`;
    stamp(`        feedback_events #${evidence.feedback_event_id}: score=${fb?.score} tag=${fb?.tag} validator=${fb?.validator_address}`);
    expect("a steward:breach feedback row (score 0) was written", !!fb && Number(fb.score) === 0 && fb.tag === 'steward:breach');
  } else {
    expect("a steward:breach feedback row (score 0) was written", false);
  }

  // ── STEP: re-rate ──
  step('After — re-snapshot the seller; the verified breach moved the rating');
  stamp('running snapshot:once for the seller agent…');
  const snapOut = snapshotOnce(FLAGSHIP_AGENT_ID);
  // Surface the snapshot script's before/after + transition lines.
  for (const line of snapOut.split('\n')) {
    if (/BEFORE|AFTER|tier=|emitted|transition|tier_down|score/.test(line)) {
      console.log(`    ${line.trim()}`);
    }
  }
  const after = await rateAgent(FLAGSHIP_AGENT_ID, 'arc', 'PIT');
  if (after.rated) {
    stamp(`recomputed: tier=${after.tier}  score=${after.score}  (was ${before.tier} / ${before.score})`);
    expect(
      'the verified breach DROPPED the rating (lower score, tier_down)',
      after.score < before.score,
    );
  } else {
    expect('the verified breach DROPPED the rating (lower score, tier_down)', false);
  }

  // The tier_transitions row the snapshot emitted.
  const [tr] = await sql<
    { kind: string; from_tier: string | null; to_tier: string; from_score: number | null; to_score: number | null; at: Date }[]
  >`
    select kind, from_tier, to_tier, from_score, to_score, at
    from tier_transitions where agent_id = ${FLAGSHIP_AGENT_ID.toString()} and chain_id = 'arc'
    order by at desc, id desc limit 1`;
  if (tr) {
    stamp(`tier_transitions: ${tr.kind}  ${tr.from_tier ?? '(none)'} → ${tr.to_tier}  score ${tr.from_score ?? '?'} → ${tr.to_score}`);
    expect('a tier_transitions row was emitted for the drop', tr.kind === 'tier_down' || (tr.from_score ?? 0) > (tr.to_score ?? 0));
  } else {
    expect('a tier_transitions row was emitted for the drop', false);
  }

  // ── result ──
  log();
  log('━'.repeat(76));
  if (failures.length === 0) {
    log('RESULT · a rating born from a verified breach — every step produced its proof.  ✅');
  } else {
    log(`RESULT · ${failures.length} step(s) did NOT match expectation:`);
    for (const f of failures) log(`   ✗ ${f}`);
  }
  log('━'.repeat(76));
}

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    void (async () => {
      console.error(`\n[flagship] received ${sig} — tearing down …`);
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
    console.error('\n[flagship] fatal:', err);
    await teardown();
    process.exit(1);
  });
