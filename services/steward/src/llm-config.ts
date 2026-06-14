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
}
