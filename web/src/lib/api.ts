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

export interface BulkRatingSummary {
  agent_id: string;
  rated: boolean;
  rating?: CaliberTier;
  ppd_30d?: number;
  confidence?: 'high' | 'medium' | 'low';
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
  by_confidence: { high: number; medium: number; low: number };
  mean_ppd_30d: number;
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
};
