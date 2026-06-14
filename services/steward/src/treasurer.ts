// The LLM treasurer (Steward Phase 1, task 15) — the hot-path judgment layer.
//
// Runs ONLY after every deterministic check has passed and the payment would be
// ALLOWED. The treasurer can ONLY DOWNGRADE allow → hold/deny; it can never
// override a deterministic deny/hold (those already short-circuited earlier).
//
// Master-switch + fail-closed semantics live in the caller (pipeline.ts), which
// only invokes this when getLlmRuntime() returned a runtime. This module owns
// the prompt + the verdict decode. The FAST model is used (every payment), with
// a hard ~4s timeout so the request never stalls past the pipeline budget.

import { z } from 'zod';
import type { LlmRuntime } from './llm-config.js';
import { offerSharePost } from './telegram.js';

/** What the treasurer can decide. It can only DOWNGRADE an allow. */
const TreasurerVerdictSchema = z.object({
  verdict: z.enum(['allow', 'hold', 'deny']),
  reason: z.string().max(160),
});

export type TreasurerVerdict = z.infer<typeof TreasurerVerdictSchema>;

/** The compact context the treasurer reasons over (no secrets, no raw bodies). */
export interface TreasurerInput {
  quotedUsdc: string;
  host: string;
  payTo: string;
  todaySpentUsdc: string;
  dailyCapUsdc: string;
  isNewCounterparty: boolean;
  /** Counterparty Caliber score, when known. */
  caliberScore?: number;
  /** The active mandate's plain-English intent (raw_text). */
  mandateIntent: string;
}

// HTTP transport: mimo-v2.5-pro returns clean JSON in ~3.3s. Give the hot path
// a 12s hard budget so a slow call still has headroom but never stalls the
// pipeline indefinitely (it fails closed to a treasurer hold on timeout).
const FAST_TIMEOUT_MS = 12_000;

const SYSTEM_PROMPT = `You are Steward, an AI agent's CFO, deciding whether to release ONE micropayment that has already passed every hard spending rule. Your job is a final judgment call: is this payment worth it and consistent with the owner's intent?

Reply with ONLY a JSON object: {"verdict": "allow"|"hold"|"deny", "reason": "<= 120 chars"}.

- "allow": release the payment. This is the default unless something looks off.
- "hold": pause for the owner's approval (suspicious but not clearly malicious).
- "deny": refuse outright (clearly inconsistent with the mandate or abusive).

You may ONLY downgrade. The deterministic engine already approved this against the caps, allowlists, detectors and SDN screen — so do not re-litigate those; focus on judgment: does the spend fit the owner's stated intent, is the price reasonable for what's bought, is a brand-new counterparty worth trusting here. Keep the reason short and concrete.`;

/**
 * Ask the FAST model for a final judgment. Returns the verdict. THROWS the
 * underlying LlmError (timeout / credits / parse / http) on failure — the caller
 * decides fail-closed behavior from STEWARD_LLM_FALLBACK.
 */
export async function treasurerDecide(
  rt: LlmRuntime,
  input: TreasurerInput,
): Promise<TreasurerVerdict> {
  const user = JSON.stringify({
    quoted_usdc: input.quotedUsdc,
    host: input.host,
    pay_to: input.payTo,
    today_spent_usdc: input.todaySpentUsdc,
    daily_cap_usdc: input.dailyCapUsdc,
    counterparty: input.isNewCounterparty ? 'new (never paid before)' : 'trusted (paid before)',
    caliber_score: input.caliberScore ?? 'unknown',
    owner_mandate: input.mandateIntent,
  });

  const verdict = await rt.client.chatJson({
    model: rt.fastModel,
    system: SYSTEM_PROMPT,
    user: `Decide on this payment:\n${user}`,
    maxTokens: 120,
    timeoutMs: FAST_TIMEOUT_MS,
    schema: TreasurerVerdictSchema,
  });

  // Hackathon traction hook: when the treasurer DOWNGRADES an otherwise-allowed
  // payment (allow→hold / allow→deny) — "the agent decided to stop the money" —
  // offer the owner a ready-to-post X draft. FIRE-AND-FORGET + cooldown-gated:
  // offerSharePost swallows all its own errors and never throws, so this can
  // never block or fail the payment path. Routine allows never fire.
  if (verdict.verdict === 'hold' || verdict.verdict === 'deny') {
    void offerSharePost({
      kind: verdict.verdict,
      host: input.host,
      amountUsdc: input.quotedUsdc,
      reason: verdict.reason,
      payTo: input.payTo,
    });
  }

  return verdict;
}
