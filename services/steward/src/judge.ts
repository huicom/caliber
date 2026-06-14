// The Tier-1 LLM judge (Steward Phase 2, WS-4) — adjudicates a delivered response
// against the buyer/seller-signed DeliverySpec.
//
// HARD RULE: the judge adjudicates CONFORMANCE TO THE SIGNED SPEC ONLY — the
// fields both parties pre-agreed and signed (schema/shape, size bounds, deadline,
// JSON-ness, error semantics). It NEVER judges subjective quality, usefulness,
// accuracy, or style. That hard rule is stated verbatim in the system prompt and
// is the entire point of the layer: a breach is provable + attributable because it
// is measured against a signed contract, not against taste.
//
// TIER PLACEMENT: Tier-1 sits ABOVE Tier-0 (the deterministic conformance.ts
// checks). It is an ADDITIONAL check that only ADDS confidence to a breach. It can
// corroborate a Tier-0 breach, or surface a breach Tier-0's coarse rules missed —
// but it must never CLEAR a Tier-0 breach and never PENALIZE on its own when the
// LLM is unavailable.
//
// FAIL-SAFE (load-bearing): on ANY LlmError (timeout / credits / parse / http) the
// judge returns { conforms: true, violations: [], confidence: 0 }. An LLM outage
// must NOT manufacture a breach — a breach issues an on-chain attestation + a
// synthetic negative validator observation that lowers the seller's Caliber score,
// so a false breach from a flaky gateway would be a real, durable harm. Tier-1 is
// purely additive: when it can't run, the system simply falls back to Tier-0.
//
// Pure-ish: this module takes the runtime client IN and reads no process.env and
// touches no DB. The pipeline / endpoint owns the runtime resolution + the
// persistence of the returned verdict.

import { z } from 'zod';
import { LlmError, type DeliverySpec, type ConformanceViolation } from '@caliber/steward-core';
import type { LlmRuntime } from './llm-config.js';

/** The structured verdict the judge returns. */
export interface JudgeVerdict {
  /** True iff the delivered response conforms to the signed spec's fields. */
  conforms: boolean;
  /** Per-field breaches the judge found. Empty when conforms. */
  violations: { field: string; reason: string }[];
  /** 0..1 — the judge's confidence in its verdict. 0 on an LLM outage (fail-safe). */
  confidence: number;
}

/** zod schema the model's JSON answer must satisfy (validated by chatJson). */
const JudgeVerdictSchema = z.object({
  conforms: z.boolean(),
  violations: z
    .array(
      z.object({
        field: z.string().max(64),
        reason: z.string().max(280),
      }),
    )
    .max(16),
  confidence: z.number().min(0).max(1),
});

/** Inputs the judge reasons over. The pipeline passes the in-memory response body. */
export interface JudgeInput {
  /** The signed, pre-agreed DeliverySpec — the ONLY thing conformance is judged against. */
  spec: DeliverySpec;
  /** The actual delivered response body (truncated to a token budget before sending). */
  responseBody: string;
  /** The delivered Content-Type header value (or null). */
  contentType: string | null;
  /** Round-trip latency in ms (vs spec.deadlineMs). */
  latencyMs: number;
  /** The Tier-0 violations already found, so the judge corroborates rather than re-derives. */
  tier0Violations: ConformanceViolation[];
}

// The judge uses the SMART model; give it a generous-but-bounded budget so a
// slow reasoning model still answers without stalling the (already fire-and-forget)
// sampled path. 20s matches the smart-model headroom the mandate compiler uses.
const JUDGE_TIMEOUT_MS = 20_000;
const JUDGE_MAX_TOKENS = 700;

// Cap the body we ship to the model. Conformance is about SHAPE, not full content,
// so a head + tail sample is enough to judge JSON-ness / schema / error-semantics
// while staying well inside the token budget. We note the truncation explicitly.
const BODY_BUDGET_CHARS = 8_000;

const SYSTEM_PROMPT = `You are the Tier-1 conformance judge inside Steward, an AI agent's payment guardian.

You adjudicate ONLY whether the delivered response conforms to the fields of the pre-agreed, signed DeliverySpec (schema/shape, size bounds, deadline, JSON-ness, error semantics). You do NOT judge subjective quality, usefulness, accuracy, or style. Output only the structured verdict.

The DeliverySpec is a contract both the buyer and the seller cryptographically signed BEFORE payment. Your job is strictly mechanical: did the delivered bytes satisfy the fields the parties signed?

Judge ONLY these spec fields:
- requireJson: the body must parse as JSON and the Content-Type must claim JSON.
- requireOkField: when the body is a JSON object with an "ok" boolean, it must be true (ok:false / retry-bait is a breach of error semantics).
- maxBytes: the body must not exceed this byte budget (0 = no limit).
- deadlineMs: the round-trip latency must not exceed this (0 = no limit).
- schemaHash: an opaque commitment to the agreed schema — you cannot reverse it, so do NOT invent schema rules from it; rely on requireJson/requireOkField for shape.

NEVER do any of the following:
- Do not judge whether the content is high-quality, correct, complete, useful, well-written, or on-topic.
- Do not invent requirements the spec did not state.
- Do not flag a conforming response just because the content seems thin or generic.

Reply with ONLY a JSON object: {"conforms": <bool>, "violations": [{"field": "<spec field>", "reason": "<= 200 chars, mechanical>"}], "confidence": <0..1>}.
- conforms=true with an empty violations array when every judged field is satisfied.
- conforms=false with one violation per breached field otherwise.
- confidence reflects how certain you are the response does/does not conform to the signed fields (1 = certain).`;

/**
 * Ask the SMART model whether the delivered response conforms to the signed spec.
 *
 * FAIL-SAFE: on any LlmError this returns { conforms: true, violations: [],
 * confidence: 0 } — an LLM outage must never manufacture a breach (see the module
 * header). Any non-LlmError is unexpected and also coerced to the same fail-safe
 * verdict so the (fire-and-forget) caller can never throw on a judge fault.
 */
export async function judgeConformance(
  rt: LlmRuntime,
  input: JudgeInput,
): Promise<JudgeVerdict> {
  const failSafe: JudgeVerdict = { conforms: true, violations: [], confidence: 0 };

  // Truncate the body to the token budget; tell the model when we did so it never
  // treats a deliberate head-sample as a max_bytes breach.
  const fullLen = input.responseBody.length;
  const truncated = fullLen > BODY_BUDGET_CHARS;
  const bodySample = truncated
    ? input.responseBody.slice(0, BODY_BUDGET_CHARS)
    : input.responseBody;

  const user = JSON.stringify({
    signed_spec_bounds: {
      requireJson: input.spec.requireJson,
      requireOkField: input.spec.requireOkField,
      // 0 means "no limit" for both byte/deadline bounds (see expectFromSpec).
      maxBytes: input.spec.maxBytes,
      deadlineMs: input.spec.deadlineMs,
      schemaHash: input.spec.schemaHash,
    },
    delivered: {
      content_type: input.contentType ?? '(none)',
      latency_ms: input.latencyMs,
      body_bytes: Buffer.byteLength(input.responseBody, 'utf8'),
      body_truncated_for_review: truncated,
      body_sample_chars: bodySample.length,
      body: bodySample,
    },
    // The deterministic Tier-0 layer already found these. Corroborate or extend —
    // do not silently contradict a mechanical Tier-0 finding without a clear reason.
    tier0_violations: input.tier0Violations.map((v) => ({ rule: v.rule, detail: v.detail })),
  });

  try {
    const verdict = await rt.client.chatJson({
      model: rt.smartModel,
      system: SYSTEM_PROMPT,
      user: `Adjudicate this delivery against the signed DeliverySpec:\n${user}`,
      maxTokens: JUDGE_MAX_TOKENS,
      timeoutMs: JUDGE_TIMEOUT_MS,
      schema: JudgeVerdictSchema,
    });
    // Normalize: a conforming verdict should carry no violations (defensive — a
    // model could emit conforms:true with stray entries).
    if (verdict.conforms) verdict.violations = [];
    return verdict;
  } catch (err) {
    // FAIL-SAFE: never let a judge fault penalize the seller. An LlmError (the
    // expected fault) is logged at info level; anything else is unexpected.
    if (err instanceof LlmError) {
      console.warn(
        `[steward:judge] LLM unavailable (${err.kind}) — failing SAFE to conforms:true confidence:0 (no breach manufactured)`,
      );
    } else {
      console.error('[steward:judge] unexpected judge fault — failing safe:', err);
    }
    return failSafe;
  }
}
