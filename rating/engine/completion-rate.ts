// Caliber Rating v2.0 — Step 1 features (methodology §"How the Rating Gets Built").
//
// Summarizes an agent's raw on-chain history into reliability metrics the
// downstream credibility / survival / flags modules consume. Pure function:
// same AgentFeatures input → same output.

import type { AgentFeatures } from './types';

const SUCCESS_STATUS = new Set(['Completed']);
const FAILURE_STATUS = new Set(['Rejected', 'Expired', 'Disputed', 'Cancelled', 'Refunded']);
const IN_FLIGHT_STATUS = new Set(['Open', 'Funded', 'Submitted', 'Created']);

export interface CompletionFeatures {
  completedJobs: number;
  disputedJobs: number;     // includes Rejected/Expired/Disputed/Cancelled/Refunded
  inFlightJobs: number;
  resolvedJobs: number;     // completed + disputed
  completionRate: number;   // [0,1] — completed / resolved (NaN→0 if no resolved jobs)
  disputeRate: number;

  totalSettledUsdc: number; // sum of completed-job budgets
  medianSettledUsdc: number;
  activeEscrowUsdc: number; // sum of in-flight funded budgets

  meanLatencyHours: number; // mean (created_at → block-derived completion) for completed jobs
  latencyCv: number;        // coefficient of variation (sd/mean) of latency; lower = more consistent

  uniqueClients: number;
  topClientShare: number;   // [0,1]
  uniqueValidators: number;
  topValidatorShare: number;

  /** Last on-chain activity timestamp (max over jobs.createdAt, feedback.createdAt). */
  lastActivityAt: Date | null;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function topShare(counts: Map<string, number>): number {
  if (counts.size === 0) return 0;
  const total = Array.from(counts.values()).reduce((a, b) => a + b, 0);
  if (total === 0) return 0;
  const top = Math.max(...counts.values());
  return top / total;
}

export function computeCompletionFeatures(features: AgentFeatures): CompletionFeatures {
  let completedJobs = 0;
  let disputedJobs = 0;
  let inFlightJobs = 0;
  let totalSettled = 0;
  let activeEscrow = 0;
  const settledAmounts: number[] = [];
  const latenciesHours: number[] = [];
  const clientCounts = new Map<string, number>();
  let lastActivityMs = 0;

  for (const j of features.jobs) {
    const budget = Number(j.budgetUsdc ?? 0);
    const ts = j.createdAt.getTime();
    if (ts > lastActivityMs) lastActivityMs = ts;

    // Counterparty concentration is computed over ALL jobs (not just resolved)
    // — an agent overweight on one client is concentrated even if the work is
    // still in-flight.
    if (j.clientAddress) {
      clientCounts.set(j.clientAddress, (clientCounts.get(j.clientAddress) ?? 0) + 1);
    }

    if (SUCCESS_STATUS.has(j.status)) {
      completedJobs++;
      totalSettled += budget;
      if (budget > 0) settledAmounts.push(budget);

      // Latency = createdAt → block-derived completion time. We don't have
      // completed_at as a timestamp; we have completedAtBlock. Estimate from
      // updatedAt as a proxy for now (works on the indexed dataset because
      // updatedAt is set when the row is mutated on Completed).
      if (j.completedAtBlock) {
        const latencyMs = j.updatedAt.getTime() - j.createdAt.getTime();
        if (latencyMs > 0) latenciesHours.push(latencyMs / 3_600_000);
      }
    } else if (FAILURE_STATUS.has(j.status)) {
      disputedJobs++;
    } else if (IN_FLIGHT_STATUS.has(j.status)) {
      inFlightJobs++;
      // Active escrow = funded in-flight budget only (mirrors v1 EAD §6.2)
      if (j.status === 'Funded' || j.status === 'Submitted') {
        activeEscrow += budget;
      }
    }
  }

  for (const f of features.feedbackEvents) {
    const ts = f.createdAt.getTime();
    if (ts > lastActivityMs) lastActivityMs = ts;
  }

  const resolvedJobs = completedJobs + disputedJobs;
  const completionRate = resolvedJobs > 0 ? completedJobs / resolvedJobs : 0;
  const disputeRate = resolvedJobs > 0 ? disputedJobs / resolvedJobs : 0;

  // Latency stats
  let meanLatencyHours = 0;
  let latencyCv = 0;
  if (latenciesHours.length > 0) {
    meanLatencyHours = latenciesHours.reduce((a, b) => a + b, 0) / latenciesHours.length;
    if (meanLatencyHours > 0 && latenciesHours.length > 1) {
      const variance =
        latenciesHours.reduce((acc, v) => acc + (v - meanLatencyHours) ** 2, 0) /
        latenciesHours.length;
      const sd = Math.sqrt(variance);
      latencyCv = sd / meanLatencyHours;
    }
  }

  // Validator concentration uses the validators aggregate features.ts already produces.
  const validatorMap = new Map<string, number>();
  for (const v of features.validators) {
    validatorMap.set(v.validatorAddress, v.count);
  }

  return {
    completedJobs,
    disputedJobs,
    inFlightJobs,
    resolvedJobs,
    completionRate,
    disputeRate,
    totalSettledUsdc: totalSettled,
    medianSettledUsdc: median(settledAmounts),
    activeEscrowUsdc: activeEscrow,
    meanLatencyHours,
    latencyCv,
    uniqueClients: clientCounts.size,
    topClientShare: topShare(clientCounts),
    uniqueValidators: validatorMap.size,
    topValidatorShare: topShare(validatorMap),
    lastActivityAt: lastActivityMs > 0 ? new Date(lastActivityMs) : null,
  };
}
