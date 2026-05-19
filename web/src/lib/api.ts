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
};
