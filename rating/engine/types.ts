// Caliber Rating v2.0 — type surface.
//
// Major change from v1.x: the rating no longer has a probability-of-default
// shape (PD/LGD/EAD/EL). The new shape is (tier, score 0-100, confidence,
// flags). The methodology paper is in docs/02-riskmodel/01-Methodology.md;
// the v2.0 provenance is in §Methodology Provenance / Appendix F.

export type CaliberTier =
  | 'Established'
  | 'Proven'
  | 'Emerging'
  | 'Provisional'
  | 'Watch'
  | 'Inactive';

export const TIER_ORDER: CaliberTier[] = [
  'Established',
  'Proven',
  'Emerging',
  'Provisional',
  'Watch',
  'Inactive',
];

export const TIER_ORDINAL: Record<CaliberTier, number> = {
  Established: 0,
  Proven: 1,
  Emerging: 2,
  Provisional: 3,
  Watch: 4,
  Inactive: 5,
};

export type ConfidenceLabel = 'high' | 'moderate' | 'low' | 'insufficient';

export type RatingFlag =
  | 'CounterpartyConcentration'
  | 'ValidatorConcentration'
  | 'SybilPattern'
  | 'VolumeAnomaly'
  | 'Dormancy';

export const FLAG_BIT: Record<RatingFlag, number> = {
  CounterpartyConcentration: 0b00001,
  ValidatorConcentration: 0b00010,
  SybilPattern: 0b00100,
  VolumeAnomaly: 0b01000,
  Dormancy: 0b10000,
};

export function flagsToBitfield(flags: RatingFlag[]): number {
  return flags.reduce((acc, f) => acc | FLAG_BIT[f], 0);
}

export type RatingView = 'PIT' | 'TTC';

export interface RatingFactors {
  completion_rate_raw: number;       // raw individual completion %
  completion_rate_smoothed: number;  // credibility-weighted
  forward_success: number;           // forward-looking probability
  network_endorsement: number;       // 0-100
  latency_consistency: number;       // 0-100
  completed_jobs: number;
  disputed_jobs: number;
  in_flight_jobs: number;
  unique_clients: number;
  unique_validators: number;
  top_client_share: number;          // [0,1]
  top_validator_share: number;       // [0,1]
  total_settled_usdc: string;
  median_settled_usdc: string;
  active_escrow_usdc: string;
  age_days: number;
  flag_details: Partial<Record<RatingFlag, string>>;
}

export interface RatingResponse {
  agent_id: string;
  chain_id: string;
  rated: true;
  tier: CaliberTier;
  score: number;                     // integer 0-100
  confidence: ConfidenceLabel;
  confidence_label: string;          // human-readable
  flags: RatingFlag[];
  interaction_count: number;
  methodology_version: string;
  computed_at: string;
  view: RatingView;
  factors: RatingFactors;
}

export interface UnratedResponse {
  agent_id: string;
  chain_id: string;
  rated: false;
  reason: 'insufficient_interactions' | 'insufficient_history' | 'unknown_identity';
  interactions: number;
  methodology_version: string;
}

export type RatingResult = RatingResponse | UnratedResponse;

// AgentFeatures is the raw materials buildFeatures() returns. The new engine
// uses the same query layer as v1 — only the downstream math changed.
// Adds clientAddresses (extracted from jobs) and jobs[].clientAddress so
// counterparty-concentration flagging has the data it needs.
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
    clientAddress: string;
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
