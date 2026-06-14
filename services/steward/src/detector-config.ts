// Env-driven knobs for the runtime detectors (Steward Phase 1, task 16).
//
// Read fresh on each call (not cached) so an env override in a test run takes
// effect without a restart of the module graph. All have safe defaults matching
// the plan; documented in .env.example.

/** Runaway-loop detector config. */
export interface LoopConfig {
  /** Trailing window length, minutes (STEWARD_LOOP_WINDOW_MIN, default 10). */
  windowMinutes: number;
  /** Payments-in-window threshold N (STEWARD_LOOP_N, default 5). */
  threshold: number;
  /** How long to pause a tripped route, minutes (STEWARD_LOOP_PAUSE_MIN, default 30). */
  pauseMinutes: number;
}

function num(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const v = Number(raw);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

export function loopConfig(): LoopConfig {
  return {
    windowMinutes: num('STEWARD_LOOP_WINDOW_MIN', 10),
    threshold: num('STEWARD_LOOP_N', 5),
    pauseMinutes: num('STEWARD_LOOP_PAUSE_MIN', 30),
  };
}

/** Price-spike detector config. */
export interface PriceSpikeConfig {
  /** Settled rows to compute the trailing median over (default 20). */
  window: number;
  /** Minimum settled samples before the median is trusted (default 5). */
  minSamples: number;
  /** quote/median ratio above which we hold (default 3 → >3×). */
  multiplier: number;
}

export function priceSpikeConfig(): PriceSpikeConfig {
  return {
    window: num('STEWARD_PRICE_MEDIAN_WINDOW', 20),
    minSamples: num('STEWARD_PRICE_MIN_SAMPLES', 5),
    multiplier: num('STEWARD_PRICE_SPIKE_MULT', 3),
  };
}
