// Mandate compiler (Steward Phase 1, task 14).
//
// Translate a plain-English spending mandate into the EXACT CompiledPolicy JSON
// shape the deterministic evaluator enforces, using the SMART model. The output
// is validated against CompiledPolicySchema (one retry on validation failure),
// and the model is asked to report anything in the text it couldn't map as
// `warnings`. Gated by the master switch at the route layer (see server.ts) —
// this module assumes the runtime was already obtained.

import { z } from 'zod';
import {
  CompiledPolicySchema,
  LlmError,
  type CompiledPolicy,
} from '@caliber/steward-core';
import { getLlmRuntime } from './llm-config.js';

/** The compiler's structured output: the policy + any unmapped-intent warnings. */
const CompileOutputSchema = z.object({
  policy: CompiledPolicySchema,
  warnings: z.array(z.string()).default([]),
});

export interface CompileResult {
  policy: CompiledPolicy;
  warnings: string[];
}

const SYSTEM_PROMPT = `You are Steward's mandate compiler. You translate a plain-English spending mandate (what an AI agent's owner will allow it to pay) into a STRICT JSON "compiled policy" that a deterministic engine enforces on every payment.

You MUST reply with ONLY a single JSON object of this exact shape (no prose, no markdown):

{
  "policy": {
    "version": 1,                          // always the literal 1
    "caps": {
      "perTxUsdc": "<decimal string>",     // REQUIRED. max USDC per single payment, e.g. "0.005"
      "dailyUsdc": "<decimal string>",     // REQUIRED. max total USDC per UTC day, e.g. "0.50"
      "perCounterpartyDailyUsdc": "<decimal string>"  // OPTIONAL. max per recipient per day
    },
    "allowedHosts": ["example.com"],        // OPTIONAL. if present, ONLY these hosts may be paid (suffix match: "poko.blue" matches "api.poko.blue")
    "deniedHosts": ["bad.com"],             // OPTIONAL. hosts that may NEVER be paid (suffix match); beats allowedHosts
    "approvalThresholdUsdc": "<decimal>",   // OPTIONAL. any single payment strictly ABOVE this is HELD for human approval
    "newCounterparty": "allow|hold|sandbox",// REQUIRED. what to do with a recipient never paid before:
                                            //   "allow"   = pay it (trust on first use)
                                            //   "hold"    = park the first payment for approval
                                            //   "sandbox" = allow but cap it at sandboxCapUsdc
    "sandboxCapUsdc": "<decimal>",          // OPTIONAL. required only when newCounterparty="sandbox"
    "minCaliberScore": 0-100                // OPTIONAL integer. min counterparty Caliber score (0-100); enforced only when a score is known
  },
  "warnings": ["..."]                       // any intent in the mandate you could NOT map to a field above
}

Rules:
- ALL USDC amounts are decimal STRINGS with at most 6 decimal places, no "$", no commas. "$0.20 a day" -> dailyUsdc "0.20".
- caps.perTxUsdc and caps.dailyUsdc are REQUIRED. If the mandate omits a daily cap, infer a sensible one (e.g. 100x the per-tx cap) and add a warning saying you inferred it.
- "needs my approval / my OK above $X" -> approvalThresholdUsdc "X".
- "never pay anyone new without my OK" / "hold the first payment to anyone new" -> newCounterparty "hold".
- "anyone new is fine" / no mention of new counterparties -> newCounterparty "allow".
- Only include OPTIONAL fields you can actually derive. Omit (do not null) anything not mentioned.
- Do NOT invent hosts, scores, or caps that the mandate doesn't imply. Put anything you can't express into warnings.`;

/**
 * Compile a plain-English mandate into a CompiledPolicy using the SMART model.
 * Validates with CompiledPolicySchema (retry once on validation failure via the
 * client's built-in nudge). Throws an LlmError on credits/timeout/http/parse
 * failure — the route maps that to a clean 502.
 */
export async function compileMandate(rawText: string): Promise<CompileResult> {
  const rt = getLlmRuntime();
  if (!rt) {
    // Should never be reached — the route gates on the master switch first.
    throw new LlmError('http', 'treasurer disabled — mandate compiler unavailable');
  }

  const out = await rt.client.chatJson({
    model: rt.smartModel,
    system: SYSTEM_PROMPT,
    user: `Compile this mandate into the JSON policy:\n\n"""${rawText.trim()}"""`,
    // The SMART model is a reasoning model — its reasoning trace must finish
    // before it emits the final JSON in `content`, so give it generous headroom.
    maxTokens: 3000,
    timeoutMs: 30_000,
    schema: CompileOutputSchema,
  });

  return { policy: out.policy, warnings: out.warnings ?? [] };
}
