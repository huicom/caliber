export type AgentSegment = 'payment-relay' | 'trading' | 'service' | 'validator';

export type ConfidenceTier = 'high' | 'medium' | 'low';

export type RatingView = 'PIT' | 'TTC';

export type CaliberTier =
  | 'Caliber-AAA'
  | 'Caliber-AA'
  | 'Caliber-A'
  | 'Caliber-BBB'
  | 'Caliber-BB'
  | 'Caliber-B'
  | 'Caliber-CCC'
  | 'Caliber-CC'
  | 'Caliber-D';

export interface RatingResponse {
  agent_id: string;
  chain_id: string;
  rated: true;
  rating: CaliberTier;
  ppd_30d: number;
  lgd: number;
  lgd_downturn: number;
  ead_usdc: string;
  el_usdc: string;
  confidence: ConfidenceTier;
  view: RatingView;
  methodology_version: string;
  computed_at: string;
  factors: RatingFactors;
}

export interface RatingFactors {
  segment: AgentSegment;
  base_ppd: number;
  agent_age_days: number;
  validator_diversity_index: number;
  job_size_cv: number;
  recent_feedback_slope: number;
  sybil_flag: 0 | 1;
  cross_chain_count: number;
  validator_quality_avg: number;
  logit: number;
  ppd_ci: null;
  total_terminal_jobs: number;
  defaulted_jobs: number;
  interaction_count: number;
  active_default: boolean;
  lgd_assumptions: string;
  lookback_days: number | null;
}

export interface UnratedResponse {
  agent_id: string;
  chain_id: string;
  rated: false;
  // unknown_identity = we have feedback/validation data for this agent ID but
  // the agent was never observed in an AgentRegistered event (placeholder row
  // inserted for FK safety per CLAUDE.md indexer notes). Without an on-chain
  // owner we can't issue an attestation, so we refuse to rate.
  reason: 'insufficient_interactions' | 'insufficient_history' | 'unknown_identity';
  interactions: number;
  methodology_version: string;
}

export type RatingResult = RatingResponse | UnratedResponse;

export interface AgentFeatures {
  agentId: bigint;
  chainId: string;
  ownerAddress: string;
  name: string | null;
  agentType: string | null;
  capabilities: string[] | null;
  metadata: Record<string, unknown> | null;
  registeredAt: Date | null;
  feedbackCount: number;

  feedbackEvents: Array<{
    score: number;
    tag: string;
    blockNumber: bigint;
    createdAt: Date;
  }>;

  jobs: Array<{
    jobId: bigint;
    status: string;
    budgetUsdc: string | null;
    completionReason: string | null;
    createdAtBlock: bigint;
    completedAtBlock: bigint | null;
    createdAt: Date;
    updatedAt: Date;
  }>;

  validations: Array<{
    status: string;
    validatorAddress: string;
    responseCode: number | null;
  }>;

  validators: Array<{
    validatorAddress: string;
    count: number;
  }>;

  crossChainChains: string[];
}
