// Broker risk math (Lepton Phase 2, D4). Pure functions — no I/O — so the
// decline rule is easy to reason about and could be unit-tested.
//
// Bond sizing reuses the on-chain CaliberEscrow / /integrate schedule exactly
// (do NOT invent rates): tier-stepped bps, hard cap 50% of job value. The bond
// is the broker's own collateral, so the broker only takes a match when the
// fee it charges covers the expected slash loss.

export type Tier = 'Gold' | 'Silver' | 'Bronze' | 'Pending' | 'Watch' | 'Dormant';

/** Tier → bond rate in basis points. Watch/Dormant are refused (no bond). */
const BOND_BPS: Record<Tier, number | null> = {
  Gold: 50,
  Silver: 150,
  Bronze: 500,
  Pending: 1500,
  Watch: null,
  Dormant: null,
};

/** Hard cap: a bond can never exceed 50% of the job value (matches MAX_BOND_BPS). */
export const MAX_BOND_BPS = 5000;

export function bondBpsForTier(tier: Tier): number | null {
  return BOND_BPS[tier] ?? null;
}

/** USDC bond for a job value at a tier, or null if the tier is unbondable. */
export function requiredBond(jobValueUsdc: number, tier: Tier): number | null {
  const bps = bondBpsForTier(tier);
  if (bps == null) return null;
  const capped = Math.min(bps, MAX_BOND_BPS);
  return (jobValueUsdc * capped) / 10_000;
}

/**
 * Estimate the probability the job fails (rejected/expired) from the signed
 * attestation. Score is the dominant signal (higher score → lower failure);
 * any risk flag bumps the estimate. Bounded to [0.01, 0.95].
 */
export function estimatePFail(score: number, flags: string[]): number {
  let p = (100 - score) / 100; // score 100 → 0, score 50 → 0.5
  if (flags.length > 0) p += 0.15 * flags.length;
  return Math.max(0.01, Math.min(0.95, p));
}

/** Broker fee: value-scaled but sub-cent-capable. Default max($0.01, 25 bps). */
export function brokerFee(jobValueUsdc: number, feeBps: number, feeMinUsdc: number): number {
  return Math.max(feeMinUsdc, (jobValueUsdc * feeBps) / 10_000);
}

export interface Candidate {
  agentId: string;
  tier: Tier;
  score: number;
  flags: string[];
}

export interface Verdict {
  accept: boolean;
  reason: string;
  bondUsdc: number | null;
  feeUsdc: number;
  pFail: number;
  expectedLossUsdc: number | null;
}

/**
 * The decline rule — the headline agentic decision. The broker stakes `bond`;
 * if the job fails (prob pFail) it loses the bond. It earns `fee`. So expected
 * value ≈ fee − pFail·bond. If the expected slash loss exceeds the fee plus a
 * safety margin, the broker DECLINES rather than take unprofitable risk.
 */
export function evaluateCandidate(
  c: Candidate,
  jobValueUsdc: number,
  opts: { feeBps: number; feeMinUsdc: number; marginUsdc: number; maxFeeUsdc?: number },
): Verdict {
  const fee = brokerFee(jobValueUsdc, opts.feeBps, opts.feeMinUsdc);
  const pFail = estimatePFail(c.score, c.flags);
  const bond = requiredBond(jobValueUsdc, c.tier);

  if (c.flags.length > 0) {
    return { accept: false, reason: `provider #${c.agentId} carries risk flags [${c.flags.join(', ')}] — declined`, bondUsdc: bond, feeUsdc: fee, pFail, expectedLossUsdc: bond != null ? pFail * bond : null };
  }
  if (bond == null) {
    return { accept: false, reason: `provider #${c.agentId} tier ${c.tier} is unbondable — declined`, bondUsdc: null, feeUsdc: fee, pFail, expectedLossUsdc: null };
  }
  if (opts.maxFeeUsdc != null && fee > opts.maxFeeUsdc) {
    return { accept: false, reason: `fee $${fee.toFixed(4)} exceeds requester max $${opts.maxFeeUsdc.toFixed(4)} — declined`, bondUsdc: bond, feeUsdc: fee, pFail, expectedLossUsdc: pFail * bond };
  }
  const expectedLoss = pFail * bond;
  if (expectedLoss > fee + opts.marginUsdc) {
    return {
      accept: false,
      reason: `expected slash loss $${expectedLoss.toFixed(4)} (p_fail ${(pFail * 100).toFixed(1)}% × bond $${bond.toFixed(2)}) exceeds fee $${fee.toFixed(4)} + margin $${opts.marginUsdc.toFixed(4)} — declined`,
      bondUsdc: bond, feeUsdc: fee, pFail, expectedLossUsdc: expectedLoss,
    };
  }
  return {
    accept: true,
    reason: `tier ${c.tier}, score ${c.score}, p_fail ${(pFail * 100).toFixed(1)}% · bond $${bond.toFixed(2)} priced; fee $${fee.toFixed(4)} covers expected loss $${expectedLoss.toFixed(4)} — accept`,
    bondUsdc: bond, feeUsdc: fee, pFail, expectedLossUsdc: expectedLoss,
  };
}
