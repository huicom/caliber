// Caliber Rating v2.0 — Step 2.3 risk flags (methodology §"Risk flags").
//
// Rules, not models. Each fires under a specific, disclosed condition.
// When any flag fires the agent's tier is overridden:
//   - Dormancy           → Inactive
//   - All other flags    → Watch
// Both override regardless of the agent's underlying score.

import type { AgentFeatures, RatingFlag } from './types';
import type { CompletionFeatures } from './completion-rate';

// Configurable thresholds. Surfaced as named constants so methodology
// revisions are findable + reviewable.
export const FLAG_THRESHOLDS = {
  // Counterparty concentration: top client share > 60%, AND fewer than 5
  // unique clients (don't fire on agents whose top-client share is high but
  // who have a wide client base for the rest).
  COUNTERPARTY_TOP_SHARE: 0.6,
  COUNTERPARTY_MIN_CLIENTS: 5,

  // Validator concentration: same shape.
  VALIDATOR_TOP_SHARE: 0.6,
  VALIDATOR_MIN_VALIDATORS: 5,

  // Volume anomaly: recent activity is 10× the agent's lifetime average.
  // Requires ≥ 30 days of history to compute meaningfully — otherwise we
  // skip (insufficient baseline).
  VOLUME_ANOMALY_MULTIPLIER: 10,
  VOLUME_ANOMALY_MIN_HISTORY_DAYS: 30,

  // Dormancy: no on-chain activity in the lookback.
  DORMANCY_DAYS: 90,
} as const;

export interface FlagsResult {
  flags: RatingFlag[];
  details: Partial<Record<RatingFlag, string>>;
}

export function computeFlags(
  features: AgentFeatures,
  completion: CompletionFeatures,
): FlagsResult {
  const flags: RatingFlag[] = [];
  const details: Partial<Record<RatingFlag, string>> = {};
  const now = Date.now();

  // 1. Counterparty concentration
  if (
    completion.uniqueClients > 0 &&
    completion.uniqueClients < FLAG_THRESHOLDS.COUNTERPARTY_MIN_CLIENTS &&
    completion.topClientShare > FLAG_THRESHOLDS.COUNTERPARTY_TOP_SHARE
  ) {
    flags.push('CounterpartyConcentration');
    details.CounterpartyConcentration = `${Math.round(completion.topClientShare * 100)}% of jobs from one client (${completion.uniqueClients} unique clients)`;
  }

  // 2. Validator concentration
  if (
    completion.uniqueValidators > 0 &&
    completion.uniqueValidators < FLAG_THRESHOLDS.VALIDATOR_MIN_VALIDATORS &&
    completion.topValidatorShare > FLAG_THRESHOLDS.VALIDATOR_TOP_SHARE
  ) {
    flags.push('ValidatorConcentration');
    details.ValidatorConcentration = `${Math.round(completion.topValidatorShare * 100)}% of validations from one validator (${completion.uniqueValidators} unique validators)`;
  }

  // 3. Sybil pattern — v2.0 launch ships a conservative check only:
  //    the agent's ownerAddress appears as a clientAddress on one of its
  //    own jobs (self-dealing). Full graph cycle detection is v2.1.
  for (const j of features.jobs) {
    if (
      j.clientAddress &&
      j.clientAddress.toLowerCase() === features.ownerAddress.toLowerCase()
    ) {
      flags.push('SybilPattern');
      details.SybilPattern = 'agent appears as its own client on at least one job (self-deal)';
      break;
    }
  }

  // 4. Volume anomaly: recent 30-day rate vs lifetime rate.
  if (features.registeredAt) {
    const ageDays = (now - features.registeredAt.getTime()) / 86_400_000;
    if (ageDays >= FLAG_THRESHOLDS.VOLUME_ANOMALY_MIN_HISTORY_DAYS) {
      const recentCutoff = now - 30 * 86_400_000;
      const recentJobs = features.jobs.filter((j) => j.createdAt.getTime() >= recentCutoff).length;
      const lifetimeJobsPerDay = features.jobs.length / ageDays;
      const lifetimeJobsPer30d = lifetimeJobsPerDay * 30;
      if (
        lifetimeJobsPer30d > 0 &&
        recentJobs > lifetimeJobsPer30d * FLAG_THRESHOLDS.VOLUME_ANOMALY_MULTIPLIER
      ) {
        flags.push('VolumeAnomaly');
        details.VolumeAnomaly = `${recentJobs} jobs in last 30d vs ${lifetimeJobsPer30d.toFixed(1)}/30d lifetime rate (${FLAG_THRESHOLDS.VOLUME_ANOMALY_MULTIPLIER}× threshold)`;
      }
    }
  }

  // 5. Dormancy
  if (completion.lastActivityAt) {
    const daysSinceActivity = (now - completion.lastActivityAt.getTime()) / 86_400_000;
    if (daysSinceActivity >= FLAG_THRESHOLDS.DORMANCY_DAYS) {
      flags.push('Dormancy');
      details.Dormancy = `no on-chain activity in ${Math.floor(daysSinceActivity)} days`;
    }
  }

  return { flags, details };
}
