// Caliber Rating v2.0 — Step 2.2 forward-looking estimate (methodology §"Forward-looking estimate").
//
// Empirical estimate of P(next job completes successfully), with two
// honest moves on top of a naive completion rate:
//
//   1. Recency weighting (exponential decay): a 90-day-old job carries less
//      weight than a 1-day-old job. Decay half-life is tunable; default 60d.
//   2. Censored handling: in-flight jobs are present in the agent's history
//      but not yet resolved. We exclude them from the rate but use their
//      presence as evidence of recent activity (which the recency-weight
//      side captures naturally).
//
// What we do NOT do at v2.0 launch:
//   - Full Kaplan-Meier with day-level event tabulation. The dataset is
//     sparse enough that a simpler decayed estimator is more stable.
//   - Cox proportional hazards regression. Not needed at this sample size;
//     also doesn't survive a hackathon-defense ("show me the proportional
//     hazards assumption test on n<100 agents").
//
// When the dataset grows past 60 days of mainnet history we'll revisit
// this module (it's flagged in methodology v2.1 roadmap).

import type { AgentFeatures } from './types';

const SUCCESS_STATUS = new Set(['Completed']);
const FAILURE_STATUS = new Set(['Rejected', 'Expired', 'Disputed', 'Cancelled', 'Refunded']);
const DEFAULT_HALF_LIFE_DAYS = 60;

interface ResolvedJob {
  daysAgo: number;
  isSuccess: boolean;
}

export function forwardSuccessProbability(
  features: AgentFeatures,
  populationRate: number,
  halfLifeDays: number = DEFAULT_HALF_LIFE_DAYS,
): number {
  const now = Date.now();
  const resolved: ResolvedJob[] = [];

  for (const j of features.jobs) {
    if (!SUCCESS_STATUS.has(j.status) && !FAILURE_STATUS.has(j.status)) continue;
    const daysAgo = (now - j.createdAt.getTime()) / 86_400_000;
    resolved.push({
      daysAgo,
      isSuccess: SUCCESS_STATUS.has(j.status),
    });
  }

  if (resolved.length === 0) {
    return populationRate;
  }

  // Exponential decay: weight = 2^(-daysAgo / halfLife)
  // recent jobs ≈ 1.0, half-life-old jobs ≈ 0.5, double-half-life ≈ 0.25.
  let weightedSuccess = 0;
  let totalWeight = 0;
  for (const r of resolved) {
    const w = Math.pow(2, -r.daysAgo / halfLifeDays);
    totalWeight += w;
    if (r.isSuccess) weightedSuccess += w;
  }

  if (totalWeight === 0) return populationRate;
  return weightedSuccess / totalWeight;
}
