import type { AgentFeatures } from './types';

/**
 * §6 — Exposure at Default: funded escrow only (v1).
 *
 * EAD = sum of jobs.budget_usdc where status IN ('Funded', 'Submitted')
 * and the agent is the provider.
 */
export function computeEAD(features: AgentFeatures): number {
  let total = 0;
  for (const j of features.jobs) {
    if (j.status === 'Funded' || j.status === 'Submitted') {
      total += j.budgetUsdc ? Number(j.budgetUsdc) : 0;
    }
  }
  return total;
}
