// LLM wiring for the service (Steward Phase 1, tasks 14–15 + 19).
//
// The MASTER SWITCH lives here: `treasurerEnabled()` reads STEWARD_TREASURER_ENABLED.
// When it returns false, the entire LLM layer (treasurer / mandate compiler /
// incident narrator) is inert and the pipeline behaves EXACTLY as the pure
// deterministic system does today — no client is built, no network call is made.
//
// Env reads live in the SERVICE (per the core's purity contract); steward-core's
// llm.ts takes config in and reads nothing from process.env.

import { createLlmClient, type LlmClient } from '@caliber/steward-core';

/** How to behave when the LLM errors while the treasurer is ENABLED.
 *  'hold'  → fail closed: hold the payment (default, per plan §3 step 6).
 *  'allow' → degrade to deterministic allow. */
export type LlmFallback = 'hold' | 'allow';

export interface LlmRuntime {
  client: LlmClient;
  fastModel: string;
  smartModel: string;
  fallback: LlmFallback;
}

/** The master switch. When false, no LLM code path runs. */
export function treasurerEnabled(): boolean {
  return process.env.STEWARD_TREASURER_ENABLED?.trim() === '1';
}

/** Fail-closed policy when the treasurer is enabled and the LLM errors. */
export function llmFallback(): LlmFallback {
  return process.env.STEWARD_LLM_FALLBACK?.trim() === 'allow' ? 'allow' : 'hold';
}

function req(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) {
    throw new Error(
      `[steward] STEWARD_TREASURER_ENABLED=1 but ${name} is unset — ` +
        'set STEWARD_MODEL_FAST / STEWARD_MODEL_SMART in .env',
    );
  }
  return v;
}

// Built lazily + memoized: nothing is constructed while the switch is off, so an
// unfunded / unset gateway never affects the deterministic-only deployment.
let cached: LlmRuntime | null = null;

/**
 * The LLM runtime, or null when the master switch is OFF. Callers MUST treat
 * null as "treasurer disabled — behave deterministically". Throws only if the
 * switch is ON but the required env is missing (a misconfiguration to surface).
 */
export function getLlmRuntime(): LlmRuntime | null {
  if (!treasurerEnabled()) return null;
  if (cached) return cached;
  cached = {
    // HTTP transport: the OpenCode Go subscription is reachable over plain HTTP
    // at OPENCODE_BASE_URL (the `/zen/go/v1` OpenAI-compatible endpoint, NOT the
    // `/zen/v1` credits endpoint). Bearer auth from OPENCODE_API_KEY. Env reads
    // live here in the service per the core's purity contract.
    client: createLlmClient({
      baseUrl: req('OPENCODE_BASE_URL'),
      apiKey: req('OPENCODE_API_KEY'),
    }),
    fastModel: req('STEWARD_MODEL_FAST'),
    smartModel: req('STEWARD_MODEL_SMART'),
    fallback: llmFallback(),
  };
  return cached;
}

/** Test/diagnostic helper — drop the memoized runtime (e.g. after toggling env). */
export function resetLlmRuntime(): void {
  cached = null;
  judgeCached = null;
}

// ───────────────────────────────────────────────────────────────────────────
// Tier-1 LLM judge (Steward Phase 2, WS-4) — a SEPARATE master switch.
//
// The judge is the Tier-1 adjudication layer ABOVE Tier-0 deterministic
// conformance. It runs on a sampled basis for SIGNED-spec payments only and can
// ONLY ADD confidence to a breach — never manufacture one (an LLM outage is
// fail-SAFE: conforms:true, confidence 0). Because it is purely additive +
// fail-safe it has its OWN switch (STEWARD_JUDGE_ENABLED), independent of the
// treasurer master switch: the deterministic-only deployment (treasurer off) can
// still run the Tier-1 judge for stronger breach evidence, and the demo's
// ephemeral Steward (treasurer OFF) can exercise WS-4 without re-enabling the
// non-deterministic hot-path treasurer.
// ───────────────────────────────────────────────────────────────────────────

/** The Tier-1 judge master switch. When false, no judge LLM code path runs. */
export function judgeEnabled(): boolean {
  return process.env.STEWARD_JUDGE_ENABLED?.trim() === '1';
}

/**
 * Sampling rate (0..1) for the in-pipeline Tier-1 judge on SIGNED-spec payments.
 * Default 1.0 for the demo: signed-spec volume is low, so we judge EVERY
 * signed-spec payment to make WS-4 demonstrable. In production this would be
 * lowered (the judge is an LLM call per signed-spec settle) — Tier-0 still runs on
 * 100% of payments regardless; sampling only governs the additive Tier-1 layer.
 */
export function judgeSampleRate(): number {
  const raw = process.env.STEWARD_JUDGE_SAMPLE_RATE?.trim();
  if (!raw) return 1.0;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 1.0;
  return Math.min(1, Math.max(0, n));
}

/**
 * Minimum judge confidence required for a Tier-1 conforms:false verdict to ISSUE
 * its own breach attestation (when Tier-0 hasn't already attested). Below this the
 * judge result is logged but not acted on — guarding against a low-confidence LLM
 * call manufacturing an on-chain breach. Default 0.7.
 */
export function judgeMinConfidence(): number {
  const raw = process.env.STEWARD_JUDGE_MIN_CONFIDENCE?.trim();
  if (!raw) return 0.7;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0.7;
  return Math.min(1, Math.max(0, n));
}

let judgeCached: LlmRuntime | null = null;

/**
 * The LLM runtime for the Tier-1 judge, or null when STEWARD_JUDGE_ENABLED!=='1'.
 * Reuses the same OpenCode gateway client + model env as the treasurer (the
 * judge uses the SMART model). Built lazily + memoized; throws only if the switch
 * is ON but the required gateway/model env is missing.
 */
export function getJudgeRuntime(): LlmRuntime | null {
  if (!judgeEnabled()) return null;
  // When the treasurer is also enabled, share its already-built runtime.
  const shared = getLlmRuntime();
  if (shared) return shared;
  if (judgeCached) return judgeCached;
  judgeCached = {
    client: createLlmClient({
      baseUrl: req('OPENCODE_BASE_URL'),
      apiKey: req('OPENCODE_API_KEY'),
    }),
    fastModel: req('STEWARD_MODEL_FAST'),
    smartModel: req('STEWARD_MODEL_SMART'),
    fallback: llmFallback(),
  };
  return judgeCached;
}
