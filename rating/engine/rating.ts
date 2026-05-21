import { buildFeatures } from './features';
import { classifySegment } from './segment';
import { computePD, isInActiveDefault } from './pd';
import { computeLGD } from './lgd';
import { computeEAD } from './ead';
import { METHODOLOGY_VERSION } from './version';
import type {
  CaliberTier,
  ConfidenceTier,
  RatingView,
  RatingResponse,
  UnratedResponse,
  RatingResult,
  RatingFactors,
} from './types';

/** §3.1 — Tier PD band cutoffs (30-day PD). */
/* v1.0.1 tuning (2026-05-21) — tighter top tiers, wider mid-band to populate
 * CCC/CC which were empty under v1.0 (BB→CCC jump was 12% → 35%, too wide).
 * No methodological change; cutoff values only.
 *   AAA: 0.005 → 0.004    AA:  0.015 → 0.010    A:   0.03  → 0.025
 *   BBB: 0.06            BB:  0.12  → 0.13     B:   0.20  → 0.22
 *   CCC: 0.35            CC:  0.60  → 0.55                                 */
const TIER_CUTOFFS: Array<{ tier: CaliberTier; maxPd: number }> = [
  { tier: 'Caliber-AAA', maxPd: 0.004 },
  { tier: 'Caliber-AA', maxPd: 0.010 },
  { tier: 'Caliber-A', maxPd: 0.025 },
  { tier: 'Caliber-BBB', maxPd: 0.06 },
  { tier: 'Caliber-BB', maxPd: 0.13 },
  { tier: 'Caliber-B', maxPd: 0.22 },
  { tier: 'Caliber-CCC', maxPd: 0.35 },
  { tier: 'Caliber-CC', maxPd: 0.55 },
  { tier: 'Caliber-D', maxPd: Infinity },
];

/** §3.1 — Min on-chain history required (days). */
export const MIN_HISTORY_DAYS = 14;

/** §3.3 — Min history for TTC view (days). */
export const TTC_MIN_DAYS = 180;

/** §3.2 — Confidence tier thresholds.
 * v1.0.1 tuning (2026-05-21): medium 15→25, high 50→75. Low stays at 5
 * (changing it would alter §1.5 minimum-data rule, which is a formula change). */
export const CONFIDENCE_HIGH = 75;
export const CONFIDENCE_MEDIUM = 25;
export const CONFIDENCE_LOW = 5;

export function assignTier(pd: number): CaliberTier {
  for (const cutoff of TIER_CUTOFFS) {
    if (pd < cutoff.maxPd) return cutoff.tier;
  }
  return 'Caliber-D';
}

export function confidenceTier(interactionCount: number): ConfidenceTier | null {
  if (interactionCount >= CONFIDENCE_HIGH) return 'high';
  if (interactionCount >= CONFIDENCE_MEDIUM) return 'medium';
  if (interactionCount >= CONFIDENCE_LOW) return 'low';
  return null;
}

/**
 * Rate an agent. Main entrypoint.
 *
 * @param agentId - The ERC-8004 agent ID (bigint)
 * @param chainId - The chain identifier ('arc' | 'base')
 * @param view - 'PIT' (30d) or 'TTC' (full history, >=180d required)
 */
export async function rateAgent(
  agentId: bigint,
  chainId: string,
  view: RatingView = 'PIT',
): Promise<RatingResult> {
  const lookbackDays = view === 'TTC' ? 0 : 30; // 0 = use full history

  const features = await buildFeatures(agentId, chainId, lookbackDays);
  if (!features) {
    return {
      agent_id: agentId.toString(),
      chain_id: chainId,
      rated: false,
      reason: 'insufficient_interactions',
      interactions: 0,
      methodology_version: METHODOLOGY_VERSION,
    };
  }

  // Phantom-agent guard: the indexer inserts placeholder rows in the `agents`
  // table when a feedback/validation event references an unregistered agent
  // (FK-safety pattern, see CLAUDE.md). Those rows have ownerAddress='' and
  // the agent doesn't exist on-chain — IdentityRegistry.ownerOf reverts with
  // ERC721NonexistentToken. We can compute aggregate stats for them but we
  // can't attest a rating because the on-chain verifier requires a real
  // provider address. Refuse to rate.
  if (!features.ownerAddress || features.ownerAddress === '') {
    return {
      agent_id: agentId.toString(),
      chain_id: chainId,
      rated: false,
      reason: 'unknown_identity',
      interactions:
        features.feedbackEvents.length +
        features.validations.length +
        features.jobs.length,
      methodology_version: METHODOLOGY_VERSION,
    };
  }

  const interactionCount =
    features.feedbackEvents.length +
    features.validations.length +
    features.jobs.length;

  // §3.2 — Minimum 14d on-chain history
  const earliestDate = features.registeredAt;
  if (earliestDate) {
    const daysSinceRegister = (Date.now() - earliestDate.getTime()) / 86400_000;
    if (daysSinceRegister < MIN_HISTORY_DAYS) {
      return {
        agent_id: agentId.toString(),
        chain_id: chainId,
        rated: false,
        reason: 'insufficient_history',
        interactions: interactionCount,
        methodology_version: METHODOLOGY_VERSION,
      };
    }
  }

  // §3.2 — Minimum 5 interactions
  if (interactionCount < CONFIDENCE_LOW) {
    return {
      agent_id: agentId.toString(),
      chain_id: chainId,
      rated: false,
      reason: 'insufficient_interactions',
      interactions: interactionCount,
      methodology_version: METHODOLOGY_VERSION,
    };
  }

  // §3.3 — TTC requires >= 180d
  if (view === 'TTC') {
    if (earliestDate) {
      const daysSinceRegister = (Date.now() - earliestDate.getTime()) / 86400_000;
      if (daysSinceRegister < TTC_MIN_DAYS) {
        return {
          agent_id: agentId.toString(),
          chain_id: chainId,
          rated: false,
          reason: 'insufficient_history',
          interactions: interactionCount,
          methodology_version: METHODOLOGY_VERSION,
        };
      }
    } else {
      return {
        agent_id: agentId.toString(),
        chain_id: chainId,
        rated: false,
        reason: 'insufficient_history',
        interactions: interactionCount,
        methodology_version: METHODOLOGY_VERSION,
      };
    }
  }

  // Segment the agent
  const validatorValidationCount = features.validations.filter(
    (v) => v.validatorAddress.toLowerCase() === features.ownerAddress.toLowerCase(),
  ).length;
  const segment = classifySegment(
    features.agentType,
    features.capabilities,
    validatorValidationCount,
  );

  // PD computation
  const { pd, factors: pdFactors } = computePD(features, lookbackDays);

  // LGD computation (segmented)
  const { lgd, lgdDownturn, assumptions } = computeLGD(features, segment);

  // EAD computation
  const ead = computeEAD(features);

  // EL = PD × LGD × EAD
  const el = pd * lgd * ead;

  // Active default override (§3.1 Caliber-D)
  const activeDefault = isInActiveDefault(features, lookbackDays);
  const tier = activeDefault ? 'Caliber-D' : assignTier(pd);

  // Confidence
  const confidence = confidenceTier(interactionCount)!;

  // Format EAD/EL as fixed-point strings
  const eadStr = ead.toFixed(6);
  const elStr = el.toFixed(6);

  const factors: RatingFactors = {
    segment,
    base_ppd: pdFactors.base_ppd,
    agent_age_days: pdFactors.agent_age_days,
    validator_diversity_index: pdFactors.validator_diversity_index,
    job_size_cv: pdFactors.job_size_cv,
    recent_feedback_slope: pdFactors.recent_feedback_slope,
    sybil_flag: pdFactors.sybil_flag,
    cross_chain_count: pdFactors.cross_chain_count,
    validator_quality_avg: pdFactors.validator_quality_avg,
    logit: pdFactors.logit,
    ppd_ci: null,
    total_terminal_jobs: pdFactors.total_terminal_jobs,
    defaulted_jobs: pdFactors.defaulted_jobs,
    interaction_count: interactionCount,
    active_default: activeDefault,
    lgd_assumptions: assumptions,
    lookback_days: lookbackDays === 0 ? null : lookbackDays,
  };

  return {
    agent_id: agentId.toString(),
    chain_id: chainId,
    rated: true,
    rating: tier,
    ppd_30d: roundPd(pd),
    lgd: round(lgd, 4),
    lgd_downturn: round(lgdDownturn, 4),
    ead_usdc: eadStr,
    el_usdc: elStr,
    confidence,
    view,
    methodology_version: METHODOLOGY_VERSION,
    computed_at: new Date().toISOString(),
    factors,
  };
}

function round(v: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
}

function roundPd(pd: number): number {
  return round(pd, 4);
}
