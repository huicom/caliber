// Price-spike detector (Steward Phase 1, task 16).
//
// A known seller that suddenly quotes far above its historical price is either
// compromised, dynamically gouging, or fronting a different resource. Once we
// have enough settled history for a host, we compare the live quote against the
// trailing median; a quote more than `multiplier`× the median is HELD for
// approval (the redteam `overcharge` mode quotes 10× the honest price).
//
// Cold start: with fewer than `minSamples` settled payments the median is not
// trustworthy, so the detector abstains (no hit) — the per-tx policy cap is the
// only price guard until enough history accrues.
//
// Pure function: the caller computes the trailing median over the recent settled
// rows and passes it in alongside the live quote. No DB, no SQL here.

/** USDC decimal string → integer micro-units (6 dp). */
function toMicros(usdc: string): bigint {
  const [whole, frac = ''] = usdc.split('.');
  const fracPadded = (frac + '000000').slice(0, 6);
  return BigInt(whole || '0') * 1_000_000n + BigInt(fracPadded || '0');
}

/** Inputs the price-spike detector inspects (all USDC as decimal strings). */
export interface PriceSpikeInput {
  /** What the seller wants paid on THIS quote, decimal USDC string. */
  quoteUsdc: string;
  /** Trailing median price for the host, decimal USDC string (null if unknown). */
  medianUsdc: string | null;
  /** How many settled samples backed the median. */
  sampleCount: number;
  /** Minimum settled samples before the median is trusted (default 5). */
  minSamples: number;
  /** Quote/median ratio above which we fire (default 3 → >3×). */
  multiplier: number;
}

/** Structured result: `hit` plus the numbers that tripped it (when hit). */
export interface PriceSpikeResult {
  hit: boolean;
  /** The live quote (decimal USDC) — present only on a hit. */
  quote?: string;
  /** The trailing median (decimal USDC) — present only on a hit. */
  median?: string;
  /** quote ÷ median — present only on a hit. */
  ratio?: number;
}

/**
 * Fire when the quote strictly exceeds `multiplier`× the trailing median. Skips
 * (no hit) when there aren't enough samples or the median is null/zero — a zero
 * median would make every nonzero quote an "infinite" spike, which is noise.
 */
export function checkPriceSpike(input: PriceSpikeInput): PriceSpikeResult {
  if (input.sampleCount < input.minSamples) return { hit: false };
  if (input.medianUsdc === null) return { hit: false };

  const median = toMicros(input.medianUsdc);
  if (median === 0n) return { hit: false };

  const quote = toMicros(input.quoteUsdc);
  // quote > multiplier * median, done in integer micro-units to avoid float drift.
  // multiplier may be fractional in principle, so scale by 1000 then compare.
  const scaledMultiplier = BigInt(Math.round(input.multiplier * 1000));
  if (quote * 1000n > median * scaledMultiplier) {
    const ratio = Number(quote) / Number(median);
    return {
      hit: true,
      quote: input.quoteUsdc,
      median: input.medianUsdc,
      ratio: Math.round(ratio * 100) / 100,
    };
  }
  return { hit: false };
}
