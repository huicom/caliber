import type { AgentFeatures } from './types';

/**
 * §4.4 — Fixed logistic regression coefficients (v1, pre-calibrated defaults).
 *
 * All multiplicand factors are normalized to similar magnitudes (typically [0,1])
 * so no single factor dominates the logit. See helper functions below for the
 * exact transform applied to each input.
 */
/* v1.0.1 tuning (2026-05-21) — coefficient recalibration against the first
 * 883 rateable agents in production data. Same formula, tighter parameters:
 * intercept shifted from -3.5 → -2.7 to re-center the distribution around
 * BBB (was clustering at A), age bonus softened, slope dampened, sybil
 * penalty doubled. No methodological change; model_type stays scorecard_v1. */
export const PD_COEFFICIENTS = {
  intercept: -3.0,           // was -3.5: re-centers neutral agent on BBB. First pass at -2.7 overshot (73% landed in BB); -3.0 is the corrected value.
  basePdLog: 4.0,
  agentAge: -0.3,            // was -0.4: slightly less age discount
  validatorConcentration: 0.6,
  jobSizeCv: 0.5,
  recentFeedbackSlope: -0.15, // was -0.2: dampen slope-driven AAAs on thin data
  sybilFlag: 1.0,            // was 0.6: sybil concentration hits harder
  crossChain: -0.2,
  validatorQuality: -0.3,
} as const;

/** §4.1(c) — Tags considered outcome-tagged for feedback default threshold. */
const OUTCOME_TAGS = new Set(['outcome', 'result', 'delivery', 'final']);

/** §4.1(c) — Score threshold below which feedback signals default. */
const FEEDBACK_DEFAULT_THRESHOLD = 30;

export function computePD(
  features: AgentFeatures,
  lookbackDays: number,
): { pd: number; factors: PdFactors } {
  const jobs = features.jobs;
  const terminalJobs = jobs.filter(
    (j) =>
      j.status === 'Completed' ||
      j.status === 'Rejected' ||
      j.status === 'Expired',
  );

  // §4.1 Performance default detection
  let defaultedJobs = 0;
  for (const j of terminalJobs) {
    if (isJobInDefault(j, features)) defaultedJobs++;
  }

  const totalCompletedJobs = terminalJobs.length;
  const basePd = totalCompletedJobs > 0 ? defaultedJobs / totalCompletedJobs : 0;

  // Factor: agent age in days
  const agentAgeDays = computeAgentAgeDays(features);

  // Factor: validator diversity (1 - normalized HHI; 0=concentrated, 1=diverse)
  const validatorDiversityIndex = computeValidatorDiversity(features.validators);

  // Factor: job size coefficient of variation
  const jobSizeCv = computeJobSizeCv(features.jobs);

  // Factor: recent feedback slope (last 30d)
  const recentFeedbackSlope = computeFeedbackSlope(features.feedbackEvents, 30);

  // Factor: sybil flag (try/catch external, default 0 per §8.3)
  const sybilFlag = 0 as const;

  // Factor: cross-chain count
  const crossChainCount = Math.max(1, features.crossChainChains.length);

  // Factor: validator quality average
  const validatorQualityAvg = computeValidatorQualityAvg(features);

  // §4.4 — Logistic regression. All factors normalized so no single one dominates.
  const logit =
    PD_COEFFICIENTS.intercept +
    PD_COEFFICIENTS.basePdLog * Math.log1p(basePd) +
    PD_COEFFICIENTS.agentAge * Math.log1p(agentAgeDays / 30) +
    // §4.3 concentrated validators = higher PD — use (1 - diversity) so concentrated agents pay a penalty
    PD_COEFFICIENTS.validatorConcentration * (1 - validatorDiversityIndex) +
    PD_COEFFICIENTS.jobSizeCv * jobSizeCv +
    PD_COEFFICIENTS.recentFeedbackSlope * recentFeedbackSlope +
    PD_COEFFICIENTS.sybilFlag * sybilFlag +
    PD_COEFFICIENTS.crossChain * crossChainCount +
    PD_COEFFICIENTS.validatorQuality * validatorQualityAvg;

  const pd = clamp(1 / (1 + Math.exp(-logit)), 0.0001, 0.9999);

  return {
    pd,
    factors: {
      base_ppd: basePd,
      agent_age_days: agentAgeDays,
      validator_diversity_index: validatorDiversityIndex,
      job_size_cv: jobSizeCv,
      recent_feedback_slope: recentFeedbackSlope,
      sybil_flag: sybilFlag,
      cross_chain_count: crossChainCount,
      validator_quality_avg: validatorQualityAvg,
      logit,
      total_terminal_jobs: totalCompletedJobs,
      defaulted_jobs: defaultedJobs,
    },
  };
}

export interface PdFactors {
  base_ppd: number;
  agent_age_days: number;
  validator_diversity_index: number;
  job_size_cv: number;
  recent_feedback_slope: number;
  sybil_flag: 0 | 1;
  cross_chain_count: number;
  validator_quality_avg: number;
  logit: number;
  total_terminal_jobs: number;
  defaulted_jobs: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function computeAgentAgeDays(features: AgentFeatures): number {
  // features.ts now derives registeredAt from the earliest event timestamp when
  // the DB column is NULL (the indexer doesn't populate registered_at — only
  // registered_at_block). If derivation also fails (no events at all), the
  // agent shouldn't have passed the ≥5-interactions gate, so this fallback
  // is a defensive safety net rather than a normal code path.
  const registered = features.registeredAt;
  if (!registered) return 14;
  return Math.max(0, (Date.now() - registered.getTime()) / 86400_000);
}

function computeValidatorDiversity(
  validators: Array<{ validatorAddress: string; count: number }>,
): number {
  const total = validators.reduce((s, v) => s + v.count, 0);
  if (total === 0) return 0;
  const hhi = validators.reduce((s, v) => s + (v.count / total) ** 2, 0);
  return clamp(1 - hhi, 0, 1);
}

function computeJobSizeCv(
  jobs: Array<{ budgetUsdc: string | null }>,
): number {
  const amounts = jobs
    .map((j) => (j.budgetUsdc ? Number(j.budgetUsdc) : 0))
    .filter((a) => a > 0);
  if (amounts.length < 2) return 0;
  const mean = amounts.reduce((s, a) => s + a, 0) / amounts.length;
  if (mean === 0) return 0;
  const variance =
    amounts.reduce((s, a) => s + (a - mean) ** 2, 0) / amounts.length;
  return Math.sqrt(variance) / mean;
}

function computeFeedbackSlope(
  feedback: Array<{ score: number; createdAt: Date }>,
  windowDays: number,
): number {
  const windowMs = windowDays * 86400_000;
  const now = Date.now();
  const recent = feedback.filter((f) => now - f.createdAt.getTime() <= windowMs);
  if (recent.length < 2) return 0;
  const n = recent.length;
  const sumX = recent.reduce((s, _, i) => s + i, 0);
  const sumY = recent.reduce((s, f) => s + f.score, 0);
  const sumXY = recent.reduce((s, f, i) => s + i * f.score, 0);
  const sumX2 = recent.reduce((s, _, i) => s + i * i, 0);
  const denominator = n * sumX2 - sumX * sumX;
  if (denominator === 0) return 0;
  return (n * sumXY - sumX * sumY) / denominator;
}

function computeValidatorQualityAvg(features: AgentFeatures): number {
  // Returns a [0,1] normalized quality score so it composes with the
  // logit coefficient without dominating.
  // TODO (§4.3): join feedback/validations validator_addresses against
  // agents.owner_address to get validators' own reputation scores.
  // For v1, use the mean feedback score (0-100 scale) divided by 100 as a proxy.
  const scores = features.feedbackEvents.map((f) => f.score);
  if (scores.length === 0) return 0.5;
  const mean = scores.reduce((s, v) => s + v, 0) / scores.length;
  return Math.max(0, Math.min(1, mean / 100));
}

/** §4.1 — Check if a job counts as a performance default. */
function isJobInDefault(
  job: {
    status: string;
    budgetUsdc: string | null;
    completionReason: string | null;
  },
  features: AgentFeatures,
): boolean {
  // (a) Bad terminal statuses
  // TODO: methodology mentions Cancelled/Refunded/Disputed; schema only has
  // Open/Funded/Submitted/Completed/Rejected/Expired. Using what is available.
  if (job.status === 'Rejected' || job.status === 'Expired') return true;

  // (b) Validation failure — any FAILED validation during the window
  if (features.validations.some((v) => v.status === 'FAILED')) return true;

  // (c) Low outcome-tagged feedback (score < 30 on 0-100 scale)
  const hasLowOutcomeFeedback = features.feedbackEvents.some(
    (f) =>
      f.score < FEEDBACK_DEFAULT_THRESHOLD &&
      OUTCOME_TAGS.has(f.tag?.toLowerCase() ?? ''),
  );
  if (hasLowOutcomeFeedback) return true;

  return false;
}

/** §4.1(d) — Check if agent is currently in default due to wallet inactivity. */
export function isInactiveDefault(features: AgentFeatures): boolean {
  const allTimestamps: number[] = [];
  for (const f of features.feedbackEvents) {
    allTimestamps.push(new Date(f.createdAt).getTime());
  }
  for (const j of features.jobs) {
    if (j.updatedAt) allTimestamps.push(new Date(j.updatedAt).getTime());
  }
  if (features.registeredAt) allTimestamps.push(features.registeredAt.getTime());

  const lastEvent = allTimestamps.length > 0 ? Math.max(...allTimestamps) : 0;
  const daysSinceLastEvent = lastEvent > 0 ? (Date.now() - lastEvent) / 86400_000 : Infinity;

  if (daysSinceLastEvent < 90) return false;

  const hasInFlightJobs = features.jobs.some(
    (j) => j.status === 'Open' || j.status === 'Funded' || j.status === 'Submitted',
  );
  return hasInFlightJobs;
}

/** Check whether the agent is currently in active default. */
export function isInActiveDefault(features: AgentFeatures, lookbackDays: number): boolean {
  // Check job-based defaults
  const terminalJobs = features.jobs.filter(
    (j) =>
      j.status === 'Completed' ||
      j.status === 'Rejected' ||
      j.status === 'Expired',
  );
  const hasJobDefault = terminalJobs.some((j) => isJobInDefault(j, features));
  if (hasJobDefault) return true;

  // Check inactive default (wallet inactive >= 90d with in-flight jobs)
  if (isInactiveDefault(features)) return true;

  return false;
}
