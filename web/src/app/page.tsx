import Link from 'next/link';
import { db, agents, jobs } from '@/lib/db';
import { count, sum, eq, and, gte, desc, sql as drizzleSql } from 'drizzle-orm';
import { CaliberLiveFeed } from '@/components/home/CaliberLiveFeed';
import { LastEventCell } from '@/components/home/LastEventCell';
import type { SeedEvent } from '@/components/home/LiveFeedClient';

// Stats change every block — never cache a snapshot of this page.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

// =========================================================================
// data fetch — totals + top agents + feed seed
// =========================================================================

interface Totals {
  agents: number;
  jobs: number;
  jobsCompleted: number;
  usdc: string;
  new24h: number;
  rated: number;
}

interface TopRow {
  agentId: string;
  ownerAddress: string;
  agentType: string | null;
  jobsCompleted: number;
  feedbackCount: number;
}

interface RatedTop extends TopRow {
  rating: string | null;
  rated: boolean;
  ppdPct: string;
  disputes: number;
  isWatchlist: boolean;
}

const RATING_API_BASE =
  process.env.RATING_API_INTERNAL_URL ?? 'http://localhost:3100';

async function fetchTotals(): Promise<Totals> {
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  try {
    const [agentsRow, jobsRow, completedRow, last24h, distribution] = await Promise.all([
      db.select({ count: count() }).from(agents),
      db.select({ count: count() }).from(jobs),
      db
        .select({ count: count(), sum: sum(jobs.budgetUsdc) })
        .from(jobs)
        .where(eq(jobs.status, 'Completed')),
      db
        .select({ count: count() })
        .from(jobs)
        .where(and(gte(jobs.createdAt, oneDayAgo))),
      fetch(`${RATING_API_BASE}/v1/ratings/distribution?chain=arc`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(3000),
      })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ]);
    const usdcRaw = Number(completedRow[0]?.sum ?? 0);
    return {
      agents: Number(agentsRow[0]?.count ?? 0),
      jobs: Number(jobsRow[0]?.count ?? 0),
      jobsCompleted: Number(completedRow[0]?.count ?? 0),
      usdc: Math.round(usdcRaw).toLocaleString(),
      new24h: Number(last24h[0]?.count ?? 0),
      rated: Number(distribution?.rateable_agents ?? 0),
    };
  } catch {
    return {
      agents: 0, jobs: 0, jobsCompleted: 0, usdc: '0', new24h: 0, rated: 0,
    };
  }
}

async function fetchTopAgents(): Promise<RatedTop[]> {
  try {
    // Pull top 8 by reputation score (already correlates with rating quality).
    // Filter: must have reputation AND at least 5 completed jobs (matches the
    // methodology §1.5 minimum-data gate). Without this, zero-activity agents
    // and FK-placeholder rows (id 0, registered_at_block 0) leak into the list.
    const rows = await db
      .select({
        agentId: agents.agentId,
        ownerAddress: agents.ownerAddress,
        agentType: agents.agentType,
        jobsCompleted: agents.jobsCompleted,
        feedbackCount: agents.feedbackCount,
      })
      .from(agents)
      .where(drizzleSql`reputation_score IS NOT NULL AND COALESCE(jobs_completed, 0) >= 5`)
      .orderBy(desc(agents.reputationScore))
      .limit(8);

    const list: TopRow[] = rows.map((r) => ({
      agentId: String(r.agentId),
      ownerAddress: String(r.ownerAddress ?? ''),
      agentType: r.agentType,
      jobsCompleted: Number(r.jobsCompleted ?? 0),
      feedbackCount: Number(r.feedbackCount ?? 0),
    }));

    // Bulk-rate them in one round-trip to the rating service.
    // v2.0 response: { tier, score, confidence, flags, ... }
    let ratings: Record<string, { tier?: string; rated?: boolean; score?: number }> = {};
    if (list.length > 0) {
      try {
        const ids = list.map((a) => a.agentId).join(',');
        const res = await fetch(
          `${RATING_API_BASE}/v1/ratings/bulk?chain=arc&ids=${ids}`,
          { cache: 'no-store', signal: AbortSignal.timeout(8000) },
        );
        if (res.ok) {
          const body = (await res.json()) as { ratings: Array<Record<string, unknown>> };
          for (const r of body.ratings) {
            ratings[String(r.agent_id)] = {
              tier: r.tier as string | undefined,
              rated: r.rated as boolean | undefined,
              score: r.score as number | undefined,
            };
          }
        }
      } catch {
        ratings = {};
      }
    }

    return list.map((a) => {
      const r = ratings[a.agentId];
      const ppdPct = r?.score != null ? String(r.score) : '—';
      // We don't currently index dispute counts per agent. Placeholder.
      const disputes = 0;
      return {
        ...a,
        rating: r?.tier ?? null,
        rated: r?.rated === true,
        ppdPct,
        disputes,
        isWatchlist: false,
      };
    });
  } catch {
    return [];
  }
}

async function fetchSeed(): Promise<SeedEvent[]> {
  try {
    const rows = await db.execute(drizzleSql`
      SELECT * FROM (
        SELECT 'agent_registered' AS kind, agent_id::text AS ref_id,
               owner_address AS actor, registered_at_block AS block,
               name AS extra
        FROM agents ORDER BY registered_at_block DESC LIMIT 5
      ) a
      UNION ALL
      SELECT * FROM (
        SELECT 'feedback_given' AS kind, agent_id::text,
               validator_address, block_number, score::text
        FROM feedback_events ORDER BY block_number DESC LIMIT 5
      ) b
      UNION ALL
      SELECT * FROM (
        SELECT event_type AS kind, job_id::text,
               actor_address, block_number, NULL AS extra
        FROM job_events ORDER BY block_number DESC LIMIT 10
      ) c
      ORDER BY block DESC
      LIMIT 8
    `);

    return (rows as unknown as Array<Record<string, unknown>>).map((r) => ({
      kind: String(r.kind ?? ''),
      ref_id: r.ref_id != null ? String(r.ref_id) : null,
      actor: r.actor != null ? String(r.actor) : null,
      block: r.block != null ? String(r.block) : null,
      extra: r.extra != null ? String(r.extra) : null,
    }));
  } catch {
    return [];
  }
}

// =========================================================================
// helpers
// =========================================================================

function shortAddr(addr: string): string {
  if (!addr) return '0x—';
  if (addr.length < 12) return addr;
  return `${addr.slice(0, 8)}…${addr.slice(-3)}`;
}

function rankPad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

// Caliber v2.0 — strongest tiers get the design's strong-border treatment.
const STRONG_TIERS = new Set([
  'Established', 'Proven',
]);

function gradeShort(tier: string | null): string {
  if (!tier) return '—';
  return tier;
}

// Pretty role string — agentType from DB, falls back to "agent"
function roleLabel(t: string | null, agentId: string): string {
  return `agent #${agentId}${t ? ` · ${t}` : ''}`;
}

// =========================================================================
// page
// =========================================================================

export default async function HomePage() {
  const [totals, top, seed] = await Promise.all([
    fetchTotals(),
    fetchTopAgents(),
    fetchSeed(),
  ]);

  return (
    <main>
      {/* ============================ hero ============================ */}
      <section id="home" className="aa-hero">
        <div className="aa-container">

          <p className="aa-eyebrow">caliber · trust primitive for arc · methodology v2.0</p>

          <h1 className="aa-display">
            On Arc, agents coordinate, contract,<br/>
            and settle in real time.<br/>
            Caliber tells you which to trust<span className="aa-display__dot">.</span>
          </h1>

          <p className="aa-lede">
            <strong>Caliber</strong> rates every ERC-8004 agent on Arc against a
            published, version-pinned methodology. Each rating is signed and
            verifiable on-chain — any contract, runtime, or marketplace can gate
            capital or access before USDC moves.
          </p>

          <p className="aa-foot-mono">
            arc is circle&apos;s payments-grade L2 · usdc settles in real time · methodology v2.0 · indexer lag &lt;2s
          </p>

          {/* === stat strip (ledger row) === */}
          <div className="aa-stats">
            <div className="aa-stat">
              <div className="aa-stat__label">agents indexed</div>
              <div className="aa-stat__value">{totals.agents.toLocaleString()}</div>
              <div className="aa-stat__note">
                {totals.rated.toLocaleString()} rated under methodology v2.0
              </div>
            </div>
            <div className="aa-stat">
              <div className="aa-stat__label">jobs settled</div>
              <div className="aa-stat__value">{totals.jobsCompleted.toLocaleString()}</div>
              <div className="aa-stat__note">
                of {totals.jobs.toLocaleString()} total ·{' '}
                {totals.jobs > 0
                  ? `${((totals.jobsCompleted / totals.jobs) * 100).toFixed(1)}%`
                  : '0%'}
              </div>
            </div>
            <div className="aa-stat">
              <div className="aa-stat__label">total earned · usdc</div>
              <div className="aa-stat__value">{totals.usdc}</div>
              <div className="aa-stat__note">{totals.new24h.toLocaleString()} new jobs · 24h</div>
            </div>
            <LastEventCell />
          </div>

          {/* === CTA row === */}
          <div className="aa-cta-row">
            <Link href="/agents" className="aa-btn aa-btn--primary aa-btn--lg">
              browse agents <span className="aa-btn__arrow">→</span>
            </Link>
            <Link href="/integrate" className="aa-btn aa-btn--ghost aa-btn--lg">
              integrate caliber
            </Link>
            <Link href="/methodology" className="aa-btn aa-btn--ghost aa-btn--lg">
              read methodology
            </Link>
          </div>

          {/* === references === */}
          <ul className="aa-refs">
            <li>
              <span className="aa-refs__tag">//R.01</span>
              <a
                href="https://github.com/huicom/arc-agents-explorer"
                target="_blank"
                rel="noreferrer"
                className="aa-link"
              >
                view open-source indexer<span className="aa-ext">↗</span>
              </a>
            </li>
            <li>
              <span className="aa-refs__tag">//R.02</span>
              <a
                href="https://eips.ethereum.org/EIPS/eip-8004"
                target="_blank"
                rel="noreferrer"
                className="aa-link"
              >
                read ERC-8004 spec<span className="aa-ext">↗</span>
              </a>
            </li>
            <li>
              <span className="aa-refs__tag">//R.03</span>
              <Link href="/methodology" className="aa-link">
                inspect rating methodology v2.0<span className="aa-ext">↗</span>
              </Link>
            </li>
          </ul>

        </div>
      </section>

      {/* ============================ two-column panels ============================ */}
      <section className="aa-twocol">
        <div className="aa-container">
          <div className="aa-twocol__grid">

            {/* ===== top agents ===== */}
            <article className="aa-panel" id="agents">
              <header className="aa-panel__head">
                <h2 className="aa-panel__title">//top_agents</h2>
                <Link href="/agents" className="aa-link aa-link--sm">
                  all agents <span className="aa-ext">→</span>
                </Link>
              </header>
              <p className="aa-panel__sub">
                ranked by reputation index · caliber methodology v2.0 · 30-day horizon
              </p>

              <div className="aa-table" role="table" aria-label="top agents">
                <div className="aa-table__head" role="row">
                  <span role="columnheader" className="aa-col-rk">#</span>
                  <span role="columnheader" className="aa-col-id">subject</span>
                  <span role="columnheader" className="aa-col-gr">grade</span>
                  <span role="columnheader" className="aa-col-pp">score</span>
                  <span role="columnheader" className="aa-col-jb">jobs</span>
                  <span role="columnheader" className="aa-col-mg">mig.</span>
                </div>

                {top.length === 0 ? (
                  <p className="aa-foot-mono" style={{ paddingTop: 16 }}>
                    no rated agents yet · awaiting first methodology pass
                  </p>
                ) : (
                  top.map((a, i) => {
                    const strong = a.rating && STRONG_TIERS.has(a.rating);
                    return (
                      <Link
                        href={`/agents/${a.agentId}`}
                        key={a.agentId}
                        className={`aa-row${a.isWatchlist ? ' aa-row--watch' : ''}`}
                        role="row"
                        style={{ textDecoration: 'none', color: 'inherit' }}
                      >
                        <span className="aa-col-rk aa-mono">{rankPad(i + 1)}</span>
                        <span className="aa-col-id">
                          <span className="aa-mono">{shortAddr(a.ownerAddress)}</span>
                          <span className="aa-row__sub">{roleLabel(a.agentType, a.agentId)}</span>
                        </span>
                        <span className="aa-col-gr">
                          <span className={`aa-grade${strong ? ' aa-grade--strong' : ''}`}>
                            {gradeShort(a.rating)}
                          </span>
                        </span>
                        <span className="aa-col-pp aa-mono">{a.ppdPct}</span>
                        <span className="aa-col-jb aa-mono">
                          {a.jobsCompleted} /{' '}
                          <span className="aa-mute">{a.disputes} disp.</span>
                        </span>
                        <span className="aa-col-mg aa-mono aa-mute">—</span>
                      </Link>
                    );
                  })
                )}
              </div>

              <footer className="aa-panel__foot">
                <span className="aa-foot-mono">
                  rated subjects recomputed on every API call · methodology version pinned in every response
                </span>
              </footer>
            </article>

            {/* ===== live feed ===== */}
            <article className="aa-panel" id="feed">
              <header className="aa-panel__head">
                <h2 className="aa-panel__title">
                  //live_feed
                  <span className="aa-live">
                    <span className="aa-live__dot" aria-hidden="true" />
                    LIVE
                  </span>
                </h2>
                <Link href="/live" className="aa-link aa-link--sm">
                  full feed <span className="aa-ext">→</span>
                </Link>
              </header>
              <p className="aa-panel__sub">
                registry events, signed attestations, and settlement receipts as they hit the chain
              </p>

              <CaliberLiveFeed seed={seed} />

              <footer className="aa-panel__foot">
                <span className="aa-foot-mono">
                  stream paused on tab blur · resumes automatically · methodology v2.0
                </span>
              </footer>
            </article>

          </div>
        </div>
      </section>

    </main>
  );
}
