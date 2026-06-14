// Runaway-loop detector (Steward Phase 1, task 16).
//
// A naive agent that retries a paid call in a tight loop (the redteam `loopbait`
// mode does exactly this: every paid response says "retry now") burns the
// treasury one nanopayment at a time. This detector counts how many payment
// intents we've sent to a host inside a trailing window; once that count reaches
// a threshold, the next payment is HELD and the route is auto-paused so the loop
// can't continue while a human looks.
//
// Pure function: the caller supplies the already-counted number of recent
// payments to the host and the configured threshold/window. No DB, no clock —
// same purity contract as the redirect detector.

/** Inputs the loop detector inspects. */
export interface LoopCheckInput {
  /** Payments already sent to this host inside the trailing window. */
  recentCount: number;
  /** Threshold N: at or above this many payments in the window → fire. */
  threshold: number;
  /** Window length in minutes (carried only for the evidence blob). */
  windowMinutes: number;
}

/** Structured result: `hit` plus the count/window that tripped it (when hit). */
export interface LoopResult {
  hit: boolean;
  /** Payments counted in the window — present only on a hit. */
  count?: number;
  /** Window length in minutes — present only on a hit. */
  windowMinutes?: number;
}

/**
 * Fire when the trailing payment count to a host reaches the threshold. The
 * count the caller passes EXCLUDES the current (about-to-be-made) payment, so a
 * threshold of N means "the Nth+1 attempt is held" — i.e. once N have already
 * gone out in the window, the next one trips. Comparing `>=` keeps the boundary
 * predictable for the env override used in acceptance (N=3 → 4th pay held).
 */
export function checkRunawayLoop(input: LoopCheckInput): LoopResult {
  if (input.recentCount >= input.threshold) {
    return { hit: true, count: input.recentCount, windowMinutes: input.windowMinutes };
  }
  return { hit: false };
}
