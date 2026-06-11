// HireBot — budget-aware paying agent (Lepton Phase 1 A4).
//
// A standalone worker that behaves like a stranger's agent shopping for a
// provider: it scans funded ERC-8183 jobs over the PUBLIC Caliber HTTP API
// (no DB shortcuts, no bypass token), and for each provider decides whether
// paying the metered price for a signed trust check is worth it — then applies
// a hire rule. Every decision (and its human-readable rationale) is persisted
// to `hirebot_decisions`, which is also the agent's only state: today's spend
// and the per-provider attestation cache are both read back from that table.
//
// Run once per invocation (systemd timer fires it every N minutes), or pass
// --loop for a self-driven dev loop.

import { db, sql, hirebotDecisions } from '@arc-agents/db';
import { CaliberPayer } from '@caliber/x402-client';

type Hex = `0x${string}`;

// ---- config -----------------------------------------------------------------

const num = (v: string | undefined, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

const API_BASE = (process.env.CALIBER_API_BASE || 'https://caliber-api.poko.blue').replace(/\/+$/, '');
const WEB_BASE = (process.env.CALIBER_WEB_BASE || 'https://caliber.poko.blue').replace(/\/+$/, '');
const DAILY_BUDGET = num(process.env.HIREBOT_DAILY_BUDGET_USDC, 10);
const MIN_JOB = num(process.env.MIN_JOB_USDC, 5);
const CACHE_TTL_HOURS = num(process.env.CACHE_TTL_HOURS, 6);
const MAX_CANDIDATES = num(process.env.HIREBOT_MAX_CANDIDATES, 20);
// The web API's sort=biggest returns NULL-budget jobs first, so we over-fetch
// and filter/sort client-side to real, valued, agent-provided jobs.
const FETCH_LIMIT = num(process.env.HIREBOT_FETCH_LIMIT, 100);
const INTERVAL_MS = num(process.env.HIREBOT_INTERVAL_MS, 10 * 60 * 1000);
// Price as a number — X402_PRICE_USDC is a dollar string like "$0.001".
const PRICE = num((process.env.X402_PRICE_USDC || '$0.001').replace(/[^0-9.]/g, ''), 0.001);

function resolveKey(): Hex {
  const k = process.env.HIREBOT_PRIVATE_KEY;
  if (!k) throw new Error('HIREBOT_PRIVATE_KEY not set');
  return (k.startsWith('0x') ? k : `0x${k}`) as Hex;
}

// Hire rule: a provider is hireable at Gold/Silver with no risk flags.
const HIREABLE_TIERS = new Set(['Gold', 'Silver']);

// ---- types from the public API ---------------------------------------------

interface JobRow {
  jobId: string;
  providerAddress: string;
  budgetUsdc: string | null;
  providerAgentId: string | null;
}
interface RatingJson {
  rated: boolean;
  tier?: string;
  score?: number;
  confidence?: string;
  flags?: string[];
  reason?: string;
}

// ---- persistence ------------------------------------------------------------

type Action = 'purchased' | 'cache_hit' | 'not_worth_it' | 'budget_blocked' | 'would_hire' | 'would_skip';

interface Decision {
  jobId: string | null;
  providerId: string | null;
  action: Action;
  rationale: string;
  costUsdc?: number;
  budgetLeft: number;
  tier?: string | null;
  score?: number | null;
  paymentRef?: string | null;
}

const fmt = (n: number) => n.toFixed(6);

async function record(d: Decision): Promise<void> {
  await db.insert(hirebotDecisions).values({
    jobId: d.jobId != null ? BigInt(d.jobId) : null,
    providerId: d.providerId != null ? BigInt(d.providerId) : null,
    action: d.action,
    rationale: d.rationale,
    costUsdc: fmt(d.costUsdc ?? 0),
    budgetLeft: fmt(d.budgetLeft),
    tier: d.tier ?? null,
    score: d.score ?? null,
    paymentRef: d.paymentRef ?? null,
  });
}

async function todaySpent(): Promise<number> {
  const rows = await sql<{ spent: number }[]>`
    SELECT COALESCE(SUM(cost_usdc), 0)::float8 AS spent
    FROM hirebot_decisions
    WHERE created_at >= date_trunc('day', now())`;
  return rows[0]?.spent ?? 0;
}

interface CacheHit {
  tier: string | null;
  score: number | null;
  ageMin: number;
}
async function cacheLookup(providerId: string): Promise<CacheHit | null> {
  const cutoff = new Date(Date.now() - CACHE_TTL_HOURS * 3600_000).toISOString();
  const rows = await sql<{ tier: string | null; score: number | null; created_at: Date }[]>`
    SELECT tier, score, created_at
    FROM hirebot_decisions
    WHERE provider_id = ${providerId} AND action = 'purchased' AND created_at >= ${cutoff}
    ORDER BY created_at DESC LIMIT 1`;
  if (!rows[0]) return null;
  const ageMin = Math.round((Date.now() - new Date(rows[0].created_at).getTime()) / 60000);
  return { tier: rows[0].tier, score: rows[0].score, ageMin };
}

// ---- public API access ------------------------------------------------------

async function fetchFundedJobs(): Promise<JobRow[]> {
  const url = `${WEB_BASE}/api/jobs?status=Funded&sort=biggest&limit=${FETCH_LIMIT}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`jobs fetch ${res.status} from ${url}`);
  const body = (await res.json()) as { jobs?: JobRow[] };
  return body.jobs ?? [];
}

/** Keep only jobs with a real escrow value and an agent provider, biggest first. */
function selectCandidates(jobs: JobRow[]): JobRow[] {
  return jobs
    .filter((j) => j.providerAgentId && j.budgetUsdc != null && Number(j.budgetUsdc) > 0)
    .sort((a, b) => Number(b.budgetUsdc) - Number(a.budgetUsdc));
}

async function freeTriage(providerId: string): Promise<RatingJson> {
  const res = await fetch(`${API_BASE}/v1/agents/arc/${providerId}/rating`);
  return (await res.json()) as RatingJson;
}

const usd = (n: number) => `$${n.toFixed(3)}`;

// ---- one pass ---------------------------------------------------------------

async function runOnce(payer: CaliberPayer): Promise<void> {
  const spent = await todaySpent();
  let budgetLeft = Math.max(0, DAILY_BUDGET - spent);
  console.log(
    `[hirebot] pass start · wallet ${payer.address} · budget ${usd(DAILY_BUDGET)} · spent today ${usd(spent)} · left ${usd(budgetLeft)}`,
  );

  const allJobs = await fetchFundedJobs();
  const candidates = selectCandidates(allJobs);
  console.log(
    `[hirebot] ${allJobs.length} funded jobs · ${candidates.length} with escrow+agent · assessing up to ${MAX_CANDIDATES} providers`,
  );

  const seenProviders = new Set<string>();
  const tally: Partial<Record<Action, number>> = {};
  const bump = (a: Action) => (tally[a] = (tally[a] ?? 0) + 1);

  for (const job of candidates) {
    if (seenProviders.size >= MAX_CANDIDATES) break;
    const providerId = job.providerAgentId!;
    const jobId = job.jobId;
    const escrow = Number(job.budgetUsdc ?? 0);

    // Assess each provider at most once per pass.
    if (seenProviders.has(providerId)) continue;
    seenProviders.add(providerId);

    // Escrow below the floor → not worth a paid trust check.
    if (escrow < MIN_JOB) {
      await record({ jobId, providerId, action: 'not_worth_it', budgetLeft,
        rationale: `provider #${providerId}: escrow ${usd(escrow)} < ${usd(MIN_JOB)} floor — trust check not worth it` });
      bump('not_worth_it');
      continue;
    }

    // Cheap triage on the free rating before paying for the signed attestation.
    let triage: RatingJson;
    try {
      triage = await freeTriage(providerId);
    } catch (e) {
      await record({ jobId, providerId, action: 'would_skip', budgetLeft,
        rationale: `provider #${providerId}: triage failed (${e instanceof Error ? e.message : e}) — skipped` });
      bump('would_skip');
      continue;
    }
    if (!triage.rated) {
      await record({ jobId, providerId, action: 'would_skip', budgetLeft,
        rationale: `provider #${providerId}: unrated (${triage.reason ?? 'no rating'}) — not paying for a trust check` });
      bump('would_skip');
      continue;
    }

    let tier: string | null;
    let score: number | null;
    let flags: string[];

    const cached = await cacheLookup(providerId);
    if (cached) {
      tier = cached.tier;
      score = cached.score;
      flags = triage.flags ?? [];
      await record({ jobId, providerId, action: 'cache_hit', budgetLeft, tier, score,
        rationale: `provider #${providerId}: cached attestation (tier ${tier}, ${cached.ageMin}m old) < ${CACHE_TTL_HOURS}h TTL — reused, $0 spent` });
      bump('cache_hit');
    } else if (budgetLeft >= PRICE) {
      // Pay for the signed attestation. minTier/minConfidence wide so any rated
      // agent returns 200 (HireBot applies its OWN hire rule on the result).
      try {
        const res = await payer.payForAttestation(providerId, { minTier: 'Dormant', minConfidence: 'insufficient' });
        tier = res.data.tier ?? triage.tier ?? null;
        score = (res.data.score ?? triage.score ?? null) as number | null;
        flags = res.data.flags ?? triage.flags ?? [];
        budgetLeft = Math.max(0, budgetLeft - PRICE);
        await record({ jobId, providerId, action: 'purchased', costUsdc: PRICE, budgetLeft, tier, score,
          paymentRef: res.payment.transaction || null,
          rationale: `provider #${providerId}: escrow ${usd(escrow)} ≥ ${usd(MIN_JOB)} floor; no fresh cache; paid ${usd(PRICE)} for signed attestation → tier ${tier} score ${score}` });
        bump('purchased');
      } catch (e) {
        await record({ jobId, providerId, action: 'would_skip', budgetLeft,
          rationale: `provider #${providerId}: attestation purchase failed (${e instanceof Error ? e.message : e})` });
        bump('would_skip');
        continue;
      }
    } else {
      await record({ jobId, providerId, action: 'budget_blocked', budgetLeft,
        rationale: `provider #${providerId}: daily budget exhausted (${usd(budgetLeft)} < ${usd(PRICE)}) — deferring trust check` });
      bump('budget_blocked');
      continue;
    }

    // Hire rule on the (paid or cached) result.
    const hire = tier != null && HIREABLE_TIERS.has(tier) && flags.length === 0;
    await record({ jobId, providerId, action: hire ? 'would_hire' : 'would_skip', budgetLeft, tier, score,
      rationale: hire
        ? `provider #${providerId}: tier ${tier}, no blocking flags → would hire for job #${jobId} (${usd(escrow)})`
        : `provider #${providerId}: tier ${tier ?? 'unknown'}${flags.length ? `, flags [${flags.join(', ')}]` : ''} → would skip` });
    bump(hire ? 'would_hire' : 'would_skip');
  }

  const summary = Object.entries(tally).map(([k, v]) => `${k}=${v}`).join(' · ') || 'no candidates';
  console.log(`[hirebot] pass done · ${summary} · budget left ${usd(budgetLeft)}`);
}

// ---- entry ------------------------------------------------------------------

async function main(): Promise<void> {
  const payer = new CaliberPayer({ privateKey: resolveKey(), apiBase: API_BASE });
  const loop = process.argv.includes('--loop');
  await runOnce(payer);
  if (!loop) {
    await sql.end();
    return;
  }
  console.log(`[hirebot] loop mode · every ${Math.round(INTERVAL_MS / 1000)}s`);
  setInterval(() => {
    runOnce(payer).catch((e) => console.error('[hirebot] pass error:', e instanceof Error ? e.message : e));
  }, INTERVAL_MS);
}

main().catch((e) => {
  console.error('[hirebot] fatal:', e instanceof Error ? e.message : e);
  process.exit(1);
});
