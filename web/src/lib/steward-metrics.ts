import { sql } from '@/lib/db';

// Shared Steward traction queries — the single source of truth for both the
// public counters on /steward and the JSON at /api/steward/metrics, so the
// numbers can never drift apart.
//
// Honest-traction split: steward_payments.source is the attribution key.
// 'hirebot' is OUR OWN dogfood agent (demo traffic). Anything else is an
// external integration calling the Steward API. We never conflate the two.
// (Source-keyed attribution is the v0 mechanism; it moves to per-integration
// API keys as integrators onboard — see honest_note below.)

export const DOGFOOD_SOURCE = 'hirebot';

export const HONEST_NOTE =
  "Traffic is split by `steward_payments.source`. 'hirebot' is our own dogfood " +
  'agent — its payments are demo traffic and are never counted as external ' +
  'adoption. Every other source is an integration calling the Steward API. ' +
  'This source label is the v0 attribution mechanism; it moves to ' +
  'per-integration API keys as integrators onboard, so demo and external use ' +
  'stay separable on the record.';

export interface StewardMetrics {
  generated_at: string;
  payments: {
    authorized: number;
    denied: number;
    held: number;
    total_usdc_settled: number;
    last24h: { authorized: number; denied: number };
  };
  incidents: {
    caught: number;
    open: number;
    by_kind: Record<string, number>;
  };
  approvals: { pending: number };
  by_source: Record<
    string,
    { authorized: number; denied: number; held: number; settled_usdc: number }
  >;
  honest_note: string;
  frozen: boolean;
}

function round(n: number | null | undefined, dp = 6): number {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v)) return 0;
  const f = 10 ** dp;
  return Math.round(v * f) / f;
}

export async function getStewardMetrics(): Promise<StewardMetrics> {
  const [pay] = await sql<
    {
      authorized: number;
      denied: number;
      held: number;
      total_usdc_settled: number;
      auth_24h: number;
      denied_24h: number;
    }[]
  >`
    SELECT
      count(*) FILTER (WHERE decision = 'allow')::int                                          AS authorized,
      count(*) FILTER (WHERE decision = 'deny')::int                                           AS denied,
      count(*) FILTER (WHERE decision = 'hold')::int                                           AS held,
      COALESCE(SUM(settled_usdc) FILTER (WHERE decision = 'allow'), 0)::float8                  AS total_usdc_settled,
      count(*) FILTER (WHERE decision = 'allow' AND created_at > now() - interval '24 hours')::int AS auth_24h,
      count(*) FILTER (WHERE decision = 'deny'  AND created_at > now() - interval '24 hours')::int AS denied_24h
    FROM steward_payments`;

  const sourceRows = await sql<
    {
      source: string;
      authorized: number;
      denied: number;
      held: number;
      settled_usdc: number;
    }[]
  >`
    SELECT
      source,
      count(*) FILTER (WHERE decision = 'allow')::int                         AS authorized,
      count(*) FILTER (WHERE decision = 'deny')::int                          AS denied,
      count(*) FILTER (WHERE decision = 'hold')::int                          AS held,
      COALESCE(SUM(settled_usdc) FILTER (WHERE decision = 'allow'), 0)::float8 AS settled_usdc
    FROM steward_payments
    GROUP BY source
    ORDER BY source`;

  const [inc] = await sql<{ caught: number; open: number }[]>`
    SELECT
      count(*)::int                                   AS caught,
      count(*) FILTER (WHERE status = 'open')::int    AS open
    FROM steward_incidents`;

  const kindRows = await sql<{ kind: string; n: number }[]>`
    SELECT kind, count(*)::int AS n
    FROM steward_incidents
    GROUP BY kind
    ORDER BY n DESC`;

  const [appr] = await sql<{ pending: number }[]>`
    SELECT count(*) FILTER (WHERE status = 'pending')::int AS pending
    FROM steward_approvals`;

  const [frz] = await sql<{ frozen: boolean }[]>`
    SELECT COALESCE((value->>'frozen')::boolean, false) AS frozen
    FROM steward_state WHERE key = 'frozen' LIMIT 1`;

  const by_kind: Record<string, number> = {};
  for (const r of kindRows) by_kind[r.kind] = r.n;

  const by_source: StewardMetrics['by_source'] = {};
  for (const r of sourceRows) {
    by_source[r.source] = {
      authorized: r.authorized,
      denied: r.denied,
      held: r.held,
      settled_usdc: round(r.settled_usdc),
    };
  }

  return {
    generated_at: new Date().toISOString(),
    payments: {
      authorized: pay?.authorized ?? 0,
      denied: pay?.denied ?? 0,
      held: pay?.held ?? 0,
      total_usdc_settled: round(pay?.total_usdc_settled),
      last24h: {
        authorized: pay?.auth_24h ?? 0,
        denied: pay?.denied_24h ?? 0,
      },
    },
    incidents: {
      caught: inc?.caught ?? 0,
      open: inc?.open ?? 0,
      by_kind,
    },
    approvals: { pending: appr?.pending ?? 0 },
    by_source,
    honest_note: HONEST_NOTE,
    frozen: frz?.frozen ?? false,
  };
}
