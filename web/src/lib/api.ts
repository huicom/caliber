export interface StatsResponse {
  totals: { agents: number; jobs: number; completedJobs: number; usdcVolume: string };
  last24h: { newAgents: number; newJobs: number; usdcVolume: string };
  topAgents: {
    byReputation: Array<{ agentId: string; name: string | null; reputationScore: string | null; feedbackCount: number | null }>;
    byEarnings: Array<{ agentId: string; name: string | null; usdcEarned: string | null; jobsCompleted: number | null }>;
  };
  updatedAt: string;
}

export interface AgentRow {
  agentId: string;
  ownerAddress: string;
  name: string | null;
  agentType: string | null;
  capabilities: string[] | null;
  reputationScore: string | null;
  feedbackCount: number;
  validationStatus: string | null;
  jobsCompleted: number;
  usdcEarned: string;
  registeredAtBlock: string;
}

export interface AgentsListResponse {
  agents: AgentRow[];
  total: number;
  limit: number;
  offset: number;
}

export interface AgentDetailResponse {
  agent: AgentRow & {
    metadata: Record<string, unknown> | null;
    metadataUri: string | null;
    registeredTxHash: string;
    registeredAt: string | null;
    createdAt: string;
  };
  feedback: Array<Record<string, string | number | null>>;
  validations: Array<Record<string, string | number | null>>;
  recentJobs: Array<Record<string, string | number | null>>;
}

export interface JobsListResponse {
  jobs: Array<Record<string, string | number | null>>;
  total: number;
  limit: number;
  offset: number;
}

export interface JobDetailResponse {
  job: Record<string, string | number | null>;
  timeline: Array<Record<string, string | number | null>>;
  provider: { agentId: string; name: string | null; reputationScore: string | null } | null;
}

async function fetcher<T>(path: string): Promise<T> {
  const res = await fetch(path, { cache: 'no-store' });
  if (!res.ok) throw new Error(`API ${path} failed: ${res.status}`);
  return res.json();
}

// Rating service lives on a separate subdomain (Cloudflare Tunnel → port 3100).
// Override via NEXT_PUBLIC_RATING_API_BASE if running locally against a dev tunnel.
const RATING_API_BASE =
  process.env.NEXT_PUBLIC_RATING_API_BASE ?? 'https://caliber-api.poko.blue';

async function ratingFetcher<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${RATING_API_BASE}${path}`, {
    cache: 'no-store',
    ...init,
  });
  if (!res.ok) throw new Error(`Rating API ${path} failed: ${res.status}`);
  return res.json();
}

// Caliber Rating v2.0 tier scale. Order matches engine TIER_ORDINAL.
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

export interface BulkRatingSummary {
  agent_id: string;
  rated: boolean;
  tier?: CaliberTier;
  score?: number;
  confidence?: ConfidenceLabel;
  flags?: RatingFlag[];
  reason?: string;
  interactions?: number;
}

export interface BulkRatingsResponse {
  chain: string;
  count: number;
  ratings: BulkRatingSummary[];
}

export interface RatingDistribution {
  chain: string;
  computed_at: string;
  total_agents: number;
  rateable_agents: number;
  unrated: {
    insufficient_interactions: number;
    insufficient_history: number;
    other: number;
  };
  by_tier: Record<CaliberTier, number>;
  by_confidence: { high: number; moderate: number; low: number; insufficient: number };
  by_flag_count: { zero: number; one: number; two_or_more: number };
  mean_score: number;
}

export interface RatingHistoryPoint {
  date: string;
  tier: CaliberTier;
  completion_rate_smoothed: number | null;
  forward_success: number | null;
  active_escrow_usdc: string | null;
  confidence: ConfidenceLabel;
  view: 'PIT' | 'TTC';
  methodology_version: string;
  interaction_count: number | null;
}

export interface RatingHistoryResponse {
  chain: string;
  agent_id: string;
  days: number;
  view: 'PIT' | 'TTC' | 'all';
  count: number;
  history: RatingHistoryPoint[];
}

export interface DistributionHistoryPoint {
  date: string;
  [tier: string]: number | string;
}

export interface DistributionHistoryResponse {
  chain: string;
  view: 'PIT' | 'TTC';
  days: number;
  tiers: CaliberTier[];
  series: DistributionHistoryPoint[];
}

export interface ExposureSummaryByTier {
  tier: CaliberTier;
  agent_count: number;
  active_escrow_usdc: string;
}

export interface ExposureSummary {
  chain: string;
  methodology_version: string;
  computed_at: string | null;
  total_agents: number;
  total_active_escrow_usdc: string;
  by_tier: ExposureSummaryByTier[];
}

export const api = {
  stats: () => fetcher<StatsResponse>('/api/stats'),
  agents: (params: Record<string, string | number>) => {
    const qs = new URLSearchParams(
      Object.entries(params).map(([k, v]) => [k, String(v)]),
    ).toString();
    return fetcher<AgentsListResponse>(`/api/agents?${qs}`);
  },
  agent: (id: string) => fetcher<AgentDetailResponse>(`/api/agents/${id}`),
  agentFeedback: (id: string, params: Record<string, string | number> = {}) => {
    const qs = new URLSearchParams(
      Object.entries(params).map(([k, v]) => [k, String(v)]),
    ).toString();
    return fetcher(`/api/agents/${id}/feedback?${qs}`);
  },
  jobs: (params: Record<string, string | number> = {}) => {
    const qs = new URLSearchParams(
      Object.entries(params).map(([k, v]) => [k, String(v)]),
    ).toString();
    return fetcher<JobsListResponse>(`/api/jobs?${qs}`);
  },
  job: (id: string) => fetcher<JobDetailResponse>(`/api/jobs/${id}`),
  feed: () => fetcher<{ feed: Array<Record<string, unknown>> }>('/api/feed'),
  timeseries: () =>
    fetcher<Array<{ day: string; agents: number; jobs: number; usdc: string }>>(
      '/api/stats/timeseries',
    ),
  bulkRatings: (chain: string, ids: string[]) =>
    ratingFetcher<BulkRatingsResponse>(`/v1/ratings/bulk?chain=${chain}&ids=${ids.join(',')}`),
  ratingDistribution: (chain: string = 'arc') =>
    ratingFetcher<RatingDistribution>(`/v1/ratings/distribution?chain=${chain}`),
  ratingHistory: (chain: string, id: string, params: { days?: number; view?: 'PIT' | 'TTC' | 'all' } = {}) => {
    const qs = new URLSearchParams();
    if (params.days) qs.set('days', String(params.days));
    if (params.view) qs.set('view', params.view);
    return ratingFetcher<RatingHistoryResponse>(
      `/v1/agents/${chain}/${id}/rating/history${qs.toString() ? `?${qs}` : ''}`,
    );
  },
  distributionHistory: (params: { chain?: string; days?: number; view?: 'PIT' | 'TTC' } = {}) => {
    const qs = new URLSearchParams();
    qs.set('chain', params.chain ?? 'arc');
    if (params.days) qs.set('days', String(params.days));
    if (params.view) qs.set('view', params.view);
    return ratingFetcher<DistributionHistoryResponse>(
      `/v1/ratings/distribution/history?${qs}`,
    );
  },
  exposureSummary: (chain: string = 'arc') =>
    ratingFetcher<ExposureSummary>(`/v1/ratings/exposure-summary?chain=${chain}`),
};
