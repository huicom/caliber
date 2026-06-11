import { notFound } from 'next/navigation';
import Link from 'next/link';
import { sql } from '@/lib/db';

// HireBot dashboard — the agent's budget, cache efficiency, and decision log
// (verbatim rationale = the agentic-sophistication evidence). Caliber cl-*
// language. Behind NEXT_PUBLIC_LEPTON.

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata = {
  title: 'HireBot — budget-aware paying agent · Caliber',
  description:
    'A budget-constrained demo agent that pays Caliber Metered per attestation and decides, job by job, whether a trust check is worth it.',
};

const DAILY_BUDGET = Number(process.env.HIREBOT_DAILY_BUDGET_USDC ?? 10);

// action → { label, color } in the Caliber palette.
const ACTION: Record<string, { label: string; color: string }> = {
  purchased:      { label: 'purchased',     color: 'var(--copper)' },
  cache_hit:      { label: 'cache hit',     color: 'var(--signal-up)' },
  not_worth_it:   { label: 'not worth it',  color: 'var(--mute)' },
  budget_blocked: { label: 'budget blocked', color: 'var(--signal-watch)' },
  would_hire:     { label: 'would hire',    color: 'var(--signal-up)' },
  would_skip:     { label: 'would skip',    color: 'var(--tier-bronze)' },
};
const TIER_COLOR: Record<string, string> = {
  Gold: 'var(--tier-gold)', Silver: 'var(--tier-silver)', Bronze: 'var(--tier-bronze)',
  Pending: 'var(--tier-pending)', Watch: 'var(--tier-watch)', Dormant: 'var(--tier-dormant)',
};

interface DecisionRow {
  id: string; created_at: Date; action: string; tier: string | null;
  score: number | null; cost_usdc: string; rationale: string; provider_id: string | null; job_id: string | null;
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
    SELECT COALESCE(SUM(cost_usdc),0)::float8 AS spent_today
    FROM hirebot_decisions WHERE created_at >= date_trunc('day', now())`;
  const spentToday = spentRow?.spent_today ?? 0;
  const remaining = Math.max(0, DAILY_BUDGET - spentToday);
  const pctSpent = DAILY_BUDGET > 0 ? Math.min(100, (spentToday / DAILY_BUDGET) * 100) : 0;

  const counts = await sql<{ action: string; n: number; cost: number }[]>`
    SELECT action, count(*)::int AS n, COALESCE(SUM(cost_usdc),0)::float8 AS cost
    FROM hirebot_decisions GROUP BY action`;
  const byAction = Object.fromEntries(counts.map((c) => [c.action, c]));
  const purchased = byAction['purchased']?.n ?? 0;
  const cacheHits = byAction['cache_hit']?.n ?? 0;
  const lookups = purchased + cacheHits;
  const cacheRate = lookups > 0 ? Math.round((cacheHits / lookups) * 100) : 0;
  const totalCost = counts.reduce((s, c) => s + c.cost, 0);
  const assessed = (byAction['would_hire']?.n ?? 0) + (byAction['would_skip']?.n ?? 0);
  const costPerTask = assessed > 0 ? totalCost / assessed : 0;

  const recent = await sql<DecisionRow[]>`
    SELECT id, created_at, action, tier, score, cost_usdc, rationale, provider_id, job_id
    FROM hirebot_decisions ORDER BY id DESC LIMIT 40`;

  return (
    <main className="cl-body">
      <section className="cl-hero">
        <div className="cl-container" style={{ maxWidth: 920 }}>
          <p className="cl-eyebrow">
            caliber labs<span style={{ padding: '0 10px' }}>·</span><b>reference consumer</b>
            <span style={{ padding: '0 10px' }}>·</span>budget agent
          </p>
          <h1 className="cl-hero__title" style={{ maxWidth: '14ch' }}>
            HireBot spends only when it pays off<span className="cl-hero__title-dot">.</span>
          </h1>
          <p className="cl-hero__lede" style={{ maxWidth: '58ch' }}>
            A budget-constrained agent that shops funded jobs and pays Caliber Metered a
            sub-cent nanopayment for a signed trust check — <b>only when the math says
            it&apos;s worth it</b>. Every decision below is the agent&apos;s own, recorded
            verbatim.
          </p>
        </div>
      </section>

      <section className="cl-section cl-section--tight" style={{ paddingTop: 0 }}>
        <div className="cl-container" style={{ maxWidth: 920 }}>
          <div className="lp-what" style={{ marginBottom: 32 }}>
            <span className="lp-what__k">// what is this</span>
            <p>
              An autonomous loop: fetch funded jobs → triage each provider on the free
              rating → if the escrow clears a floor and there&apos;s no fresh cache,
              <b> pay</b> for the signed attestation → apply a hire rule. It stops at its
              daily budget. The point is an external agent paying real USDC for trust.
            </p>
          </div>

          {/* budget gauge */}
          <div style={{ border: '1px solid var(--hairline)', background: 'var(--color-bg-elev)', padding: 20, marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
              <span className="cl-eyebrow--section" style={{ margin: 0 }}>// daily budget</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 14 }}>
                ${spentToday.toFixed(3)} spent · <b style={{ color: 'var(--copper)' }}>${remaining.toFixed(3)} left</b> of ${DAILY_BUDGET.toFixed(2)}
              </span>
            </div>
            <div style={{ height: 10, background: 'var(--color-bg-elev-2)', overflow: 'hidden', border: '1px solid var(--hairline)' }}>
              <div style={{ width: `${pctSpent}%`, height: '100%', background: 'var(--copper)', transition: 'width .3s' }} />
            </div>
          </div>

          {/* stats */}
          <div className="cl-stats" style={{ marginBottom: 40 }}>
            <div className="cl-stats__row">
              <div className="cl-stats__cell">
                <div className="cl-stats__label">attestations bought</div>
                <div className="cl-stats__value">{purchased}</div>
                <div className="cl-stats__note">real x402 payments</div>
              </div>
              <div className="cl-stats__cell">
                <div className="cl-stats__label">cache hit rate</div>
                <div className="cl-stats__value cl-stats__value--copper">{cacheRate}%</div>
                <div className="cl-stats__note">{cacheHits}/{lookups || 0} reused</div>
              </div>
              <div className="cl-stats__cell">
                <div className="cl-stats__label">avg cost / task</div>
                <div className="cl-stats__value">${costPerTask.toFixed(4)}</div>
                <div className="cl-stats__note">{assessed} providers assessed</div>
              </div>
            </div>
          </div>

          {/* decision log */}
          <header className="cl-section__head cl-section__head--single" style={{ marginBottom: 18 }}>
            <div>
              <span className="cl-eyebrow--section">// decision log</span>
              <h2 className="cl-h2" style={{ fontSize: 'clamp(26px,3vw,34px)' }}>The agent&apos;s reasoning, verbatim<span className="cl-h2__dot">.</span></h2>
            </div>
          </header>
          {recent.length === 0 ? (
            <p className="aa-foot-mono">No decisions yet — HireBot runs on a timer.</p>
          ) : (
            <ol style={{ listStyle: 'none', padding: 0, margin: 0, border: '1px solid var(--hairline)' }}>
              {recent.map((r, i) => {
                const a = ACTION[r.action] ?? { label: r.action, color: 'var(--mute)' };
                return (
                  <li key={r.id} style={{ display: 'flex', gap: 14, alignItems: 'flex-start', padding: '12px 16px', borderTop: i ? '1px solid var(--hairline)' : 'none' }}>
                    <span style={{ flexShrink: 0, fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600, color: a.color, minWidth: 92, textTransform: 'uppercase', letterSpacing: '0.02em', paddingTop: 1 }}>{a.label}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.45 }}>{r.rationale}</p>
                      <div style={{ marginTop: 4, display: 'flex', gap: 12, flexWrap: 'wrap', fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--mute)' }}>
                        <span>{relTime(r.created_at)}</span>
                        {r.tier ? <span style={{ color: TIER_COLOR[r.tier] ?? 'var(--mute)' }}>tier {r.tier}{r.score != null ? ` · ${r.score}` : ''}</span> : null}
                        <span>{Number(r.cost_usdc) > 0 ? `paid $${Number(r.cost_usdc).toFixed(4)}` : '$0'}</span>
                        {r.provider_id ? <Link href={`/passport/arc/${r.provider_id}`} className="cl-nav__link">provider #{r.provider_id}</Link> : null}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}

          <p className="aa-foot-mono" style={{ marginTop: 30, color: 'var(--mute)' }}>
            ← <Link href="/lepton" className="cl-nav__link">Lepton overview</Link> · the rail it pays → <Link href="/metered" className="cl-nav__link">Caliber Metered</Link>
          </p>
        </div>
      </section>
    </main>
  );
}
