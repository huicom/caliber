// Caliber Rating v2.0 — orchestrator (methodology §"Step 3: The actual rating").
//
// Composition:
//   score (0-100) = 0.50 × smoothed_reliability + 0.25 × forward_success
//                 + 0.15 × network_endorsement + 0.10 × latency_consistency
//
// Tier assignment:
//   - Dormancy flag → Inactive
//   - Any other flag → Watch
//   - Score & completed-jobs gates → Established / Proven / Emerging / Provisional
//
// Min-data gate (methodology §"How sure we are"):
//   - < 5 interactions → unrated (insufficient_interactions)
//   - < 14 days on-chain → unrated (insufficient_history)
//   - no agent record → unrated (unknown_identity)

import { buildFeatures } from './features';
import { METHODOLOGY_VERSION } from './version';
import { computeCompletionFeatures } from './completion-rate';
import { credibilityBlend } from './credibility';
import { forwardSuccessProbability } from './survival';
import { computeFlags } from './flags';
import type {
  CaliberTier,
  ConfidenceLabel,
  RatingFlag,
  RatingResult,
  RatingView,
  RatingFactors,
  AgentFeatures,
} from './types';
import type { CompletionFeatures } from './completion-rate';

// =====================================================================
// Tunable constants (anything documented in methodology lives here).
// Methodology Appendix F records changes; tighten with care.
// =====================================================================

/** Population mean completion rate. Used as the credibility anchor for
 *  agents with sparse data. Update via the snapshot cron if it drifts;
 *  hardcoded for v2.0 launch from the 2026-05-22 dataset. */
export const POPULATION_COMPLETION_RATE = 0.95;

/** Minimum on-chain age (days) to issue a public rating. Per §1.5. */
export const MIN_HISTORY_DAYS = 14;

/** Confidence cutoffs (number of completed jobs). */
export const HIGH_CONFIDENCE_JOBS = 50;
export const MODERATE_CONFIDENCE_JOBS = 20;
export const LOW_CONFIDENCE_JOBS = 5;

/** Score-component weights (must sum to 1.0). Methodology §Step 3. */
export const SCORE_WEIGHTS = {
  reliability: 0.50,
  forward: 0.25,
  network: 0.15,
  latency: 0.10,
} as const;

/** Tier score thresholds. Score ≥ floor AND completed jobs ≥ minJobs. */
export const TIER_GATES = {
  Established: { floor: 80, minJobs: 50 },
  Proven: { floor: 65, minJobs: 20 },
  Emerging: { floor: 50, minJobs: 5 },
  Provisional: { floor: 0, minJobs: 0 },
} as const;

// =====================================================================
// Sub-scores (each returns [0, 100] for clean composition).
// =====================================================================

function networkEndorsement(features: AgentFeatures, completion: CompletionFeatures): number {
  // 0-100 score combining validator diversity, feedback volume, and
  // cross-chain presence. Capped at 100; floors at 0.
  let score = 0;

  // Validator diversity — up to 50 points. 5 unique validators caps out.
  score += Math.min(50, completion.uniqueValidators * 10);

  // Feedback volume — up to 30 points. 30+ positive feedback events caps out.
  const positiveFeedback = features.feedbackEvents.filter((f) => f.score >= 50).length;
  score += Math.min(30, positiveFeedback);

  // Cross-chain presence — up to 20 points. Per additional chain.
  const otherChains = Math.max(0, features.crossChainChains.length - 1);
  score += Math.min(20, otherChains * 10);

  return Math.min(100, score);
}

function latencyConsistency(completion: CompletionFeatures): number {
  // 0-100 score where higher = more consistent.
  // CV (coefficient of variation) = stddev / mean. Low CV = predictable.
  //   CV 0      → 100 (perfectly consistent)
  //   CV 1      → 50  (sd equals mean — moderate noise)
  //   CV ≥ 2    → 0   (highly erratic)
  // If no latency data (no completed jobs), return 50 — neutral.
  if (completion.meanLatencyHours === 0 || completion.latencyCv === 0) {
    return completion.completedJobs > 0 ? 75 : 50;
  }
  const score = 100 * Math.max(0, 1 - completion.latencyCv / 2);
  return Math.round(score);
}

function getConfidence(completedJobs: number): ConfidenceLabel {
  if (completedJobs >= HIGH_CONFIDENCE_JOBS) return 'high';
  if (completedJobs >= MODERATE_CONFIDENCE_JOBS) return 'moderate';
  if (completedJobs >= LOW_CONFIDENCE_JOBS) return 'low';
  return 'insufficient';
}

function buildConfidenceLabel(
  c: ConfidenceLabel,
  completion: CompletionFeatures,
  ageDays: number,
): string {
  const months = Math.floor(ageDays / 30);
  const monthsStr =
    months >= 1
      ? `over ${months} month${months === 1 ? '' : 's'}`
      : `over ${Math.max(0, Math.floor(ageDays))} day${Math.floor(ageDays) === 1 ? '' : 's'}`;
  const n = completion.completedJobs;
  switch (c) {
    case 'high':
      return `High confidence — based on ${n} completed jobs ${monthsStr}`;
    case 'moderate':
      return `Moderate confidence — based on ${n} completed jobs ${monthsStr}`;
    case 'low':
      return `Low confidence — only ${n} completed jobs observed; score anchored to population average`;
    case 'insufficient':
      return `Insufficient data — ${n} completed jobs observed`;
  }
}

export function assignTier(
  score: number,
  completedJobs: number,
  flags: RatingFlag[],
): CaliberTier {
  // Watch flags override score. Dormancy is its own thing — Inactive tier.
  if (flags.includes('Dormancy')) return 'Inactive';
  if (flags.length > 0) return 'Watch';

  if (score >= TIER_GATES.Established.floor && completedJobs >= TIER_GATES.Established.minJobs) {
    return 'Established';
  }
  if (score >= TIER_GATES.Proven.floor && completedJobs >= TIER_GATES.Proven.minJobs) {
    return 'Proven';
  }
  if (score >= TIER_GATES.Emerging.floor && completedJobs >= TIER_GATES.Emerging.minJobs) {
    return 'Emerging';
  }
  return 'Provisional';
}

// =====================================================================
// Main entrypoint.
// =====================================================================

export async function rateAgent(
  agentId: bigint,
  chainId: string,
  view: RatingView = 'PIT',
): Promise<RatingResult> {
  // v2.0 launch supports PIT only — the testnet is too young for TTC.
  if (view !== 'PIT') {
    return {
      agent_id: agentId.toString(),
      chain_id: chainId,
      rated: false,
      reason: 'insufficient_history',
      interactions: 0,
      methodology_version: METHODOLOGY_VERSION,
    };
  }

  const lookbackDays = 30;
  const features = await buildFeatures(agentId, chainId, lookbackDays);
  if (!features) {
    return {
      agent_id: agentId.toString(),
      chain_id: chainId,
      rated: false,
      reason: 'unknown_identity',
      interactions: 0,
      methodology_version: METHODOLOGY_VERSION,
    };
  }

  // Defensive: agents inserted as FK placeholders (per CLAUDE.md indexer
  // notes) have empty ownerAddress. They can't be rated.
  if (!features.ownerAddress || features.ownerAddress === '') {
    return {
      agent_id: agentId.toString(),
      chain_id: chainId,
      rated: false,
      reason: 'unknown_identity',
      interactions:
        features.feedbackCount + features.jobs.length + features.validations.length,
      methodology_version: METHODOLOGY_VERSION,
    };
  }

  // Age gate
  if (!features.registeredAt) {
    return {
      agent_id: agentId.toString(),
      chain_id: chainId,
      rated: false,
      reason: 'insufficient_history',
      interactions:
        features.feedbackCount + features.jobs.length + features.validations.length,
      methodology_version: METHODOLOGY_VERSION,
    };
  }
  const ageDays = (Date.now() - features.registeredAt.getTime()) / 86_400_000;
  if (ageDays < MIN_HISTORY_DAYS) {
    return {
      agent_id: agentId.toString(),
      chain_id: chainId,
      rated: false,
      reason: 'insufficient_history',
      interactions:
        features.feedbackCount + features.jobs.length + features.validations.length,
      methodology_version: METHODOLOGY_VERSION,
    };
  }

  // Interaction-count gate
  const interactionCount =
    features.feedbackCount + features.jobs.length + features.validations.length;
  if (interactionCount < 5) {
    return {
      agent_id: agentId.toString(),
      chain_id: chainId,
      rated: false,
      reason: 'insufficient_interactions',
      interactions: interactionCount,
      methodology_version: METHODOLOGY_VERSION,
    };
  }

  // Step 1: features
  const completion = computeCompletionFeatures(features);

  // Step 2.1: smoothed reliability (0-1)
  const smoothedReliability = credibilityBlend(
    completion.completionRate,
    POPULATION_COMPLETION_RATE,
    completion.resolvedJobs,
  );

  // Step 2.2: forward-looking success (0-1)
  const forwardSuccess = forwardSuccessProbability(features, POPULATION_COMPLETION_RATE);

  // Sub-scores 0-100
  const network = networkEndorsement(features, completion);
  const latency = latencyConsistency(completion);

  // Composite score
  const score = Math.round(
    SCORE_WEIGHTS.reliability * smoothedReliability * 100 +
      SCORE_WEIGHTS.forward * forwardSuccess * 100 +
      SCORE_WEIGHTS.network * network +
      SCORE_WEIGHTS.latency * latency,
  );

  // Step 2.3: flags
  const { flags, details: flagDetails } = computeFlags(features, completion);

  // Tier assignment
  const tier = assignTier(score, completion.completedJobs, flags);

  // Confidence label
  const confidence = getConfidence(completion.completedJobs);
  const confidenceLabel = buildConfidenceLabel(confidence, completion, ageDays);

  const factors: RatingFactors = {
    completion_rate_raw: round6(completion.completionRate),
    completion_rate_smoothed: round6(smoothedReliability),
    forward_success: round6(forwardSuccess),
    network_endorsement: network,
    latency_consistency: latency,
    completed_jobs: completion.completedJobs,
    disputed_jobs: completion.disputedJobs,
    in_flight_jobs: completion.inFlightJobs,
    unique_clients: completion.uniqueClients,
    unique_validators: completion.uniqueValidators,
    top_client_share: round6(completion.topClientShare),
    top_validator_share: round6(completion.topValidatorShare),
    total_settled_usdc: completion.totalSettledUsdc.toFixed(6),
    median_settled_usdc: completion.medianSettledUsdc.toFixed(6),
    active_escrow_usdc: completion.activeEscrowUsdc.toFixed(6),
    age_days: Math.floor(ageDays),
    flag_details: flagDetails,
  };

  return {
    agent_id: agentId.toString(),
    chain_id: chainId,
    rated: true,
    tier,
    score,
    confidence,
    confidence_label: confidenceLabel,
    flags,
    interaction_count: interactionCount,
    methodology_version: METHODOLOGY_VERSION,
    computed_at: new Date().toISOString(),
    view,
    factors,
  };
}

function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}
