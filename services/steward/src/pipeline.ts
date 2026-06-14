// The authorization pipeline (Steward Phase 1, tasks 8 + 10 + 16).
//
// One payment intent → one verdict → one ledger row. Each refusal SHORT-CIRCUITS
// (no signature, no settlement) and is recorded with the stage that refused.
// The inspection happens INSIDE CaliberPayer.pay's `preSign` hook: a throw there
// aborts before anything is signed. That throw propagates back here, where we
// classify it (PolicyViolation → policy, DetectorViolation/Hold → detector) and
// ledger accordingly.
//
// Pipeline order (§3 of STEWARD_PLAN.md — steps deterministic; LLM later):
//   1. Freeze check               (deny, stage 'frozen', HTTP 423)  — before pay()
//   2. Route-pause check          (hold, stage 'detector')          — before pay()
//   3. Runaway-loop check         (hold + incident + route pause)   — before pay()
//   4. preSign: a. compiled policy (deny/hold, stage 'policy')
//               b. redirect        (deny, stage 'detector' + incident)
//               c. price spike     (hold, stage 'detector' + incident)
//               d. first-use TOFU  (register-and-allow)
//   5. Settled success → allow, stage 'executed', upsert counterparty stats
//   6. Free endpoint (amountMicros 0) → allow, stage 'executed', settle 'n/a'
//
// Every HOLD outcome ALSO enqueues a steward_approvals row (status 'pending') and
// fires the 'approval' NOTIFY; the held intent's { url, init, source } is stored
// in steward_payments.request_init so it can be re-executed verbatim on approval.

import { CaliberPayer, type X402Quote } from '@caliber/x402-client';
import {
  checkRedirect,
  checkRunawayLoop,
  checkPriceSpike,
  evaluatePolicy,
  checkConformance,
  contentTypeIsJson,
  verifyDeliverySpecSig,
  recoverDeliverySpecSigner,
  caliberDomain,
  sellerUrlHash,
  deliverySpecHash,
  type ConformanceExpect,
  type ConformanceViolation,
  type DeliverySpec,
} from '@caliber/steward-core';
import { createHash } from 'node:crypto';
import type { Hex, Address } from 'viem';
import { randomUUID } from 'node:crypto';
import { writePayment, writeIncident, writeApproval, linkIncident, writeSpec } from './ledger.js';
import { issueEvidence, findBreachEvidence, recordJudgeCorroboration } from './evidence.js';
import { resolveAgentId } from './agent-resolver.js';
import { getJudgeRuntime, judgeSampleRate, judgeMinConfidence } from './llm-config.js';
import { judgeConformance } from './judge.js';
import { VERDICT } from '@caliber/steward-core';
import {
  findByHost,
  registerFirstUse,
  recordSettlement,
} from './counterparties.js';
import { readFrozen } from './state.js';
import { getActiveMandate } from './policy-store.js';
import { todaySpentUsdc, counterpartyTodayUsdc } from './spend.js';
import { checkRoutePause, pauseRoute } from './routes-state.js';
import { recentPaymentCount, trailingPriceStats, cachePriceMedian } from './detector-data.js';
import { loopConfig, priceSpikeConfig } from './detector-config.js';
import {
  PolicyViolation,
  PolicyHold,
  DetectorViolation,
  DetectorHold,
  TreasurerHold,
  TreasurerDeny,
  SdnDeny,
  SdnHold,
  SpecViolation,
  PreSignAbort,
} from './errors.js';
import { screenSdn, SdnError } from './sdn.js';
import type { SdnResult } from '@caliber/steward-core';
import { LlmError } from '@caliber/steward-core';
import { getLlmRuntime } from './llm-config.js';
import { treasurerDecide } from './treasurer.js';
import { narrateIncident } from './narrate.js';
import type { StewardConfig } from './config.js';
import type { NewStewardSpec } from '@arc-agents/db';

/** Request shape for POST /v1/pay. */
export interface PayIntent {
  url: string;
  init?: { method?: string; body?: unknown; headers?: Record<string, string> };
  source?: string;
  /**
   * Tier-0 delivery expectations checked AFTER a successful (allowed) payment.
   * Omitted fields fall back to sensible defaults derived from the response (see
   * resolveExpect): json defaults to true when the response claims JSON, maxBytes
   * to 1MB, okField to true when the body is JSON with an `ok` key, deadlineMs to
   * none. Stored verbatim in request_init so an approved re-execution re-checks.
   */
  expect?: ConformanceExpect;
  /**
   * WS-1: a buyer/seller-signed DeliverySpec. When present it SUPERSEDES `expect`:
   * the Tier-0 conformance bounds (maxBytes/deadlineMs/requireJson/requireOkField)
   * are derived from the signed, pre-agreed spec instead of response-observed
   * defaults — making a delivery breach attributable and disputable. The buyer
   * signature is mandatory; the seller signature is optional (a buyer-only spec is
   * accepted but undisputable). When omitted, the pipeline behaves exactly as
   * before (Tier-0-only, spec_id null) — full back-compat for HireBot/Phase-1.
   */
  spec?: SignedSpec;
}

/** A DeliverySpec plus the buyer (mandatory) and seller (optional) signatures. */
export interface SignedSpec {
  spec: DeliverySpec;
  buyerSig: Hex;
  sellerSig?: Hex;
}

/** 1 MiB default ceiling on a paid response body. */
const DEFAULT_MAX_BYTES = 1024 * 1024;

/**
 * One-shot bypass applied when re-executing an approved hold: the named rule(s)
 * are suppressed for THIS execution only (other rules still apply; freeze still
 * wins). Carries the approval id so the new ledger row's reasoning can reference it.
 */
export interface ApprovedContext {
  approvalId: bigint;
  /** Machine rule/detector codes to suppress, e.g. ['new_counterparty','price_spike']. */
  suppress: string[];
  /** If the suppressed hold was a route pause, the host whose route to reactivate. */
  routeReactivateHost?: string;
}

/** HTTP-shaped result: status + the JSON body to return. */
export interface PayOutcome {
  httpStatus: number;
  body: {
    requestId: string;
    decision: 'allow' | 'hold' | 'deny';
    stage: string;
    reasoning: string;
    quote?: { payTo: string; amountUsdc: string };
    txRef?: string;
    /** The seller's response body, returned to the caller on an allowed pay. */
    data?: unknown;
    /** sha256 (hex) of the raw seller response body, on an allowed pay. */
    sha256?: string;
    /** Tier-0 conformance violations found post-settle (empty/omitted = clean). */
    conformance?: ConformanceViolation[];
    /** Present on a 202 hold so the caller can poll/approve it. */
    approvalId?: string;
    paymentId?: string;
  };
}

/** atomic USDC (6dp) → decimal string, e.g. 5000n → "0.005". */
function microsToUsdc(micros: bigint): string {
  const denom = 1_000_000n;
  const whole = micros / denom;
  const frac = micros % denom;
  if (frac === 0n) return whole.toString();
  return `${whole}.${frac.toString().padStart(6, '0').replace(/0+$/, '')}`;
}

/** URL host including port (the detector + registry key). */
function hostOf(url: string): string {
  return new URL(url).host.toLowerCase();
}

/** The SDN columns to stamp onto a ledger row for a clean (non-sanctioned) screen. */
function sdnLedgerCols(r: SdnResult | null): Record<string, unknown> {
  if (!r) return {};
  return { sdnSource: r.source, sdnCheckedAt: new Date(r.checkedAt), sdnResult: r };
}

/**
 * Parse the raw body for the two facts conformance needs: whether it parsed as
 * JSON, and the value of its `ok` field (when it's a JSON object with that key).
 * Never throws — a non-JSON body yields parsedOk=false, bodyOkField=null.
 */
function inspectBody(
  rawBody: string,
  contentType: string | null,
): { parsedOk: boolean | null; bodyOkField: boolean | null } {
  const claimsJson = contentTypeIsJson(contentType);
  if (!rawBody) {
    // Empty body: only meaningful to call "unparseable" if JSON was claimed.
    return { parsedOk: claimsJson ? false : null, bodyOkField: null };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return { parsedOk: false, bodyOkField: null };
  }
  let bodyOkField: boolean | null = null;
  if (parsed && typeof parsed === 'object' && 'ok' in (parsed as Record<string, unknown>)) {
    const v = (parsed as Record<string, unknown>).ok;
    if (typeof v === 'boolean') bodyOkField = v;
  }
  return { parsedOk: true, bodyOkField };
}

/**
 * Fill `expect` defaults from the observed response (per task §1):
 *   • json     → true when the caller didn't say AND the response claims JSON
 *   • maxBytes → 1 MiB
 *   • okField  → true when the caller didn't say AND the body is JSON with an
 *                `ok` key
 *   • deadlineMs → none unless the caller set it
 */
function resolveExpect(
  expect: ConformanceExpect | undefined,
  contentType: string | null,
  rawBody: string,
): ConformanceExpect {
  const e: ConformanceExpect = { ...(expect ?? {}) };
  if (e.json === undefined) e.json = contentTypeIsJson(contentType);
  if (e.maxBytes === undefined) e.maxBytes = DEFAULT_MAX_BYTES;
  if (e.okField === undefined) {
    const { bodyOkField } = inspectBody(rawBody, contentType);
    e.okField = bodyOkField !== null;
  }
  return e;
}

/**
 * WS-1: derive the conformance bounds from a SIGNED, pre-agreed DeliverySpec.
 * Unlike resolveExpect there is NO response-observed defaulting — the bounds are
 * exactly what both parties signed (maxBytes/deadlineMs/requireJson/
 * requireOkField map 1:1 to ConformanceExpect). maxBytes/deadlineMs of 0 mean
 * "no limit" (a buyer who didn't want to bound that dimension), so they disable
 * the corresponding rule rather than rejecting every response.
 */
function expectFromSpec(spec: DeliverySpec): ConformanceExpect {
  return {
    json: spec.requireJson,
    okField: spec.requireOkField,
    ...(spec.maxBytes > 0 ? { maxBytes: spec.maxBytes } : {}),
    ...(spec.deadlineMs > 0 ? { deadlineMs: spec.deadlineMs } : {}),
  };
}

export class StewardPipeline {
  private readonly payer: CaliberPayer;

  constructor(private readonly config: StewardConfig) {
    // `pay(url)` takes a full URL, so apiBase is irrelevant here; the payer just
    // needs a funded wallet on the right chain.
    this.payer = new CaliberPayer({ privateKey: config.privateKey as Hex });
  }

  async run(intent: PayIntent, approved?: ApprovedContext): Promise<PayOutcome> {
    const started = Date.now();
    const requestId = randomUUID();
    const source = intent.source ?? 'api';
    const url = intent.url;
    const host = hostOf(url);
    const suppressed = (code: string): boolean => approved?.suppress.includes(code) ?? false;
    // Re-executions stamp the originating approval id into reasoning.
    const reasonPrefix = approved ? `approved hold #${approved.approvalId.toString()}: ` : '';
    // The snapshot stored on a held row so the hold can be replayed on approval.
    // `expect` rides along so an approved re-execution re-runs the same Tier-0
    // conformance checks the original intent asked for. `spec` rides along too so
    // a re-executed hold stays governed by the same signed DeliverySpec (WS-1).
    // Note: spec bigints (validUntil/nonce) serialize via BigInt.prototype.toJSON
    // monkeypatch → strings; reReadSpec() coerces them back on replay.
    const requestInit = {
      url,
      init: intent.init ?? null,
      source,
      expect: intent.expect ?? null,
      spec: intent.spec ?? null,
    };

    // ── Stage 0 (WS-1): signed-spec verification (pre-network refusals) ───────
    // A signed DeliverySpec must verify BEFORE we probe or pay. The checks that
    // don't need the live quote run here: buyer signature (mandatory), seller
    // signature (when present), expiry, and the URL binding. The one check that
    // needs the quote — spec.seller == quote.payTo — runs inside preSign (so it
    // aborts before signing too). An invalid spec is a clean refusal: no probe,
    // no signature, decision 'deny', stage 'policy', HTTP 400.
    const signedSpec = intent.spec ?? null;
    let specId: bigint | null = null;
    if (signedSpec) {
      const refusal = await this.verifySpecPreNetwork(
        signedSpec, url, requestId, source, host, started, reasonPrefix,
      );
      if (refusal) return refusal;
    }

    // ── Stage 1: freeze check (freeze ALWAYS wins, even on a re-execution) ────
    const frozen = await readFrozen();
    if (frozen.frozen) {
      const reasoning = `${reasonPrefix}treasury frozen: ${frozen.reason ?? 'no reason given'}`;
      await writePayment({
        requestId, source, sellerUrl: url, host,
        decision: 'deny', decisionStage: 'frozen', reasoning,
        settleStatus: 'n/a', latencyMs: Date.now() - started,
      });
      return {
        httpStatus: 423,
        body: { requestId, decision: 'deny', stage: 'frozen', reasoning },
      };
    }

    // ── Stage 2: route-pause check (before any network call) ─────────────────
    // Suppressed when this is the re-execution of the very route-paused hold.
    if (!suppressed('route_paused')) {
      const gate = await checkRoutePause(host);
      if (gate.paused) {
        const reasoning = `route paused: ${gate.reason}`;
        return this.holdBeforeNetwork({
          requestId, source, url, host, started, requestInit,
          stage: 'detector', code: 'route_paused', reasoning,
          detectorHits: [{ detector: 'route_pause', hit: true, reason: gate.reason ?? null }],
        });
      }
    }

    // ── Stage 3: runaway-loop check (before any network call) ────────────────
    if (!suppressed('runaway_loop')) {
      const cfg = loopConfig();
      const recent = await recentPaymentCount(host, cfg.windowMinutes);
      const loop = checkRunawayLoop({
        recentCount: recent,
        threshold: cfg.threshold,
        windowMinutes: cfg.windowMinutes,
      });
      if (loop.hit) {
        const reasoning =
          `runaway loop: ${loop.count} payments to ${host} in ${loop.windowMinutes}m ` +
          `(threshold ${cfg.threshold}) — route paused ${cfg.pauseMinutes}m`;
        // Break the loop: pause the route so subsequent attempts hold immediately.
        await pauseRoute(host, 'runaway_loop', cfg.pauseMinutes);
        return this.holdBeforeNetwork({
          requestId, source, url, host, started, requestInit,
          stage: 'detector', code: 'runaway_loop', reasoning,
          detectorHits: [{ detector: 'runaway_loop', hit: true, count: loop.count, windowMinutes: loop.windowMinutes }],
          incident: {
            kind: 'runaway_loop',
            severity: 'high',
            evidence: { count: loop.count, windowMinutes: loop.windowMinutes, threshold: cfg.threshold },
          },
        });
      }
    }

    // Policy host = the bare hostname (no port), what allowedHosts suffix-matches
    // against. The detector/registry key (`host`) keeps the port.
    const policyHost = new URL(url).hostname.toLowerCase();

    // Captured by the preSign closure so we can ledger the exact quote we refused
    // and stamp the active mandate on the row.
    let seenQuote: X402Quote | null = null;
    // Captured by the treasurer block (step 4e). On an allowed pay these annotate
    // the settled ledger row with the LLM's one-line reasoning + model id.
    let treasurerNote: string | null = null;
    let treasurerModel: string | null = null;
    // Captured by the SDN block (step 4d). On a clean (non-sanctioned) screen
    // these annotate the eventual settled ledger row; on a sanctioned hit the
    // SdnDeny carries its own copy for the deny row + incident.
    let sdnResult: SdnResult | null = null;
    const mandate = await getActiveMandate();

    const preSign = async (quote: X402Quote): Promise<void> => {
      seenQuote = quote;
      const payToUsdc = microsToUsdc(quote.amountMicros);

      // 4·0 (WS-1). Bind the signed spec to the ACTUAL recipient. The spec names
      // the seller it was negotiated with; the live quote names who actually gets
      // paid. They MUST match — otherwise a buyer-signed spec for seller A could
      // be replayed to pay seller B. Throwing here aborts before any signature.
      if (signedSpec && signedSpec.spec.seller.toLowerCase() !== quote.payTo.toLowerCase()) {
        throw new SpecViolation(
          'spec_seller_mismatch',
          `signed spec seller ${signedSpec.spec.seller} != quote payTo ${quote.payTo} — refusing to pay a recipient the spec doesn't bind`,
        );
      }

      // 4a. Compiled policy (caps / hosts / approval threshold / new-counterparty).
      const registered = await findByHost(host);
      const verdict = evaluatePolicy(
        { host: policyHost, payToUsdc },
        {
          todaySpentUsdc: await todaySpentUsdc(),
          counterpartyTodayUsdc: await counterpartyTodayUsdc(quote.payTo),
          isNewCounterparty: !registered,
        },
        mandate.policy,
      );
      if (!verdict.ok && !suppressed(verdict.rule)) {
        if (verdict.action === 'hold') {
          // new-counterparty holds open a 'new_counterparty' incident; other
          // policy holds (approval threshold) carry no incident.
          const incidentKind = verdict.rule === 'new_counterparty' ? 'new_counterparty' : undefined;
          throw new PolicyHold(verdict.rule, `${verdict.rule}: ${verdict.detail}`, incidentKind);
        }
        throw new PolicyViolation(verdict.rule, `${verdict.rule}: ${verdict.detail}`);
      }

      // 4b. Redirect detector: payTo must match the host's registered recipient.
      if (!suppressed('redirect')) {
        const redirect = checkRedirect({ payTo: quote.payTo, host }, registered);
        if (redirect.hit) {
          throw new DetectorViolation(
            'redirect',
            `seller diverted payment: expected ${redirect.expected}, got ${redirect.got}`,
            { detector: 'redirect', hit: true, expected: redirect.expected, got: redirect.got },
          );
        }
      }

      // 4c. Price-spike detector: live quote vs trailing median for the host.
      // Cold-start (<minSamples settled) abstains — the per-tx cap is the only
      // price guard until enough history accrues.
      if (!suppressed('price_spike')) {
        const cfg = priceSpikeConfig();
        const stats = await trailingPriceStats(host, cfg.window);
        const spike = checkPriceSpike({
          quoteUsdc: payToUsdc,
          medianUsdc: stats.medianUsdc,
          sampleCount: stats.sampleCount,
          minSamples: cfg.minSamples,
          multiplier: cfg.multiplier,
        });
        if (spike.hit) {
          throw new DetectorHold(
            'price_spike',
            `price spike: quote ${spike.quote} USDC is ${spike.ratio}× the trailing median ${spike.median} USDC`,
            { detector: 'price_spike', hit: true, quote: spike.quote, median: spike.median, ratio: spike.ratio },
            'price_spike',
            { quote: spike.quote, median: spike.median, ratio: spike.ratio },
          );
        }
      }

      // 4d. OFAC SDN screening (Chainalysis on-chain sanctions oracle). Runs
      // AFTER the cheaper deterministic detectors and BEFORE the treasurer, so a
      // sanctioned recipient is denied before any LLM spend — and before any
      // signature. Honest labeling: exact-match screening against the published
      // sanctions list; NOT "KYT", NOT a compliance determination. Suppressed
      // on an approved re-execution of an SDN hold (so an owner can override a
      // false positive / a recovered-oracle hold). FAILS CLOSED: an oracle
      // outage HOLDS, never silently allows an unscreened payment.
      if (!suppressed('sdn_hit') && !suppressed('sdn_unavailable')) {
        try {
          sdnResult = await screenSdn(quote.payTo);
        } catch (err) {
          if (err instanceof SdnError) {
            throw new SdnHold(
              `OFAC SDN check unavailable — payment held (${err.message})`,
            );
          }
          throw err;
        }
        if (sdnResult.sanctioned) {
          throw new SdnDeny(
            `OFAC SDN screening: payTo ${quote.payTo} is on a sanctions list — blocked before signing`,
            quote.payTo,
            sdnResult.source,
            sdnResult.checkedAt,
          );
        }
      }

      // 4e. LLM treasurer (fast model). Runs ONLY after every deterministic
      // check above passed (the payment would be ALLOWED). MASTER SWITCH:
      // getLlmRuntime() returns null when STEWARD_TREASURER_ENABLED!=='1', in
      // which case this whole block is inert and the pipeline behaves exactly as
      // the pure deterministic system — no LLM call, no behavior change.
      //
      // The treasurer can ONLY DOWNGRADE: allow→hold (TreasurerHold, 202) or
      // allow→deny (TreasurerDeny, 403). On an allow it stamps the one-line
      // reasoning + model onto the ledger row (see treasurerNote/treasurerModel
      // captured below). Suppressed on an approved re-execution.
      if (!suppressed('treasurer_hold') && !suppressed('treasurer_deny')) {
        const rt = getLlmRuntime();
        if (rt) {
          try {
            const verdict = await treasurerDecide(rt, {
              quotedUsdc: payToUsdc,
              host,
              payTo: quote.payTo,
              todaySpentUsdc: await todaySpentUsdc(),
              dailyCapUsdc: mandate.policy.caps.dailyUsdc,
              isNewCounterparty: !registered,
              mandateIntent: mandate.rawText,
            });
            treasurerModel = rt.fastModel;
            if (verdict.verdict === 'deny') {
              throw new TreasurerDeny(`treasurer denied: ${verdict.reason}`, rt.fastModel);
            }
            if (verdict.verdict === 'hold') {
              throw new TreasurerHold(`treasurer held: ${verdict.reason}`, rt.fastModel);
            }
            // allow → note rides onto the settled ledger row.
            treasurerNote = `treasurer: ${verdict.reason}`;
          } catch (err) {
            if (err instanceof TreasurerHold || err instanceof TreasurerDeny) throw err;
            if (err instanceof LlmError) {
              // Fail behavior when ENABLED: hold (default) or degrade to allow.
              if (rt.fallback === 'allow') {
                treasurerModel = rt.fastModel;
                treasurerNote = `treasurer unavailable (${err.kind}) — deterministic allow`;
              } else {
                throw new TreasurerHold(
                  `treasurer unavailable (${err.kind}) — held`,
                  rt.fastModel,
                );
              }
            } else {
              throw err;
            }
          }
        }
      }

      // 4d. Trust-on-first-use: no registered counterparty yet → register & allow.
      // Only reached when new-counterparty wasn't held (e.g. suppressed on an
      // approved re-execution, or policy newCounterparty='allow') AND the
      // treasurer (if enabled) allowed. Registering here (not before 4e) means a
      // treasurer hold/deny does NOT leave a phantom registered counterparty.
      if (!registered) {
        await registerFirstUse(quote.payTo, host);
      }
    };

    // ── Stage 4 + execute: probe → preSign → (sign + settle) ─────────────────
    let paid;
    try {
      paid = await this.payer.pay(url, intent.init, { preSign });
    } catch (err) {
      if (err instanceof PreSignAbort) {
        return this.refuse(
          requestId, source, url, host, seenQuote, err, started,
          mandate.id, requestInit, reasonPrefix,
        );
      }
      // A genuine transport / payment-rejected error (not a deliberate abort).
      const reasoning = `${reasonPrefix}payment failed: ${err instanceof Error ? err.message : String(err)}`;
      await writePayment({
        requestId, source, sellerUrl: url, host,
        payTo: seenQuote ? (seenQuote as X402Quote).payTo : null,
        quotedUsdc: seenQuote ? microsToUsdc((seenQuote as X402Quote).amountMicros) : null,
        decision: 'deny', decisionStage: 'executed', reasoning,
        settleStatus: 'failed', latencyMs: Date.now() - started,
      });
      return {
        httpStatus: 403,
        body: { requestId, decision: 'deny', stage: 'executed', reasoning },
      };
    }

    // ── Stage 6: free endpoint (no 402) ──────────────────────────────────────
    if (!paid.settled && paid.amountMicros === 0n) {
      const reasoning = `${reasonPrefix}free endpoint — no payment required`;
      await writePayment({
        requestId, source, sellerUrl: url, host,
        quotedUsdc: '0', decision: 'allow', decisionStage: 'executed', reasoning,
        mandateId: mandate.id ?? null,
        settleStatus: 'n/a', latencyMs: Date.now() - started,
      });
      return {
        httpStatus: 200,
        body: { requestId, decision: 'allow', stage: 'executed', reasoning,
          quote: { payTo: '', amountUsdc: '0' } },
      };
    }

    // ── Stage 5: settled success ─────────────────────────────────────────────
    // Money already moved — the decision STAYS 'allow' (honest ledger). Post-pay
    // we (a) verify settlement vs the facilitator echo and (b) run Tier-0
    // delivery conformance. Both can only ANNOTATE the row + raise incidents;
    // neither claws the payment back nor (in this task) auto-pauses the route.
    const latencyMs = Date.now() - started;
    const settledUsdc = microsToUsdc(paid.amountMicros);
    const payTo = paid.payTo ?? (seenQuote ? (seenQuote as X402Quote).payTo : null);
    if (payTo) {
      await recordSettlement(payTo, host, settledUsdc);
      // Refresh the trailing-median cache after each settle.
      const stats = await trailingPriceStats(host, priceSpikeConfig().window);
      await cachePriceMedian(payTo, stats.medianUsdc);
    }

    // Hash the exact bytes the seller delivered (delivery-conformance evidence +
    // a stable handle for the buyer). x402-client surfaced the raw body so the
    // stream isn't re-read.
    const rawBody = paid.rawBody ?? '';
    const sha256 = createHash('sha256').update(rawBody).digest('hex');
    const contentType = paid.contentType ?? null;
    const bytes = Buffer.byteLength(rawBody, 'utf8');

    // (a) Post-settle verification: settled true but the facilitator said
    // success=false OR no txRef → the server accepted the retry yet settlement
    // wasn't confirmed. Treat as 'mismatch' (high). (A 5xx-after-settle surfaces
    // as a thrown PaymentRejectedError → the catch block above writes 'failed'.)
    let settleStatus: 'settled' | 'mismatch' = 'settled';
    let settleMismatchDetail: string | null = null;
    if (paid.settleSuccess === false || !paid.txRef) {
      settleStatus = 'mismatch';
      settleMismatchDetail = paid.settleSuccess === false
        ? 'facilitator reported success=false after the server accepted the payment'
        : 'no settlement transaction reference echoed after the server accepted the payment';
    }

    // (b·WS-1) Persist the signed spec (deduped by hash) and bind it to this row.
    // The spec_hash is content-addressed so two payments under the same pre-agreed
    // spec share one steward_specs row.
    if (signedSpec) {
      const { id } = await writeSpec(this.specRow(signedSpec));
      specId = id;
    }

    // (b) Tier-0 delivery conformance. When a signed spec governs this payment the
    // bounds come FROM the signed, pre-agreed spec (no response-observed
    // defaulting — that's the whole point of WS-1). Otherwise fall back to the
    // legacy resolveExpect path (Tier-0-only, non-disputable). The check logic
    // itself is identical; only the source of the bounds differs.
    const expect = signedSpec
      ? expectFromSpec(signedSpec.spec)
      : resolveExpect(intent.expect, contentType, rawBody);
    const { bodyOkField, parsedOk } = inspectBody(rawBody, contentType);
    const conformance = checkConformance(expect, {
      status: paid.status,
      contentType: contentType ? contentType.toLowerCase() : null,
      bytes,
      latencyMs,
      parsedOk,
      bodyOkField,
      sha256,
    });
    const violated = conformance.violations.length > 0;

    // The treasurer's one-line reasoning (when enabled + it allowed) leads the
    // ledger reasoning so the human-facing line reads as the CFO's note.
    let reasoning = treasurerNote
      ? `${reasonPrefix}${treasurerNote} — paid ${settledUsdc} USDC to ${payTo ?? 'seller'}`
      : `${reasonPrefix}paid ${settledUsdc} USDC to ${payTo ?? 'seller'}`;
    if (settleMismatchDetail) reasoning += ` — settle mismatch: ${settleMismatchDetail}`;
    if (violated) {
      reasoning += ` — delivered non-conformant: ${conformance.violations.map((v) => v.rule).join(', ')}`;
    }

    const { id: paymentId } = await writePayment({
      requestId, source, sellerUrl: url, host, payTo,
      quotedUsdc: settledUsdc, settledUsdc,
      decision: 'allow', decisionStage: 'executed', reasoning,
      mandateId: mandate.id ?? null,
      llmModel: treasurerModel,
      paymentRef: paid.txRef ?? null, settleStatus,
      // WS-1: when a signed spec governed this payment, bind the row to it and
      // stamp the verification tier (0 = Tier-0 deterministic conformance, the
      // only tier today). Both stay null on the legacy unsigned-`expect` path.
      specId, verificationTier: signedSpec ? 0 : null,
      // Record the clean SDN screen on the settled row (when SDN ran this call).
      // `sdnResult` is set inside the preSign closure; TS can't see that across
      // the closure boundary and narrows it to the literal null it was declared
      // with, so read it back through an explicitly-typed alias.
      ...sdnLedgerCols(sdnResult as SdnResult | null),
      latencyMs,
    });

    // Settle mismatch → high-severity incident, back-linked to the row.
    if (settleStatus === 'mismatch') {
      const inc = await writeIncident({
        kind: 'settle_mismatch',
        severity: 'high',
        host,
        payTo,
        paymentId,
        evidence: {
          detail: settleMismatchDetail,
          settleSuccess: paid.settleSuccess ?? null,
          txRef: paid.txRef ?? null,
          settledUsdc,
          url,
        },
      });
      await linkIncident(paymentId, inc.id);
      void narrateIncident(inc.id).catch((e) =>
        console.error('[steward] narrateIncident (settle_mismatch) failed:', e),
      );
    }

    // Conformance violations → medium-severity incident, back-linked to the row.
    if (violated) {
      const inc = await writeIncident({
        kind: 'conformance',
        severity: 'medium',
        host,
        payTo,
        paymentId,
        evidence: {
          violations: conformance.violations,
          sha256,
          contentType,
          bytes,
          latencyMs,
          url,
          // WS-1: when a signed spec governed this payment, record WHICH bounds
          // the breach was judged against (they came from the pre-agreed spec,
          // not response defaults) + the spec handle, so the incident is provable.
          ...(signedSpec
            ? {
                specId: specId?.toString() ?? null,
                specHash: deliverySpecHash(signedSpec.spec, caliberDomain('arc')),
                specBounds: expect,
                verificationTier: 0,
              }
            : {}),
        },
      });
      await linkIncident(paymentId, inc.id);
      void narrateIncident(inc.id).catch((e) =>
        console.error('[steward] narrateIncident (conformance) failed:', e),
      );

      // WS-2 + WS-3 (the flagship): a signed-spec payment that BREACHED its
      // pre-agreed DeliverySpec → sign a BREACH EvidenceAttestation over (specHash,
      // responseHash=sha256, verifyingTier=0) with the rating signer, record it
      // on-chain in the EvidenceRegistry, AND write a Steward-as-validator breach
      // observation into feedback_events so it flows through the Caliber rating
      // engine and lowers the seller's score. The spec is a signed, pre-agreed
      // contract, so a breach against it is attestable + attributable.
      // Adjudication stays CONFORMANCE-TO-SPEC only, never quality.
      //
      // Fire-and-forget: issueEvidence NEVER throws into the payment path (the
      // payment already settled). The seller agentId is resolved from the actual
      // recipient (payTo); when the recipient isn't a registered Caliber agent we
      // skip attestation (you can't attest against a non-existent agentId).
      if (payTo && signedSpec) {
        const evidenceSpec = signedSpec;
        void (async () => {
          try {
            const agentId = await resolveAgentId(payTo);
            if (agentId === null) {
              console.warn(
                `[steward] breach on signed spec but payTo ${payTo} is not a registered Caliber agent — no evidence attested`,
              );
              return;
            }
            await issueEvidence({
              paymentId,
              spec: evidenceSpec,
              verdict: VERDICT.BREACH,
              verifyingTier: 0,
              responseHash: sha256,
              agentId,
            });
          } catch (e) {
            console.error('[steward] issueEvidence (breach) failed:', e);
          }
        })();
      }
    }

    // ── WS-4: Tier-1 LLM judge (the adjudication layer ABOVE Tier-0) ──────────
    // For SIGNED-spec settled payments, sample at STEWARD_JUDGE_SAMPLE_RATE and run
    // the SMART-model judge over the IN-MEMORY response body (rawBody isn't
    // persisted, so the judge MUST run inline here while the body is in hand).
    // Fire-and-forget — it NEVER blocks the pay response.
    //
    // The judge can ONLY ADD confidence to a breach (CONFORMANCE-to-spec only):
    //   • Tier-0 already attested a breach for this payment → record the judge
    //     verdict as CORROBORATION on the existing evidence row (NO double
    //     attestation).
    //   • Tier-0 did NOT attest a breach AND the judge returns conforms:false with
    //     confidence ≥ STEWARD_JUDGE_MIN_CONFIDENCE → issue a Tier-1 (verifyingTier=1)
    //     BREACH attestation (the same on-chain path Tier-0 uses).
    //   • Otherwise (judge says conforms, or low confidence, or LLM outage →
    //     conforms:true confidence:0) → no attestation. An LLM failure NEVER
    //     manufactures a breach.
    if (payTo && signedSpec) {
      const judgeRt = getJudgeRuntime();
      if (judgeRt && Math.random() < judgeSampleRate()) {
        const judgeSpec = signedSpec;
        const judgeBody = rawBody;
        const judgeContentType = contentType;
        const judgeLatency = latencyMs;
        const tier0Violations = conformance.violations;
        void (async () => {
          try {
            const verdict = await judgeConformance(judgeRt, {
              spec: judgeSpec.spec,
              responseBody: judgeBody,
              contentType: judgeContentType,
              latencyMs: judgeLatency,
              tier0Violations,
            });
            console.log(
              `[steward:judge] payment=${paymentId} tier1 conforms=${verdict.conforms} ` +
                `confidence=${verdict.confidence} violations=${verdict.violations.map((v) => v.field).join(',') || '(none)'}`,
            );

            // When Tier-0 found violations it issues its OWN breach attestation on
            // a CONCURRENT fire-and-forget path (above). To avoid a race where the
            // judge attests before Tier-0's row lands (→ a double attestation),
            // briefly poll for the Tier-0 breach row when Tier-0 violated. The
            // judge's LLM call already took seconds, so Tier-0 has usually landed;
            // this is a short safety wait, capped so it never lingers.
            let existingBreach = await findBreachEvidence(paymentId);
            if (!existingBreach && tier0Violations.length > 0) {
              for (let i = 0; i < 20 && !existingBreach; i++) {
                await new Promise((r) => setTimeout(r, 250));
                existingBreach = await findBreachEvidence(paymentId);
              }
            }
            if (existingBreach) {
              // Tier-0 already attested a breach on-chain → corroborate, don't
              // double-attest. Record the judge verdict on the existing row.
              await recordJudgeCorroboration(existingBreach.id, verdict);
              console.log(
                `[steward:judge] payment=${paymentId} Tier-0 breach already attested ` +
                  `(evidence #${existingBreach.id}) — recorded Tier-1 verdict as corroboration (no double attestation)`,
              );
              return;
            }

            // No prior breach attestation. Only a confident conforms:false issues
            // a NEW Tier-1 attestation. A conforming verdict (or low confidence, or
            // a fail-safe outage verdict) issues nothing.
            if (!verdict.conforms && verdict.confidence >= judgeMinConfidence()) {
              const agentId = await resolveAgentId(payTo);
              if (agentId === null) {
                console.warn(
                  `[steward:judge] Tier-1 breach but payTo ${payTo} is not a registered Caliber agent — no evidence attested`,
                );
                return;
              }
              await issueEvidence({
                paymentId,
                spec: judgeSpec,
                verdict: VERDICT.BREACH,
                verifyingTier: 1,
                responseHash: sha256,
                agentId,
                judgeVerdict: verdict,
              });
              console.log(
                `[steward:judge] payment=${paymentId} Tier-1 BREACH attested (verifyingTier=1, confidence=${verdict.confidence})`,
              );
            }
          } catch (e) {
            // Belt-and-suspenders: a judge fault must never escape the payment path.
            console.error('[steward:judge] Tier-1 judge block failed (non-fatal):', e);
          }
        })();
      }
    }

    return {
      httpStatus: 200,
      body: {
        requestId, decision: 'allow', stage: 'executed', reasoning,
        quote: { payTo: payTo ?? '', amountUsdc: settledUsdc },
        txRef: paid.txRef,
        // Expose the ledger row id so a caller can trace post-settle artifacts (the
        // WS-2 EvidenceAttestation rides on the same paymentId). Always present on a
        // settled allow.
        paymentId: paymentId.toString(),
        data: paid.data,
        sha256,
        ...(violated ? { conformance: conformance.violations } : {}),
      },
    };
  }

  /**
   * WS-1 — verify a signed DeliverySpec's quote-independent invariants BEFORE any
   * network call. Returns a refusal PayOutcome (decision 'deny', stage 'policy',
   * HTTP 400) when the spec is invalid, or null when it passes. The one check that
   * needs the live quote (spec.seller == payTo) runs inside preSign instead.
   *
   * Checks: buyer signature recovers to spec.buyer (mandatory); seller signature
   * (when present) recovers to spec.seller; validUntil not in the past; the spec's
   * sellerUrlHash binds to the requested URL. Spec signing is OFF-CHAIN, so the
   * domain's verifyingContract stays the zero-address default.
   */
  private async verifySpecPreNetwork(
    signed: SignedSpec,
    url: string,
    requestId: string,
    source: string,
    host: string,
    started: number,
    reasonPrefix: string,
  ): Promise<PayOutcome | null> {
    const domain = caliberDomain('arc');
    const { spec, buyerSig, sellerSig } = signed;

    const refuse = async (reasoning: string): Promise<PayOutcome> => {
      await writePayment({
        requestId, source, sellerUrl: url, host,
        decision: 'deny', decisionStage: 'policy',
        reasoning: `${reasonPrefix}${reasoning}`,
        settleStatus: 'n/a', latencyMs: Date.now() - started,
      });
      return {
        httpStatus: 400,
        body: { requestId, decision: 'deny', stage: 'policy', reasoning: `${reasonPrefix}${reasoning}` },
      };
    };

    // 1. Buyer signature is mandatory and must recover to spec.buyer.
    const buyerOk = await verifyDeliverySpecSig(spec, buyerSig, spec.buyer as Address, domain);
    if (!buyerOk) {
      let recovered = '(unrecoverable)';
      try { recovered = await recoverDeliverySpecSigner(spec, buyerSig, domain); } catch { /* keep default */ }
      return refuse(`signed spec rejected: buyer signature does not recover to ${spec.buyer} (got ${recovered})`);
    }

    // 2. Seller signature, when present, must recover to spec.seller. Absent = a
    //    buyer-only spec (accepted but undisputable).
    if (sellerSig) {
      const sellerOk = await verifyDeliverySpecSig(spec, sellerSig, spec.seller as Address, domain);
      if (!sellerOk) {
        return refuse(`signed spec rejected: seller signature does not recover to ${spec.seller}`);
      }
    }

    // 3. Expiry: validUntil is unix seconds; 0 = never expires.
    const nowSec = BigInt(Math.floor(Date.now() / 1000));
    if (spec.validUntil !== 0n && spec.validUntil < nowSec) {
      return refuse(`signed spec rejected: validUntil ${spec.validUntil} is in the past (now ${nowSec})`);
    }

    // 4. URL binding: the spec's sellerUrlHash must match the requested URL.
    const expectedUrlHash = sellerUrlHash(url);
    if (spec.sellerUrlHash.toLowerCase() !== expectedUrlHash.toLowerCase()) {
      return refuse(
        `signed spec rejected: sellerUrlHash ${spec.sellerUrlHash} does not bind to the requested URL (expected ${expectedUrlHash})`,
      );
    }

    return null;
  }

  /** WS-1 — build the steward_specs insert row from a verified signed spec. */
  private specRow(signed: SignedSpec): NewStewardSpec {
    const { spec, buyerSig, sellerSig } = signed;
    const specHash = deliverySpecHash(spec, caliberDomain('arc'));
    return {
      specHash,
      chain: 'arc',
      buyer: spec.buyer.toLowerCase(),
      seller: spec.seller.toLowerCase(),
      sellerUrlHash: spec.sellerUrlHash,
      schemaHash: spec.schemaHash,
      maxBytes: spec.maxBytes,
      deadlineMs: spec.deadlineMs,
      requireJson: spec.requireJson,
      requireOkField: spec.requireOkField,
      // validUntil is unix seconds (0 = never); store NULL when unbounded.
      validUntil: spec.validUntil === 0n ? null : new Date(Number(spec.validUntil) * 1000),
      nonce: spec.nonce.toString(),
      buyerSig,
      sellerSig: sellerSig ?? null,
      // Raw typed message with bigint fields as strings so it re-verifies verbatim.
      rawSpec: {
        ...spec,
        validUntil: spec.validUntil.toString(),
        nonce: spec.nonce.toString(),
      },
    };
  }

  /**
   * Ledger a HOLD that was reached BEFORE the network call (route pause, runaway
   * loop). Writes the held payment row (with request_init), optionally raises an
   * incident, enqueues a pending approval, and returns HTTP 202.
   */
  private async holdBeforeNetwork(args: {
    requestId: string;
    source: string;
    url: string;
    host: string;
    started: number;
    requestInit: unknown;
    stage: string;
    code: string;
    reasoning: string;
    detectorHits: Record<string, unknown>[];
    incident?: { kind: string; severity: string; evidence: Record<string, unknown> };
  }): Promise<PayOutcome> {
    const { id: paymentId } = await writePayment({
      requestId: args.requestId, source: args.source, sellerUrl: args.url, host: args.host,
      decision: 'hold', decisionStage: args.stage, reasoning: args.reasoning,
      detectorHits: args.detectorHits,
      requestInit: args.requestInit as never,
      settleStatus: 'n/a', latencyMs: Date.now() - args.started,
    });

    let incidentId: bigint | null = null;
    if (args.incident) {
      const incidentKind = args.incident.kind;
      const inc = await writeIncident({
        kind: incidentKind,
        severity: args.incident.severity,
        host: args.host,
        paymentId,
        evidence: args.incident.evidence,
      });
      incidentId = inc.id;
      await linkIncident(paymentId, incidentId);
      void narrateIncident(incidentId).catch((e) =>
        console.error(`[steward] narrateIncident (${incidentKind}) failed:`, e),
      );
    }

    const { id: approvalId } = await writeApproval(
      {
        paymentId,
        incidentId,
        status: 'pending',
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      },
      args.reasoning,
    );

    return {
      httpStatus: 202,
      body: {
        requestId: args.requestId, decision: 'hold', stage: args.stage, reasoning: args.reasoning,
        approvalId: approvalId.toString(), paymentId: paymentId.toString(),
      },
    };
  }

  /**
   * Ledger + (for detectors) incident + (for holds) approval for a deliberate
   * pre-sign refusal. A PolicyHold / DetectorHold → decision 'hold' (HTTP 202),
   * payment NOT executed; everything else → 'deny' (HTTP 403).
   */
  private async refuse(
    requestId: string,
    source: string,
    url: string,
    host: string,
    quote: X402Quote | null,
    err: PreSignAbort,
    started: number,
    mandateId: bigint | null,
    requestInit: unknown,
    reasonPrefix: string,
  ): Promise<PayOutcome> {
    const quotedUsdc = quote ? microsToUsdc(quote.amountMicros) : null;
    const payTo = quote?.payTo ?? null;
    const isHold =
      err instanceof PolicyHold ||
      err instanceof DetectorHold ||
      err instanceof TreasurerHold ||
      err instanceof SdnHold;
    const decision: 'hold' | 'deny' = isHold ? 'hold' : 'deny';
    const reasoning = `${reasonPrefix}${err.message}`;
    const llmModel =
      err instanceof TreasurerHold || err instanceof TreasurerDeny ? err.llmModel : null;
    // SDN-specific columns ride onto both the deny (sanctioned hit) and the
    // settled-clean rows. A deny carries the result on the error itself.
    const sdnCols =
      err instanceof SdnDeny
        ? {
            sdnSource: err.source,
            sdnCheckedAt: new Date(err.checkedAt),
            sdnResult: { sanctioned: true, source: err.source, checkedAt: err.checkedAt },
          }
        : {};

    const { id: paymentId } = await writePayment({
      requestId, source, sellerUrl: url, host, payTo, quotedUsdc,
      decision, decisionStage: err.stage, reasoning,
      detectorHits: err.hit ? [err.hit] : null,
      // Only held rows need replay; deny rows leave request_init null.
      requestInit: isHold ? (requestInit as never) : undefined,
      mandateId: mandateId ?? null,
      llmModel,
      ...sdnCols,
      settleStatus: 'n/a', latencyMs: Date.now() - started,
    });

    if (isHold) {
      // A hold may also open an incident (new_counterparty, price_spike,
      // or a treasurer downgrade). Treasurer holds always open a 'treasurer'
      // incident so the smart model can narrate WHY the CFO paused it.
      let incidentId: bigint | null = null;
      const incidentKind =
        err instanceof PolicyHold
          ? err.incidentKind
          : err instanceof DetectorHold
            ? err.incidentKind
            : err instanceof TreasurerHold
              ? 'treasurer'
              : undefined;
      if (incidentKind) {
        const evidence: Record<string, unknown> =
          err instanceof DetectorHold && err.evidence
            ? { ...err.evidence, url }
            : { url, quotedUsdc, host };
        const inc = await writeIncident({
          kind: incidentKind,
          severity: incidentKind === 'price_spike' ? 'high' : 'medium',
          host,
          payTo,
          paymentId,
          evidence,
        });
        incidentId = inc.id;
        await linkIncident(paymentId, incidentId);
        // Async narrative for the hold's incident — never blocks the response.
        void narrateIncident(incidentId).catch((e) =>
          console.error(`[steward] narrateIncident (${incidentKind} hold) failed:`, e),
        );
      }

      const { id: approvalId } = await writeApproval(
        {
          paymentId,
          incidentId,
          status: 'pending',
          expiresAt: new Date(Date.now() + 30 * 60 * 1000),
        },
        reasoning,
      );

      return {
        httpStatus: 202,
        body: {
          requestId, decision: 'hold', stage: err.stage, reasoning,
          approvalId: approvalId.toString(), paymentId: paymentId.toString(),
          ...(quote ? { quote: { payTo: payTo ?? '', amountUsdc: quotedUsdc ?? '0' } } : {}),
        },
      };
    }

    // Detector DENY refusals raise an incident and back-link it onto the row.
    if (err instanceof DetectorViolation && err.code === 'redirect' && err.hit) {
      const { id: incidentId } = await writeIncident({
        kind: 'redirect',
        severity: 'high',
        host,
        payTo,
        paymentId,
        evidence: {
          expected: err.hit.expected,
          got: err.hit.got,
          url,
          quotedUsdc,
        },
      });
      await linkIncident(paymentId, incidentId);
      void narrateIncident(incidentId).catch((e) =>
        console.error('[steward] narrateIncident (redirect) failed:', e),
      );
    }

    // SDN hit raises a high-severity 'sdn_hit' incident + narrative.
    if (err instanceof SdnDeny) {
      const { id: incidentId } = await writeIncident({
        kind: 'sdn_hit',
        severity: 'high',
        host,
        payTo,
        paymentId,
        evidence: {
          payTo: err.payTo,
          source: err.source,
          checkedAt: err.checkedAt,
          url,
        },
      });
      await linkIncident(paymentId, incidentId);
      void narrateIncident(incidentId).catch((e) =>
        console.error('[steward] narrateIncident (sdn_hit) failed:', e),
      );
    }

    // Treasurer DENY raises a 'treasurer' incident + narrative.
    if (err instanceof TreasurerDeny) {
      const { id: incidentId } = await writeIncident({
        kind: 'treasurer',
        severity: 'high',
        host,
        payTo,
        paymentId,
        evidence: { url, quotedUsdc, host, reason: err.message },
      });
      await linkIncident(paymentId, incidentId);
      void narrateIncident(incidentId).catch((e) =>
        console.error('[steward] narrateIncident (treasurer deny) failed:', e),
      );
    }

    return {
      httpStatus: 403,
      body: {
        requestId, decision: 'deny', stage: err.stage, reasoning,
        ...(quote ? { quote: { payTo: payTo ?? '', amountUsdc: quotedUsdc ?? '0' } } : {}),
      },
    };
  }
}
