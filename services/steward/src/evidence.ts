// WS-2 + WS-3 — the flagship. When a SIGNED-spec payment breaches its pre-agreed
// DeliverySpec, Steward turns that breach into TWO durable, trust-bearing records:
//
//   1. an on-chain EvidenceAttestation in the EvidenceRegistry (the rating signer
//      signs an EIP-712 BREACH verdict over the spec; anyone may relay it, the sig
//      is the auth), and
//   2. a synthetic-but-honest validator observation written into feedback_events
//      (score 0, tag 'steward:breach') so the breach flows through the Caliber
//      rating engine's networkEndorsement sub-score and measurably lowers the
//      seller's composite score on the next snapshot.
//
// "A rating born from a verified breach."
//
// SAFETY: issueEvidence() is FIRE-AND-FORGET from the payment path. It NEVER throws
// into the pipeline — the payment already settled; recording the evidence must not
// fail the response. An on-chain send failure logs + still writes the steward_evidence
// row with onchain_tx=null + the verbatim signed envelope, so it can be retried.

import {
  buildEvidenceAttestation,
  signEvidenceAttestation,
  caliberDomain,
  deliverySpecHash,
  VERDICT,
  type VerdictValue,
  type DeliverySpec,
} from '@caliber/steward-core';
import {
  createPublicClient,
  createWalletClient,
  http,
  defineChain,
  keccak256,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { db, sql, stewardEvidence, feedbackEvents } from '@arc-agents/db';
import type { SignedSpec } from './pipeline.js';
import { evidenceConfig, type EvidenceConfig } from './evidence-config.js';
import { notifyEvidence } from './ledger.js';
// Stamp evidence attestations with the live engine methodology version (single
// source of truth in @arc-agents/rating). Relative import — the rating package
// has no exports map, matching the indexer base→arc cross-workspace pattern.
import { METHODOLOGY_VERSION } from '../../../rating/engine/version.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// EvidenceRegistry ABI — loaded from the Foundry artifact at runtime (avoids a
// JSON import-assertion that differs across tsx/Node versions). Path is resolved
// relative to this module so it works from src/ and from a demo script.
const __dirname = dirname(fileURLToPath(import.meta.url));
const ARTIFACT_PATH = resolve(
  __dirname,
  '../../../contracts/out/EvidenceRegistry.sol/EvidenceRegistry.json',
);
const EVIDENCE_ABI = (
  JSON.parse(readFileSync(ARTIFACT_PATH, 'utf8')) as { abi: readonly unknown[] }
).abi;

/** A 0x-prefixed bytes32 hex from a bare sha256 hex digest (or pass-through a 0x hex). */
function toBytes32Hex(hexNo0x: string): Hex {
  const h = hexNo0x.startsWith('0x') ? hexNo0x.slice(2) : hexNo0x;
  return (`0x${h.padStart(64, '0').slice(0, 64)}`) as Hex;
}

export interface IssueEvidenceArgs {
  /** The settled steward_payments row id this evidence is attached to. */
  paymentId: bigint;
  /** The verified signed DeliverySpec that governed the payment. */
  spec: SignedSpec;
  verdict: VerdictValue;
  /** Which judge tier resolved the verdict (0 = Tier-0 deterministic conformance). */
  verifyingTier: number;
  /** sha256 (hex, with or without 0x) of the delivered bytes. */
  responseHash: string;
  /** The seller's Caliber agentId (resolved from pay_to). */
  agentId: bigint;
}

// In-process per-agent nonce hint, so two breaches issued within one second don't
// collide on the contract's monotonic nonce before the first is mined. Seeded from
// the on-chain lastNonce + the wall clock.
const nonceHint = new Map<string, bigint>();

let _chain: ReturnType<typeof defineChain> | null = null;
function arcChain(cfg: EvidenceConfig) {
  if (_chain) return _chain;
  _chain = defineChain({
    id: cfg.chainId,
    name: 'Arc Testnet',
    nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [cfg.rpcUrl] } },
  });
  return _chain;
}

/**
 * Issue evidence for a resolved signed-spec outcome. Fire-and-forget safe.
 *
 * Returns the steward_evidence row id on success (or after a recorded-but-unsent
 * fallback), or null if the precondition checks failed (no registry configured, no
 * agentId). Callers should `void issueEvidence(...)` — never await it in the hot path.
 */
export async function issueEvidence(args: IssueEvidenceArgs): Promise<bigint | null> {
  try {
    const cfg = evidenceConfig();
    if (!cfg) {
      console.warn('[steward:evidence] EVIDENCE_REGISTRY_ADDRESS unset — skipping on-chain evidence');
      return null;
    }

    const { spec: signed, paymentId, verdict, verifyingTier, agentId } = args;
    const spec: DeliverySpec = signed.spec;
    // The EvidenceAttestation is signed against the EvidenceRegistry's domain
    // (verifyingContract = the registry address), so the off-chain signature
    // recovers to signer() inside attest(). The spec_hash field, by contrast, is the
    // opaque WS-1 spec handle, computed with the off-chain (zero-address) domain that
    // WS-1 used when it persisted the spec — the contract treats it as an opaque
    // bytes32, so the two domains are intentionally different.
    const attestDomain = caliberDomain('arc', cfg.registry);
    const specHash = deliverySpecHash(spec, caliberDomain('arc'));
    const responseHash = toBytes32Hex(args.responseHash);

    // Sign with the rating signer (the key the registry's signer() expects).
    const signerAccount = privateKeyToAccount(cfg.signerKey);

    // Nonce: strictly greater than the on-chain lastNonce(agentId). Read it, then
    // pick max(onchain+1, hint, now-seconds) so concurrent breaches don't clash.
    const pub = createPublicClient({ chain: arcChain(cfg), transport: http(cfg.rpcUrl) });
    let onchainLast = 0n;
    try {
      onchainLast = (await pub.readContract({
        address: cfg.registry,
        abi: EVIDENCE_ABI,
        functionName: 'lastNonce',
        args: [agentId],
      })) as bigint;
    } catch (e) {
      console.warn('[steward:evidence] lastNonce read failed (using time-based nonce):', e instanceof Error ? e.message : e);
    }
    const key = agentId.toString();
    const nowSec = BigInt(Math.floor(Date.now() / 1000));
    const hinted = nonceHint.get(key) ?? 0n;
    const nonce = (onchainLast + 1n > nowSec ? onchainLast + 1n : nowSec) > hinted
      ? (onchainLast + 1n > nowSec ? onchainLast + 1n : nowSec)
      : hinted + 1n;
    nonceHint.set(key, nonce);

    const attestation = buildEvidenceAttestation({
      chain: 'arc',
      paymentId,
      agentId,
      specHash,
      responseHash,
      verdict,
      verifyingTier,
      // Commitments to the spec signatures. seller sig may be absent (buyer-only spec).
      buyerSig: keccak256(signed.buyerSig),
      sellerSig: signed.sellerSig
        ? keccak256(signed.sellerSig)
        : ('0x' + '0'.repeat(64)) as Hex,
      methodologyVersion: METHODOLOGY_VERSION,
      timestamp: nowSec,
      nonce,
    });

    const { signature } = await signEvidenceAttestation(attestation, signerAccount, attestDomain);

    // Serialize the attestation with bigint fields as strings (jsonb-safe + re-broadcastable).
    const attJson = {
      ...attestation,
      paymentId: attestation.paymentId.toString(),
      agentId: attestation.agentId.toString(),
      timestamp: attestation.timestamp.toString(),
      nonce: attestation.nonce.toString(),
    };

    // ── On-chain send (gas paid by STEWARD_PRIVATE_KEY; attest is permissionless) ──
    let onchainTx: string | null = null;
    try {
      const gasAccount = privateKeyToAccount(cfg.gasKey);
      const wallet = createWalletClient({ account: gasAccount, chain: arcChain(cfg), transport: http(cfg.rpcUrl) });
      const hash = await wallet.writeContract({
        address: cfg.registry,
        abi: EVIDENCE_ABI,
        functionName: 'attest',
        args: [attestation, signature],
        chain: wallet.chain,
        account: wallet.account,
      });
      await pub.waitForTransactionReceipt({ hash });
      onchainTx = hash;
      console.log(`[steward:evidence] EvidenceAttested verdict=${verdict} agent=${agentId} payment=${paymentId} tx=${hash}`);
    } catch (e) {
      console.error('[steward:evidence] on-chain attest failed (recording for retry):', e instanceof Error ? e.message : e);
    }

    // ── Record steward_evidence (always — even when the chain send failed) ──
    const [row] = await db
      .insert(stewardEvidence)
      .values({
        paymentId,
        specHash,
        responseHash,
        agentId,
        verdict,
        verifyingTier,
        buyerSig: signed.buyerSig,
        sellerSig: signed.sellerSig ?? null,
        methodologyVersion: METHODOLOGY_VERSION,
        attestation: attJson,
        signature,
        onchainTx,
      })
      .returning({ id: stewardEvidence.id });
    const evidenceId = row.id;

    // ── WS-3: the rating bridge — a BREACH writes a synthetic validator observation ──
    let feedbackEventId: bigint | null = null;
    if (verdict === VERDICT.BREACH) {
      feedbackEventId = await writeBreachFeedback({
        agentId,
        signerAddress: signerAccount.address,
        specHash,
        // The attest tx hash is the natural feedback tx_hash; fall back to a synthetic
        // unique handle when the chain send failed (tx_hash is UNIQUE NOT NULL).
        txHash: onchainTx ?? `steward-evidence:${evidenceId.toString()}`,
      });
      if (feedbackEventId !== null) {
        await db
          .update(stewardEvidence)
          .set({ feedbackEventId })
          .where(eqId(evidenceId));
      }
    }

    await notifyEvidence({
      id: evidenceId.toString(),
      verdict,
      agentId: agentId.toString(),
      paymentId: paymentId.toString(),
      onchainTx,
    });

    return evidenceId;
  } catch (err) {
    // Belt-and-suspenders: NEVER let evidence issuance throw into the payment path.
    console.error('[steward:evidence] issueEvidence failed (non-fatal):', err);
    return null;
  }
}

/** drizzle eq(stewardEvidence.id, id) without importing eq at top (keep deps tight). */
function eqId(id: bigint) {
  // local import to avoid a top-level drizzle-orm `eq` clash; small + clear.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { eq } = require('drizzle-orm') as typeof import('drizzle-orm');
  return eq(stewardEvidence.id, id);
}

/**
 * Write the breach as a Steward-as-validator observation into feedback_events. This
 * is the row the Caliber rating engine reads: networkEndorsement counts only
 * feedback with score >= 50 as positive, so a score-0 row dilutes the positive
 * share and lowers the composite score → can drop the tier on the next snapshot.
 *
 * Synthetic-but-honest: it is a real observation by a real validator (the Steward
 * rating signer) of a real, on-chain-attested conformance breach against a signed,
 * pre-agreed spec — not invented sentiment. block_number/log_index are filled with
 * a high synthetic block (so it sorts last in the agent's feedback history) and a
 * sentinel log index. Returns the new row id, or null on conflict (idempotent on
 * tx_hash UNIQUE — a re-issue for the same attest tx won't double-count).
 */
async function writeBreachFeedback(args: {
  agentId: bigint;
  signerAddress: Address;
  specHash: Hex;
  txHash: string;
}): Promise<bigint | null> {
  // A synthetic, monotic-ish block number well above any real Arc block so the
  // observation sorts to the end of the agent's feedback history.
  const syntheticBlock = BigInt(900_000_000_000) + BigInt(Math.floor(Date.now() / 1000));
  const [row] = await db
    .insert(feedbackEvents)
    .values({
      chainId: 'arc',
      agentId: args.agentId,
      validatorAddress: args.signerAddress.toLowerCase(),
      score: '0',
      // score_type sentinel for a Steward conformance-breach observation. Distinct
      // from the on-chain ReputationRegistry score_types (0/1/2) seen on Arc.
      scoreType: 99,
      tag: 'steward:breach',
      feedbackHash: args.specHash,
      blockNumber: syntheticBlock,
      txHash: args.txHash,
      logIndex: 0,
    })
    .onConflictDoNothing({ target: feedbackEvents.txHash })
    .returning({ id: feedbackEvents.id });
  if (!row) {
    // Conflict (already recorded for this tx) — read the existing id back.
    const [existing] = await sql<{ id: string }[]>`
      select id from feedback_events where tx_hash = ${args.txHash} limit 1
    `;
    return existing ? BigInt(existing.id) : null;
  }
  // Keep agents.feedback_count consistent with the reliability/aggregate path the
  // indexer uses (handlers.ts recomputes the same way after each feedback insert).
  const aid = args.agentId.toString();
  await sql`
    update agents a set
      feedback_count = (select count(*) from feedback_events fe where fe.agent_id = ${aid} and fe.chain_id = 'arc'),
      reputation_score = (select avg(fe.score) from feedback_events fe where fe.agent_id = ${aid} and fe.chain_id = 'arc'),
      updated_at = now()
    where a.agent_id = ${aid} and a.chain_id = 'arc'
  `;
  return row.id;
}
