import { notFound } from 'next/navigation';
import Link from 'next/link';
import { sql } from '@/lib/db';

// Lepton Phase 1 (A4): HireBot dashboard. Renders the agent's budget, its
// cache efficiency, and its decision log verbatim — the rationale strings are
// the agentic-sophistication evidence. Server component, reads DB truth.

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const PAGE_DESCRIPTION =
  'HireBot — a budget-constrained demo agent that pays Caliber Metered per attestation and decides, job by job, whether a trust check is worth it.';

export const metadata = {
  title: 'HireBot — budget-aware paying agent',
  description: PAGE_DESCRIPTION,
};

const DAILY_BUDGET = Number(process.env.HIREBOT_DAILY_BUDGET_USDC ?? 10);

const ACTION_STYLE: Record<string, { label: string; color: string; bg: string }> = {
  purchased:     { label: 'purchased',     color: '#1D4ED8', bg: '#1D4ED815' },
  cache_hit:     { label: 'cache hit',     color: '#15803D', bg: '#15803D15' },
  not_worth_it:  { label: 'not worth it',  color: '#98948C', bg: '#98948C15' },
  budget_blocked:{ label: 'budget blocked',color: '#B45309', bg: '#B4530915' },
  would_hire:    { label: 'would hire',    color: '#15803D', bg: '#15803D15' },
  would_skip:    { label: 'would skip',    color: '#8C5A2C', bg: '#8C5A2C12' },
};

const TIER_COLOR: Record<string, string> = {
  Gold: '#B8862B', Silver: '#7E8690', Bronze: '#8C5A2C',
  Pending: '#98948C', Watch: '#B45309', Dormant: '#A8A39A',
};

interface DecisionRow {
  id: string;
  created_at: Date;
  action: string;
  tier: string | null;
  score: number | null;
  cost_usdc: string;
  rationale: string;
  provider_id: string | null;
  job_id: string | null;
}

function relTime(d: Date): string {
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default async function HireBotPage() {
  if (process.env.NEXT_PUBLIC_LEPTON !== '1') notFound();

  const [spentRow] = await sql<{ spent_today: number }[]>`
    SELECT COALESCE(SUM(cost_usdc), 0)::float8 AS spent_today
    FROM hirebot_decisions WHERE created_at >= date_trunc('day', now())`;
  const spentToday = spentRow?.spent_today ?? 0;
  const remaining = Math.max(0, DAILY_BUDGET - spentToday);
  const pctSpent = DAILY_BUDGET > 0 ? Math.min(100, (spentToday / DAILY_BUDGET) * 100) : 0;

  const counts = await sql<{ action: string; n: number; cost: number }[]>`
    SELECT action, count(*)::int AS n, COALESCE(SUM(cost_usdc), 0)::float8 AS cost
    FROM hirebot_decisions GROUP BY action`;
  const byAction = Object.fromEntries(counts.map((c) => [c.action, c]));
  const purchased = byAction['purchased']?.n ?? 0;
  const cacheHits = byAction['cache_hit']?.n ?? 0;
  const lookups = purchased + cacheHits;
  const cacheRate = lookups > 0 ? Math.round((cacheHits / lookups) * 100) : 0;
  const totalCost = counts.reduce((s, c) => s + c.cost, 0);
  const wouldHire = byAction['would_hire']?.n ?? 0;
  const assessed = (byAction['would_hire']?.n ?? 0) + (byAction['would_skip']?.n ?? 0);
  const costPerTask = assessed > 0 ? totalCost / assessed : 0;

  const recent = await sql<DecisionRow[]>`
    SELECT id, created_at, action, tier, score, cost_usdc, rationale, provider_id, job_id
    FROM hirebot_decisions ORDER BY id DESC LIMIT 40`;

  return (
    <main className="aa-shell" style={{ maxWidth: 920, margin: '0 auto', padding: '2.5rem 1.25rem 4rem' }}>
      <p className="aa-foot-mono" style={{ marginBottom: 8 }}>caliber labs · reference consumer</p>
      <h1 className="aa-h1" style={{ marginBottom: 6 }}>HireBot</h1>
      <p className="aa-lede" style={{ marginBottom: 28, maxWidth: 640 }}>
        A budget-constrained agent that shops funded jobs and pays Caliber Metered
        a sub-cent USDC nanopayment for a signed trust check — only when the math
        says it&apos;s worth it. Every decision below is the agent&apos;s own,
        recorded verbatim. <Link href="/metered" className="aa-link">See the metered API →</Link>
      </p>

      {/* Budget gauge */}
      <section className="aa-card" style={{ padding: 20, marginBottom: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
          <span className="aa-foot-mono">daily budget</span>
          <span className="aa-mono" style={{ fontSize: 14 }}>
            ${spentToday.toFixed(3)} spent · <strong>${remaining.toFixed(3)} left</strong> of ${DAILY_BUDGET.toFixed(2)}
          </span>
        </div>
        <div style={{ height: 10, background: '#0001', borderRadius: 6, overflow: 'hidden' }}>
          <div style={{ width: `${pctSpent}%`, height: '100%', background: '#1D4ED8', transition: 'width .3s' }} />
        </div>
      </section>

      {/* Stats */}
      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 28 }}>
        <Stat label="attestations bought" value={String(purchased)} />
        <Stat label="cache hit rate" value={`${cacheRate}%`} sub={`${cacheHits}/${lookups || 0}`} />
        <Stat label="avg cost / task" value={`$${costPerTask.toFixed(4)}`} />
        <Stat label="would-hire calls" value={`${wouldHire}/${assessed || 0}`} />
      </section>

      {/* Decision log */}
      <h2 className="aa-h2" style={{ marginBottom: 12 }}>Decision log</h2>
      {recent.length === 0 ? (
        <p className="aa-foot-mono">No decisions yet — HireBot runs on a timer.</p>
      ) : (
        <ol style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {recent.map((r) => {
            const a = ACTION_STYLE[r.action] ?? { label: r.action, color: '#555', bg: '#5551' };
            return (
              <li key={r.id} className="aa-card" style={{ padding: '12px 14px', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 600, color: a.color, background: a.bg, padding: '3px 8px', borderRadius: 5, minWidth: 96, textAlign: 'center' }}>
                  {a.label}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: 14, lineHeight: 1.45 }}>{r.rationale}</p>
                  <div className="aa-foot-mono" style={{ marginTop: 4, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                    <span>{relTime(r.created_at)}</span>
                    {r.tier ? <span style={{ color: TIER_COLOR[r.tier] ?? '#555' }}>tier {r.tier}{r.score != null ? ` · ${r.score}` : ''}</span> : null}
                    {Number(r.cost_usdc) > 0 ? <span>paid ${Number(r.cost_usdc).toFixed(4)}</span> : <span>$0</span>}
                    {r.provider_id ? <Link href={`/passport/arc/${r.provider_id}`} className="aa-mono aa-link">provider #{r.provider_id}</Link> : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </main>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="aa-card" style={{ padding: 16 }}>
      <div className="aa-foot-mono" style={{ marginBottom: 6 }}>{label}</div>
      <div className="aa-mono" style={{ fontSize: 22, fontWeight: 700 }}>{value}</div>
      {sub ? <div className="aa-foot-mono" style={{ marginTop: 2, opacity: 0.7 }}>{sub}</div> : null}
    </div>
  );
}
