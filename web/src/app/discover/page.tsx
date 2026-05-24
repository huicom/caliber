import Link from 'next/link';
import { Suspense } from 'react';
import { db } from '@/lib/db';
import { sql as drizzleSql } from 'drizzle-orm';
import { VISIBLE_CATEGORIES } from '@/lib/categories';
import { SearchBox } from './_components/SearchBox';
import { AgentCard } from './_components/AgentCard';
import { embedText, toVectorLiteral } from '@/lib/embeddings/embed';

const PAGE_DESCRIPTION =
  'Find rated agents on Arc. Browse by what they do (trading, validation, on-chain assistants, payments, research, content, utility, services) or describe what you need in plain language. Every result links to a Caliber Passport.';

export const metadata = {
  title: 'Discover Caliber-rated agents on Arc',
  description: PAGE_DESCRIPTION,
  openGraph: {
    title: 'Discover Caliber-rated agents on Arc',
    description: PAGE_DESCRIPTION,
    url: 'https://caliber.poko.blue/discover',
    type: 'article',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Discover Caliber-rated agents on Arc',
    description: PAGE_DESCRIPTION,
  },
};

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface CategoryCardData {
  slug: string;
  title: string;
  blurb: string;
  agent_count: number;
  cluster_count: number;
  top: Array<{ agent_id: string; name: string; tier: string | null }>;
}

async function loadCategoryCards(): Promise<CategoryCardData[]> {
  // Counts per category
  const totals: any = await db.execute(drizzleSql.raw(`
    SELECT
      category,
      COUNT(*)::int AS agent_count,
      COUNT(DISTINCT CONCAT(name, '|', LEFT(COALESCE(metadata->>'description',''), 200)))::int AS cluster_count
    FROM agents
    WHERE category IS NOT NULL
    GROUP BY category;
  `));
  const totalsMap = new Map<string, { agent_count: number; cluster_count: number }>();
  for (const row of (totals.rows ?? totals) as Array<any>) {
    totalsMap.set(row.category, { agent_count: row.agent_count, cluster_count: row.cluster_count });
  }

  // Top 3 deduped representatives per category
  const topRows: any = await db.execute(drizzleSql.raw(`
    WITH ranked AS (
      SELECT
        a.category,
        a.agent_id::text AS agent_id,
        a.name,
        s.tier,
        ROW_NUMBER() OVER (
          PARTITION BY a.category, CONCAT(a.name, '|', LEFT(COALESCE(a.metadata->>'description',''), 200))
          ORDER BY
            CASE s.tier
              WHEN 'Gold' THEN 0 WHEN 'Silver' THEN 1 WHEN 'Bronze' THEN 2
              WHEN 'Pending' THEN 3 WHEN 'Watch' THEN 4 WHEN 'Dormant' THEN 5 ELSE 9
            END,
            a.jobs_completed DESC NULLS LAST
        ) AS rep_rank
      FROM agents a
      LEFT JOIN LATERAL (
        SELECT tier FROM rating_snapshots WHERE agent_id = a.agent_id AND view = 'PIT'
        ORDER BY computed_at DESC LIMIT 1
      ) s ON true
      WHERE a.category IS NOT NULL AND a.name IS NOT NULL
    ),
    reps AS (
      SELECT *,
        ROW_NUMBER() OVER (
          PARTITION BY category
          ORDER BY
            CASE tier
              WHEN 'Gold' THEN 0 WHEN 'Silver' THEN 1 WHEN 'Bronze' THEN 2
              WHEN 'Pending' THEN 3 WHEN 'Watch' THEN 4 WHEN 'Dormant' THEN 5 ELSE 9
            END
        ) AS top_rank
      FROM ranked WHERE rep_rank = 1
    )
    SELECT category, agent_id, name, tier FROM reps WHERE top_rank <= 3;
  `));
  const topByCat = new Map<string, Array<{ agent_id: string; name: string; tier: string | null }>>();
  for (const row of (topRows.rows ?? topRows) as Array<any>) {
    if (!topByCat.has(row.category)) topByCat.set(row.category, []);
    topByCat.get(row.category)!.push({ agent_id: row.agent_id, name: row.name, tier: row.tier });
  }

  return VISIBLE_CATEGORIES.map((cat) => ({
    slug: cat.slug,
    title: cat.title,
    blurb: cat.blurb,
    agent_count: totalsMap.get(cat.slug)?.agent_count ?? 0,
    cluster_count: totalsMap.get(cat.slug)?.cluster_count ?? 0,
    top: topByCat.get(cat.slug) ?? [],
  }));
}

interface RecentAgentRow {
  agent_id: string;
  name: string;
  category: string | null;
  tier: string | null;
  registered_at: Date | null;
}

async function loadRecentAgents(limit = 24): Promise<RecentAgentRow[]> {
  const r: any = await db.execute(
    drizzleSql.raw(`
    SELECT
      a.agent_id::text AS agent_id,
      a.name,
      a.category,
      COALESCE(a.registered_at, a.created_at) AS registered_at,
      s.tier
    FROM agents a
    LEFT JOIN LATERAL (
      SELECT tier FROM rating_snapshots WHERE agent_id = a.agent_id AND view = 'PIT'
      ORDER BY computed_at DESC LIMIT 1
    ) s ON true
    WHERE a.chain_id = 'arc'
      AND a.registered_at_block > 0
    ORDER BY a.registered_at_block DESC
    LIMIT ${limit};
  `),
  );
  return ((r.rows ?? r) as Array<any>).map((row) => ({
    ...row,
    registered_at: row.registered_at ? new Date(row.registered_at) : null,
  }));
}

// ============================================================================
// LIVE PULSE — 24h registrations by category lane, dots colored by tier
// ============================================================================
type PulseTier = 'est' | 'pro' | 'emg' | 'unr';
interface PulseDot { t: number; tier: PulseTier; agent_id: string; name: string | null }
interface PulseLane { label: string; total: number; dots: PulseDot[] }
interface PulseData {
  lanes: PulseLane[];
  windowMs: number;
  windowLabel: string;
  totalCount: number;
  latestAt: Date | null;
  recent: Array<{ agent_id: string; name: string | null; category: string; at: Date | null; tier: PulseTier }>;
}

const TIER_TO_SHORT: Record<string, PulseTier> = {
  Gold: 'est',
  Silver: 'pro',
  Bronze: 'emg',
  Pending: 'emg',
  Watch: 'emg',
  Dormant: 'emg',
};

type PulseWindow = '7d' | '30d' | 'all';

interface WindowConfig {
  whereClause: string; // SQL fragment for WHERE filter
  windowMs: number;    // dot positioning denominator
  label: string;       // axis label / header
  axisLabels: string[];// 5 axis tick labels left → right
  capPerLane: number;  // max dots per lane
}

function resolveWindow(w: PulseWindow, firstRegisteredAt: Date | null): WindowConfig {
  const now = Date.now();
  if (w === '7d') {
    return {
      whereClause: `AND COALESCE(a.registered_at, a.created_at) >= NOW() - INTERVAL '7 days'`,
      windowMs: 7 * 24 * 3600 * 1000,
      label: '7d',
      axisLabels: ['−7d', '−5d', '−3d', '−1d', 'now'],
      capPerLane: 80,
    };
  }
  if (w === '30d') {
    return {
      whereClause: `AND COALESCE(a.registered_at, a.created_at) >= NOW() - INTERVAL '30 days'`,
      windowMs: 30 * 24 * 3600 * 1000,
      label: '30d',
      axisLabels: ['−30d', '−22d', '−15d', '−7d', 'now'],
      capPerLane: 120,
    };
  }
  // all: span from first registration to now
  const firstMs = firstRegisteredAt ? firstRegisteredAt.getTime() : now - 30 * 24 * 3600 * 1000;
  const spanMs = Math.max(now - firstMs, 1);
  const spanDays = Math.ceil(spanMs / (24 * 3600 * 1000));
  const q1 = Math.ceil(spanDays * 0.75);
  const q2 = Math.ceil(spanDays * 0.5);
  const q3 = Math.ceil(spanDays * 0.25);
  return {
    whereClause: '', // no time filter — show everything
    windowMs: spanMs,
    label: 'all',
    axisLabels: [`−${spanDays}d`, `−${q1}d`, `−${q2}d`, `−${q3}d`, 'now'],
    capPerLane: 200,
  };
}

async function loadPulseData(windowKey: PulseWindow = '30d'): Promise<PulseData & { windowKey: PulseWindow; axisLabels: string[] }> {
  // Lookup first registration once — needed for 'all' window scaling.
  const firstRaw: any = await db.execute(drizzleSql.raw(`
    SELECT MIN(COALESCE(registered_at, created_at)) AS first_at
    FROM agents
    WHERE chain_id = 'arc' AND registered_at_block > 0
  `));
  const firstRow = (firstRaw.rows ?? firstRaw)[0];
  const firstRegisteredAt: Date | null = firstRow?.first_at ? new Date(firstRow.first_at) : null;
  const cfg = resolveWindow(windowKey, firstRegisteredAt);

  const r: any = await db.execute(
    drizzleSql.raw(`
    WITH window_rows AS (
      SELECT
        a.agent_id::text AS agent_id,
        a.name,
        COALESCE(a.category, 'other') AS category,
        COALESCE(s.tier, 'unrated') AS tier,
        COALESCE(a.registered_at, a.created_at) AS at,
        EXTRACT(EPOCH FROM (NOW() - COALESCE(a.registered_at, a.created_at))) AS sec_ago
      FROM agents a
      LEFT JOIN LATERAL (
        SELECT tier FROM rating_snapshots WHERE agent_id = a.agent_id AND view = 'PIT'
        ORDER BY computed_at DESC LIMIT 1
      ) s ON true
      WHERE a.chain_id = 'arc'
        AND a.registered_at_block > 0
        ${cfg.whereClause}
    ),
    capped AS (
      SELECT *,
        ROW_NUMBER() OVER (PARTITION BY category ORDER BY at DESC) AS rn
      FROM window_rows
    )
    SELECT agent_id, name, category, tier, at, sec_ago FROM capped WHERE rn <= ${cfg.capPerLane}
    ORDER BY at DESC;
  `),
  );
  const rows = ((r.rows ?? r) as Array<any>).map((row) => ({
    agent_id: row.agent_id as string,
    name: (row.name as string) ?? null,
    category: row.category as string,
    tier: (TIER_TO_SHORT[row.tier as string] ?? 'unr') as PulseTier,
    at: row.at ? new Date(row.at) : null,
    secAgo: Number(row.sec_ago ?? 0),
  }));

  // Per-category totals (uncapped) for the right-edge counts.
  const totalsRaw: any = await db.execute(
    drizzleSql.raw(`
    SELECT COALESCE(category, 'other') AS category, COUNT(*)::int AS cnt
    FROM agents a
    WHERE chain_id = 'arc' AND registered_at_block > 0
      ${cfg.whereClause}
    GROUP BY COALESCE(category, 'other');
  `),
  );
  const totalByCat = new Map<string, number>();
  for (const row of (totalsRaw.rows ?? totalsRaw) as Array<any>) {
    totalByCat.set(row.category, row.cnt);
  }

  // Group dots by category
  const byCat = new Map<string, PulseDot[]>();
  for (const r of rows) {
    if (!byCat.has(r.category)) byCat.set(r.category, []);
    byCat.get(r.category)!.push({
      t: Math.max(0, Math.min(1, 1 - (r.secAgo * 1000) / cfg.windowMs)),
      tier: r.tier,
      agent_id: r.agent_id,
      name: r.name,
    });
  }

  // Build lanes, sorted by total count desc, but keep 'other' visible even if smaller.
  const lanes: PulseLane[] = Array.from(totalByCat.entries())
    .map(([label, total]) => ({
      label,
      total,
      dots: byCat.get(label) ?? [],
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 7);

  const totalCount = Array.from(totalByCat.values()).reduce((a, b) => a + b, 0);
  const latestAt = rows[0]?.at ?? null;

  // Most recent 4 across all lanes — render in the pulse foot.
  const recent = rows.slice(0, 4).map((r) => ({
    agent_id: r.agent_id,
    name: r.name,
    category: r.category,
    at: r.at,
    tier: r.tier,
  }));

  return {
    lanes,
    windowMs: cfg.windowMs,
    windowLabel: cfg.label,
    totalCount,
    latestAt,
    recent,
    windowKey,
    axisLabels: cfg.axisLabels,
  };
}

async function loadTopByTier(tier: 'Gold' | 'Silver' | 'Bronze', limit: number) {
  // Testnet calibration: relaxed filters so all tier-qualifying agents render,
  // not just high/moderate-confidence ones with names. Most testnet agents
  // arrive without metadata fetched yet (name=NULL) and have low job counts
  // (confidence=insufficient). Production calibration will tighten this back.
  // Each card surfaces its confidence label so users see the signal strength.
  const r: any = await db.execute(
    drizzleSql.raw(`
    SELECT
      a.agent_id::text AS agent_id,
      a.name,
      a.category,
      LEFT(COALESCE(a.metadata->>'description', ''), 140) AS description,
      a.jobs_completed,
      s.confidence,
      s.interaction_count
    FROM agents a
    INNER JOIN LATERAL (
      SELECT tier, confidence, interaction_count
      FROM rating_snapshots
      WHERE agent_id = a.agent_id AND view = 'PIT'
      ORDER BY computed_at DESC LIMIT 1
    ) s ON true
    WHERE a.chain_id = 'arc'
      AND s.tier = '${tier}'
    ORDER BY
      CASE s.confidence WHEN 'high' THEN 0 WHEN 'moderate' THEN 1 WHEN 'low' THEN 2 ELSE 3 END,
      s.interaction_count DESC NULLS LAST,
      a.jobs_completed DESC NULLS LAST
    LIMIT ${limit};
  `),
  );
  return (r.rows ?? r) as Array<any>;
}

interface TopRatedRow {
  agent_id: string;
  name: string;
  category: string | null;
  tier: string;
  confidence: string;
  interaction_count: number | null;
  jobs_completed: number | null;
}

async function loadTopRated(limit = 10): Promise<TopRatedRow[]> {
  const r: any = await db.execute(
    drizzleSql.raw(`
    SELECT
      a.agent_id::text AS agent_id,
      a.name,
      a.category,
      a.jobs_completed,
      s.tier,
      s.confidence,
      s.interaction_count
    FROM agents a
    INNER JOIN LATERAL (
      SELECT tier, confidence, interaction_count
      FROM rating_snapshots
      WHERE agent_id = a.agent_id AND view = 'PIT'
      ORDER BY computed_at DESC LIMIT 1
    ) s ON true
    WHERE a.name IS NOT NULL
      AND s.confidence IN ('high', 'moderate')
      AND s.tier IN ('Gold', 'Silver', 'Bronze')
    ORDER BY
      CASE s.tier
        WHEN 'Gold' THEN 0
        WHEN 'Silver' THEN 1
        WHEN 'Bronze' THEN 2
        ELSE 9
      END,
      s.interaction_count DESC NULLS LAST,
      a.jobs_completed DESC NULLS LAST
    LIMIT ${limit};
  `),
  );
  return (r.rows ?? r) as TopRatedRow[];
}

function relativeTime(d: Date | null): string {
  if (!d) return '—';
  const ms = Date.now() - d.getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString();
}

async function searchAgents(q: string, category?: string) {
  const embedding = await embedText(q);
  const vec = toVectorLiteral(embedding);
  const categoryClause =
    category && VISIBLE_CATEGORIES.find((c) => c.slug === category)
      ? `AND a.category = '${category.replace(/'/g, "''")}'`
      : '';
  const r: any = await db.execute(drizzleSql.raw(`
    WITH ranked AS (
      SELECT
        a.agent_id::text AS agent_id,
        a.name,
        a.category,
        a.jobs_completed,
        LEFT(a.metadata->>'description', 200) AS description,
        1 - (a.embedding <=> '${vec}'::vector) AS similarity,
        CONCAT(a.name, '|', LEFT(COALESCE(a.metadata->>'description',''), 200)) AS cluster_key,
        s.tier
      FROM agents a
      LEFT JOIN LATERAL (
        SELECT tier FROM rating_snapshots WHERE agent_id = a.agent_id AND view = 'PIT'
        ORDER BY computed_at DESC LIMIT 1
      ) s ON true
      WHERE a.embedding IS NOT NULL AND a.name IS NOT NULL
        ${categoryClause}
      ORDER BY a.embedding <=> '${vec}'::vector ASC
      LIMIT 120
    ),
    deduped AS (
      SELECT *,
        ROW_NUMBER() OVER (
          PARTITION BY cluster_key
          ORDER BY
            CASE tier
              WHEN 'Gold' THEN 0 WHEN 'Silver' THEN 1 WHEN 'Bronze' THEN 2
              WHEN 'Pending' THEN 3 WHEN 'Watch' THEN 4 WHEN 'Dormant' THEN 5 ELSE 9
            END,
            jobs_completed DESC NULLS LAST
        ) AS rep_rank,
        COUNT(*) OVER (PARTITION BY cluster_key) AS cluster_size
      FROM ranked
    )
    SELECT * FROM deduped WHERE rep_rank = 1
    ORDER BY similarity DESC
    LIMIT 24;
  `));
  return (r.rows ?? r) as Array<any>;
}

export default async function DiscoverPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string; pulse?: string }>;
}) {
  const { q, category, pulse } = await searchParams;
  const pulseWindow: PulseWindow =
    pulse === '7d' || pulse === 'all' ? pulse : '30d';

  return (
    <main className="mx-auto max-w-4xl px-4 sm:px-5 py-10 sm:py-14 space-y-10">
      <section className="space-y-4">
        <nav className="font-mono text-[11px] text-[var(--color-mute)]">
          <Link href="/" className="hover:text-[var(--color-copper)]">caliber</Link>
          <span className="mx-2 opacity-50">/</span>
          <span>discover</span>
        </nav>
        <h1 className="text-3xl sm:text-5xl font-semibold text-[var(--color-ink)] tracking-tight leading-tight">
          Find rated agents for your task.
        </h1>
        <p className="text-[15px] sm:text-base text-[var(--color-ink)] leading-relaxed max-w-prose">
          Browse Caliber-rated agents on Arc by what they do. Or describe what you need in plain
          language — we match against every agent&rsquo;s published description. Click any card to
          see the agent&rsquo;s Caliber Passport: tier, score, history, and a signed attestation
          you can verify on-chain.
        </p>
        <Suspense fallback={null}>
          <SearchBox initialValue={q ?? ''} />
        </Suspense>
      </section>

      {q ? (
        <Suspense fallback={<p className="text-[var(--color-mute)] font-mono text-sm">searching…</p>}>
          <SearchResults q={q} category={category} />
        </Suspense>
      ) : (
        <>
          <Suspense fallback={null}>
            <LivePulse window={pulseWindow} />
          </Suspense>
          <CategoriesGridV2 />
          <Suspense fallback={null}>
            <TopRatedGrouped />
          </Suspense>
          <RegistryCTA />
        </>
      )}
    </main>
  );
}

// =========================================================================
// cd-* designed sections — categories / top_rated / registry
// =========================================================================

const CATEGORY_DESCRIPTIONS: Record<string, string> = {
  trading: 'Agents that trade tokens, run market-making strategies, or operate on prediction markets like Polymarket.',
  payments: 'Agents that move USDC, route payments, settle x402 invoices, and execute stablecoin-denominated jobs.',
  validation: 'Agents that judge other agents — quality scoring, contract auditing, x402-protected validation endpoints.',
  research: 'Agents that gather data, run analyses, produce reports, or monitor on-chain activity for insight.',
  utility: 'Agents that move information around — read documents, send notifications, orchestrate other agents.',
  assistants: 'Co-pilot agents that help users act on-chain — swaps, pools, onboarding, reputation.',
  services: 'Standalone agent products — virtual pet managers, memecoin deployers, niche utility bots.',
  content: 'Agents that write — tweets, threads, posts, copy, community engagement.',
};

function catSizeForRank(rank: number, total: number): 'xl' | 'lg' | 'md' | 'sm' {
  if (rank < 2) return 'xl';
  if (rank === 2) return 'lg';
  if (rank < 5) return 'md';
  return 'sm';
}

async function loadCategoryCardsRich() {
  const r: any = await db.execute(drizzleSql.raw(`
    WITH counts AS (
      SELECT
        a.category,
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE s.tier = 'Gold')::int AS est,
        COUNT(*) FILTER (WHERE s.tier = 'Silver')::int AS pro,
        COUNT(*) FILTER (WHERE s.tier = 'Bronze')::int AS emg
      FROM agents a
      LEFT JOIN LATERAL (
        SELECT tier FROM rating_snapshots WHERE agent_id = a.agent_id AND view = 'PIT'
        ORDER BY computed_at DESC LIMIT 1
      ) s ON true
      WHERE a.chain_id = 'arc' AND a.category IS NOT NULL
      GROUP BY a.category
    ),
    top_per_cat AS (
      SELECT
        a.category,
        a.agent_id::text AS agent_id,
        a.name,
        s.tier,
        ROW_NUMBER() OVER (
          PARTITION BY a.category, CONCAT(a.name, '|', LEFT(COALESCE(a.metadata->>'description',''), 200))
          ORDER BY
            CASE s.tier WHEN 'Gold' THEN 0 WHEN 'Silver' THEN 1 WHEN 'Bronze' THEN 2 ELSE 9 END,
            a.jobs_completed DESC NULLS LAST
        ) AS rep_rank
      FROM agents a
      LEFT JOIN LATERAL (
        SELECT tier FROM rating_snapshots WHERE agent_id = a.agent_id AND view = 'PIT'
        ORDER BY computed_at DESC LIMIT 1
      ) s ON true
      WHERE a.chain_id = 'arc' AND a.category IS NOT NULL AND a.name IS NOT NULL
    ),
    reps AS (
      SELECT *,
        ROW_NUMBER() OVER (
          PARTITION BY category
          ORDER BY CASE tier WHEN 'Gold' THEN 0 WHEN 'Silver' THEN 1 WHEN 'Bronze' THEN 2 ELSE 9 END
        ) AS rk
      FROM top_per_cat WHERE rep_rank = 1
    )
    SELECT c.category, c.total, c.est, c.pro, c.emg,
      COALESCE(json_agg(json_build_object('agent_id', r.agent_id, 'name', r.name, 'tier', r.tier) ORDER BY r.rk) FILTER (WHERE r.rk <= 3), '[]'::json) AS top
    FROM counts c
    LEFT JOIN reps r ON r.category = c.category AND r.rk <= 3
    GROUP BY c.category, c.total, c.est, c.pro, c.emg
    ORDER BY c.total DESC;
  `));
  return ((r.rows ?? r) as Array<any>).map((row) => ({
    category: row.category as string,
    total: Number(row.total ?? 0),
    est: Number(row.est ?? 0),
    pro: Number(row.pro ?? 0),
    emg: Number(row.emg ?? 0),
    top: (row.top ?? []) as Array<{ agent_id: string; name: string; tier: string | null }>,
  }));
}

async function CategoriesGridV2() {
  const cats = await loadCategoryCardsRich();
  if (cats.length === 0) return null;
  const meta = new Map<string, (typeof VISIBLE_CATEGORIES)[number]>(
    VISIBLE_CATEGORIES.map((c) => [c.slug as string, c]),
  );

  return (
    <section className="cd-section" id="browse">
      <header className="cd-section__head">
        <h2 className="cd-section__title">//browse_by_category</h2>
        <span className="cd-section__sub">
          {cats.length} lanes · {cats.reduce((s, c) => s + c.total, 0).toLocaleString()} agents · F2 classifier
        </span>
      </header>

      <div className="cd-cats cd-cats--weighted">
        {cats.map((c, i) => {
          const size = catSizeForRank(i, cats.length);
          const verbose = size === 'xl' || size === 'lg';
          const m = meta.get(c.category);
          const title = m?.title ?? c.category;
          const desc = CATEGORY_DESCRIPTIONS[c.category] ?? m?.blurb ?? '';
          const rated = c.est + c.pro + c.emg || 1;
          return (
            <Link
              key={c.category}
              href={`/discover/category/${c.category}`}
              className={`cd-cat cd-cat--${size}`}
            >
              <div className="cd-cat__head">
                <h3 className="cd-cat__name">{title}</h3>
                <span className="cd-cat__count">
                  <strong>{c.total.toLocaleString()}</strong> agents
                </span>
              </div>

              <p className="cd-cat__desc">{desc}</p>

              <div>
                <div className="cd-tierbar" aria-hidden="true">
                  <span className="cd-tierbar__seg--est" style={{ width: `${(c.est / rated) * 100}%` }} />
                  <span className="cd-tierbar__seg--pro" style={{ width: `${(c.pro / rated) * 100}%` }} />
                  <span className="cd-tierbar__seg--emg" style={{ width: `${(c.emg / rated) * 100}%` }} />
                </div>
                <div className="cd-cat__breakdown">
                  <span><i className="est" />{c.est} Gold</span>
                  <span><i className="pro" />{c.pro} Silver</span>
                  <span><i className="emg" />{c.emg} Bronze</span>
                </div>
              </div>

              <div className="cd-cat__foot">
                {!verbose && c.top.length > 0 && (
                  <div className="cd-cat__top">
                    <b>top</b>
                    {c.top.map((t) => t.name).join(' · ')}
                  </div>
                )}
                {verbose && (
                  <span className="cd-link" style={{ fontSize: 12 }}>
                    browse {c.total.toLocaleString()} {title.toLowerCase()} agents
                  </span>
                )}
                <span className="cd-cat__arrow">→</span>
              </div>
            </Link>
          );
        })}
      </div>

      <p className="cd-section__note">
        // counts show every classified agent on Arc Testnet (deduped is happening at search-time, not here). Categories drawn from agent descriptions via the F2 classifier.
      </p>
    </section>
  );
}

function tierShort(tier: string): 'est' | 'pro' | 'emg' {
  if (tier === 'Gold') return 'est';
  if (tier === 'Silver') return 'pro';
  return 'emg';
}

function AgentCardV2({ a, tier }: { a: any; tier: 'est' | 'pro' | 'emg' }) {
  return (
    <Link href={`/passport/arc/${a.agent_id}`} className={`cd-agent cd-agent--${tier}`}>
      <div className="cd-agent__top">
        <h4 className="cd-agent__name">{a.name ?? `Agent #${a.agent_id}`}</h4>
        <span className="cd-agent__id">#{a.agent_id}</span>
      </div>
      {a.description && a.description.trim() && (
        <p className="cd-agent__desc">{a.description}</p>
      )}
      <div className="cd-agent__meta">
        {a.category && <span className="cd-badge cd-badge--cat">{a.category}</span>}
        <span><b>{Number(a.jobs_completed ?? 0).toLocaleString()}</b>jobs</span>
        <span><b>{Number(a.interaction_count ?? 0).toLocaleString()}</b>interactions</span>
        <span>{a.confidence} conf.</span>
      </div>
    </Link>
  );
}

async function TopRatedGrouped() {
  const [est, pro, emg] = await Promise.all([
    loadTopByTier('Gold', 4),
    loadTopByTier('Silver', 4),
    loadTopByTier('Bronze', 4),
  ]);
  if (est.length === 0 && pro.length === 0 && emg.length === 0) return null;

  // Count agents that would qualify under production thresholds (score ≥80,
  // jobs ≥50) — used in the honesty banner to show the gap between testnet
  // calibration and the production methodology.
  const productionGoldRaw: any = await db.execute(drizzleSql.raw(`
    SELECT COUNT(*)::int AS n
    FROM agents a
    INNER JOIN LATERAL (
      SELECT tier FROM rating_snapshots WHERE agent_id = a.agent_id AND view = 'PIT'
      ORDER BY computed_at DESC LIMIT 1
    ) s ON true
    WHERE a.chain_id = 'arc' AND s.tier = 'Gold' AND a.jobs_completed >= 50;
  `));
  const productionGold = Number((productionGoldRaw.rows ?? productionGoldRaw)[0]?.n ?? 0);

  return (
    <section className="cd-section" id="top">
      <header className="cd-section__head">
        <h2 className="cd-section__title">//top_rated · this week</h2>
        <span className="cd-section__sub">
          ranked by sentinel interactions, then jobs · moderate+ confidence
        </span>
      </header>

      {/* Honest calibration banner — explains why the testnet thresholds are
          relaxed and what the production methodology actually requires. */}
      <div
        style={{
          border: '1px solid var(--hairline)',
          borderLeft: '3px solid var(--copper)',
          background: 'var(--bg-elevated)',
          borderRadius: 4,
          padding: '14px 18px',
          marginBottom: 24,
          fontSize: 13,
          lineHeight: 1.55,
          color: 'var(--ink)',
        }}
      >
        <p style={{ margin: 0 }}>
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              color: 'var(--copper)',
              display: 'block',
              marginBottom: 4,
            }}
          >
            //calibration_note
          </span>
          Only <strong>{productionGold} agent{productionGold === 1 ? '' : 's'}</strong>{' '}
          currently meet{productionGold === 1 ? 's' : ''} the production Gold bar (score ≥80, 50+ completed jobs).
          Caliber&rsquo;s tier system is honest about testnet&rsquo;s youth — the methodology is
          calibrated for production volume, and the data simply doesn&rsquo;t support more Gold
          ratings yet. As real economic activity accumulates, the cohort grows. Today&rsquo;s tier
          display uses interim testnet thresholds (jobs ≥2 for Gold/Silver, ≥1 for Bronze) so the
          system is demonstrably operational from day one. See{' '}
          <Link
            href="/methodology#3-rating-scale"
            style={{
              color: 'var(--copper)',
              textDecoration: 'underline',
              textDecorationColor: 'var(--copper)',
            }}
          >
            methodology §3
          </Link>{' '}
          for the full schedule.
        </p>
      </div>

      <div className="cd-top--grouped">
        <div className="cd-tier">
          <header className="cd-tier__head">
            <h3 className="cd-tier__name">Gold</h3>
            <span className="cd-tier__count">{est.length} shown</span>
          </header>
          {est.length === 0 ? (
            <p className="cd-mono cd-mute" style={{ fontSize: 12 }}>
              no agents in this tier yet
            </p>
          ) : (
            est.map((a) => <AgentCardV2 key={a.agent_id} a={a} tier="est" />)
          )}
        </div>

        <div className="cd-tier">
          <header className="cd-tier__head cd-tier__head--proven">
            <h3 className="cd-tier__name cd-tier__name--proven">Silver</h3>
            <span className="cd-tier__count">{pro.length} shown</span>
          </header>
          {pro.length === 0 ? (
            <p className="cd-mono cd-mute" style={{ fontSize: 12 }}>
              no agents in this tier yet
            </p>
          ) : (
            pro.map((a) => <AgentCardV2 key={a.agent_id} a={a} tier="pro" />)
          )}
        </div>

        <div className="cd-tier">
          <header className="cd-tier__head cd-tier__head--emerging">
            <h3 className="cd-tier__name">Bronze</h3>
            <span className="cd-tier__count">{emg.length} shown</span>
          </header>
          {emg.length === 0 ? (
            <p className="cd-mono cd-mute" style={{ fontSize: 12 }}>
              no agents in this tier yet
            </p>
          ) : (
            emg.map((a) => <AgentCardV2 key={a.agent_id} a={a} tier="emg" />)
          )}
        </div>
      </div>

      <p className="cd-section__note">
        // tier hierarchy: Gold (sentinel pass) → Silver (sustained activity) → Bronze (rated, still accruing). Outline weight = strength of evidence.
      </p>
    </section>
  );
}

function RegistryCTA() {
  return (
    <section className="cd-section" id="registry">
      <header className="cd-section__head">
        <h2 className="cd-section__title">//browse_full_registry</h2>
        <span className="cd-section__sub">unrated agents · raw ERC-8004</span>
      </header>
      <Link href="/agents" className="cd-registry">
        <span className="cd-registry__icon" aria-hidden="true">⌗</span>
        <div className="cd-registry__body">
          <h3>All agents — raw ERC-8004 registry</h3>
          <p>
            Every on-chain registration, unfiltered. Filter by tier (Gold → Dormant),
            search by name / address / agent id, toggle &ldquo;rated only&rdquo;.
            ~88% of Arc Testnet agents ship without fetchable metadata — useful when you&rsquo;re
            hunting a specific id or doing taxonomy work.
          </p>
        </div>
        <span className="cd-btn cd-btn--primary cd-btn--lg">
          open /agents <span aria-hidden="true">→</span>
        </span>
      </Link>
    </section>
  );
}

const TIER_PILL: Record<string, string> = {
  Gold:    'text-[#B8862B] bg-[#B8862B]/12 border-[#B8862B]/45',
  Silver:  'text-[#7E8690] bg-[#7E8690]/12 border-[#7E8690]/45',
  Bronze:  'text-[#8C5A2C] bg-[#8C5A2C]/12 border-[#8C5A2C]/45',
  Pending: 'text-[#98948C] bg-[#98948C]/12 border-[#98948C]/45',
  Watch:   'text-[#B45309] bg-[#B45309]/12 border-[#B45309]/45',
  Dormant: 'text-[#A8A39A] bg-[#A8A39A]/12 border-[#A8A39A]/45',
};

// Lane color per category. "other" + uncategorized fall back to mute.
const CATEGORY_COLOR: Record<string, { bar: string; dot: string; text: string }> = {
  Trading: { bar: 'bg-[#0EA5E9]/15', dot: 'bg-[#0EA5E9]', text: 'text-[#075985]' },
  Validation: { bar: 'bg-[#14B8A6]/15', dot: 'bg-[#14B8A6]', text: 'text-[#0F766E]' },
  Research: { bar: 'bg-[#A855F7]/15', dot: 'bg-[#A855F7]', text: 'text-[#6B21A8]' },
  Payments: { bar: 'bg-[#F59E0B]/15', dot: 'bg-[#F59E0B]', text: 'text-[#B45309]' },
  Utility: { bar: 'bg-[#EC4899]/15', dot: 'bg-[#EC4899]', text: 'text-[#9D174D]' },
  Assistants: { bar: 'bg-[#22C55E]/15', dot: 'bg-[#22C55E]', text: 'text-[#15803D]' },
  Services: { bar: 'bg-[#6366F1]/15', dot: 'bg-[#6366F1]', text: 'text-[#3730A3]' },
  Content: { bar: 'bg-[#F43F5E]/15', dot: 'bg-[#F43F5E]', text: 'text-[#9F1239]' },
  other: { bar: 'bg-[#94A3B8]/15', dot: 'bg-[#94A3B8]', text: 'text-[#475569]' },
};

function categoryStyle(c: string | null) {
  return CATEGORY_COLOR[c ?? 'other'] ?? CATEGORY_COLOR.other;
}

// --- new cd-* designed components (per design handoff) ----------------------

async function LivePulse({ window: pulseWindow }: { window: PulseWindow }) {
  const data = await loadPulseData(pulseWindow);
  if (data.lanes.length === 0) return null;

  const WINDOW_OPTIONS: Array<{ key: PulseWindow; label: string }> = [
    { key: '7d', label: '7D' },
    { key: '30d', label: '1M' },
    { key: 'all', label: 'all' },
  ];

  return (
    <section className="cd-pulse" aria-label={`${data.windowLabel} new agent registrations`}>
      <header className="cd-pulse__head">
        <span className="cd-pulse__title">
          <span className="cd-pulse__dot" aria-hidden="true" />
          //live_pulse · {data.windowLabel} registrations
        </span>
        <span className="cd-pulse__meta">
          {/* Window selector tabs */}
          <span style={{ display: 'inline-flex', gap: 2, alignItems: 'center' }}>
            {WINDOW_OPTIONS.map((opt) => {
              const active = opt.key === data.windowKey;
              return (
                <Link
                  key={opt.key}
                  href={`/discover?pulse=${opt.key}`}
                  scroll={false}
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 11,
                    padding: '3px 8px',
                    borderRadius: 2,
                    textDecoration: 'none',
                    border: '1px solid',
                    borderColor: active ? 'var(--ink)' : 'transparent',
                    background: active ? 'var(--ink)' : 'transparent',
                    color: active ? 'var(--paper)' : 'var(--mute)',
                    letterSpacing: '0.04em',
                    textTransform: 'uppercase',
                  }}
                >
                  {opt.label}
                </Link>
              );
            })}
          </span>
          <span className="cd-pulse__legend" aria-hidden="true">
            <span className="cd-pulse__legend-dot cd-pulse__legend-dot--est" />Gold
            <span className="cd-pulse__legend-dot cd-pulse__legend-dot--pro" />Silver
            <span className="cd-pulse__legend-dot cd-pulse__legend-dot--emg" />Bronze
            <span className="cd-pulse__legend-dot cd-pulse__legend-dot--unr" />unrated
          </span>
          <span>
            {data.totalCount.toLocaleString()} total · last{' '}
            {data.latestAt ? relativeTime(data.latestAt) : '—'} · indexer current
          </span>
        </span>
      </header>

      <div
        className="cd-pulse__timeline"
        role="img"
        aria-label={`${data.totalCount} registrations across ${data.lanes.length} categories over the last ${data.windowLabel}`}
      >
        {data.lanes.map((lane) => (
          <div key={lane.label} className="cd-pulse__lane">
            <span className="cd-pulse__lane-label">{lane.label}</span>
            <div className="cd-pulse__lane-track">
              {lane.dots.map((d, i) => (
                <Link
                  key={`${lane.label}-${i}`}
                  href={`/passport/arc/${d.agent_id}`}
                  title={`${d.name ?? `Agent #${d.agent_id}`} · #${d.agent_id} · ${lane.label} · ${d.tier === 'unr' ? 'unrated' : d.tier === 'est' ? 'Gold' : d.tier === 'pro' ? 'Silver' : 'Bronze'}`}
                  className={`cd-pulse__lane-dot cd-pulse__lane-dot--${d.tier}`}
                  style={{ left: `${d.t * 100}%` }}
                  aria-hidden="true"
                />
              ))}
            </div>
            <span className="cd-pulse__lane-count">{lane.total.toLocaleString()}</span>
          </div>
        ))}
        <div className="cd-pulse__axis" aria-hidden="true">
          {data.axisLabels.map((label, i) => (
            <span
              key={i}
              className="cd-pulse__axis-label"
              style={{ left: `${(i / (data.axisLabels.length - 1)) * 100}%` }}
            >
              {label}
            </span>
          ))}
        </div>
      </div>

      <footer className="cd-pulse__foot">
        <span className="cd-pulse__foot-label">most recent</span>
        <ul className="cd-pulse__recent">
          {data.recent.map((r) => (
            <li key={r.agent_id}>
              <Link href={`/passport/arc/${r.agent_id}`} className="cd-pulse__recent-item">
                <span className="cd-pulse__recent-when">{r.at ? relativeTime(r.at) : '—'}</span>
                <span className="cd-pulse__recent-id">#{r.agent_id}</span>
                <span className="cd-pulse__recent-name">
                  {r.name ?? `Agent #${r.agent_id}`}
                </span>
                <span className="cd-pulse__recent-status">
                  {r.category} · {r.tier === 'unr' ? 'unrated · awaiting first snapshot' : `tier ${r.tier === 'est' ? 'Gold' : r.tier === 'pro' ? 'Silver' : 'Bronze'}`}
                </span>
              </Link>
            </li>
          ))}
        </ul>
        <Link href="/agents" className="cd-link">
          see all {data.totalCount.toLocaleString()} →
        </Link>
      </footer>
    </section>
  );
}

async function RecentlyRegistered() {
  const rows = await loadRecentAgents(24);
  if (rows.length === 0) return null;

  const newest = rows[0]?.registered_at;
  const oldest = rows[rows.length - 1]?.registered_at;
  const newestAgo = newest ? relativeTime(newest) : '—';
  const spanMs = newest && oldest ? newest.getTime() - oldest.getTime() : 1;

  // Group by category, preserving display order: most-populated category first.
  const byCategory: Record<string, typeof rows> = {};
  for (const r of rows) {
    const c = r.category ?? 'other';
    if (!byCategory[c]) byCategory[c] = [];
    byCategory[c].push(r);
  }
  const lanes = Object.entries(byCategory).sort((a, b) => b[1].length - a[1].length);

  // Total count per category for the legend at the bottom.
  const legend = lanes.map(([c, items]) => ({ category: c, count: items.length }));

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h2 className="font-mono text-[13px] text-[var(--color-ink)] tracking-[0.02em]">
          //registration_timeline
        </h2>
        <span className="font-mono text-[10px] text-[var(--color-mute)]">
          last new agent {newestAgo} · indexer current · refreshes on every load
        </span>
      </div>

      {/* Swimlane chart — one lane per category, agents positioned by registration time */}
      <div className="border border-[var(--color-hairline)] bg-white rounded-[2px] p-3 sm:p-4">
        <div className="space-y-2">
          {lanes.map(([cat, items]) => {
            const sty = categoryStyle(cat);
            return (
              <div key={cat} className="flex items-center gap-2">
                <span
                  className={`font-mono text-[10px] uppercase tracking-[0.04em] w-20 sm:w-24 shrink-0 text-right ${sty.text}`}
                >
                  {cat}
                </span>
                <div className={`relative flex-1 h-7 rounded-[2px] ${sty.bar}`}>
                  {items.map((r, i) => {
                    const t = r.registered_at?.getTime() ?? 0;
                    const oldestMs = oldest?.getTime() ?? t;
                    const pct = spanMs > 0 ? ((t - oldestMs) / spanMs) * 96 + 2 : 50;
                    return (
                      <Link
                        key={r.agent_id}
                        href={`/passport/arc/${r.agent_id}`}
                        title={`${r.name ?? `Agent #${r.agent_id}`} · #${r.agent_id} · ${cat} · ${relativeTime(r.registered_at)}${r.tier ? ` · ${r.tier}` : ''}`}
                        style={{
                          left: `${pct}%`,
                          top: `${4 + (i % 3) * 6}px`,
                        }}
                        className={`absolute -translate-x-1/2 w-2.5 h-2.5 rounded-full ${sty.dot} border border-white hover:scale-150 hover:z-10 transition cursor-pointer`}
                      />
                    );
                  })}
                </div>
                <span className="font-mono text-[10px] text-[var(--color-mute)] w-6 shrink-0">
                  {items.length}
                </span>
              </div>
            );
          })}
        </div>

        {/* Time axis */}
        <div className="flex items-center gap-2 mt-3 pt-2 border-t border-[var(--color-hairline)]">
          <span className="w-20 sm:w-24 shrink-0" />
          <div className="flex-1 flex justify-between font-mono text-[9px] text-[var(--color-mute)]">
            <span>{oldest ? relativeTime(oldest) : '—'}</span>
            <span className="opacity-50">←  registration time  →</span>
            <span>{newest ? relativeTime(newest) : '—'}</span>
          </div>
          <span className="w-6 shrink-0" />
        </div>
      </div>

      {/* Compact legend with names of the most recent few per category for context */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
        {legend.map(({ category, count }) => {
          const sty = categoryStyle(category);
          return (
            <div key={category} className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${sty.dot}`} />
              <span className="font-mono text-[var(--color-mute)]">
                {category} ({count})
              </span>
            </div>
          );
        })}
      </div>

      <p className="font-mono text-[10px] text-[var(--color-mute)] leading-snug">
        // each dot is one ERC-8004 registration; hover for name + tier, click to open passport.
        Lanes group by category (Caliber F2 classifier). Tier is the latest Sentinel snapshot
        (refreshes daily 04:00 UTC).
      </p>
    </section>
  );
}

async function TopRated() {
  const rows = await loadTopRated(10);
  if (rows.length === 0) return null;

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h2 className="font-mono text-[13px] text-[var(--color-ink)] tracking-[0.02em]">
          //top_rated · highest tier × most active
        </h2>
        <span className="font-mono text-[10px] text-[var(--color-mute)]">
          {rows.length} agents · moderate+ confidence
        </span>
      </div>
      <ol className="border border-[var(--color-hairline)] bg-white rounded-[2px] divide-y divide-[var(--color-hairline)]">
        {rows.map((r, i) => {
          const sty = categoryStyle(r.category);
          return (
            <li
              key={r.agent_id}
              className="flex items-center gap-3 px-3 py-2.5 hover:bg-[var(--color-bg-elev)] transition"
            >
              <span className="font-mono text-[11px] w-6 shrink-0 text-[var(--color-mute)] text-right">
                {i + 1}.
              </span>
              <Link
                href={`/passport/arc/${r.agent_id}`}
                className="flex-1 min-w-0 group"
              >
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="text-sm font-medium text-[var(--color-ink)] group-hover:text-[var(--color-copper)] truncate">
                    {r.name}
                  </span>
                  <span className="font-mono text-[10px] text-[var(--color-mute)] shrink-0">
                    #{r.agent_id}
                  </span>
                </div>
                <div className="font-mono text-[10px] text-[var(--color-mute)] mt-0.5">
                  {r.jobs_completed ?? 0} jobs · {r.interaction_count ?? 0} interactions ·{' '}
                  {r.confidence} confidence
                </div>
              </Link>
              {r.category && (
                <span
                  className={`font-mono text-[9px] uppercase tracking-[0.04em] px-1.5 py-0.5 rounded-[2px] border border-[var(--color-hairline)] shrink-0 hidden sm:inline-block ${sty.text} ${sty.bar}`}
                >
                  {r.category}
                </span>
              )}
              <span
                className={
                  'shrink-0 font-mono text-[10px] uppercase tracking-[0.04em] px-1.5 py-0.5 rounded-[2px] border ' +
                  (TIER_PILL[r.tier] ?? TIER_PILL.Pending)
                }
              >
                {r.tier}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="font-mono text-[10px] text-[var(--color-mute)] leading-snug">
        // ranked by tier first (Gold → Silver → Bronze), then by Sentinel interaction
        count, then by job completion. Filtered to moderate+ confidence so the ordering is
        statistically meaningful.
      </p>
    </section>
  );
}

function FullRegistryLink() {
  return (
    <section className="space-y-3">
      <h2 className="font-mono text-[13px] text-[var(--color-ink)] tracking-[0.02em]">
        //browse_full_registry
      </h2>
      <Link
        href="/agents"
        className="block border border-[var(--color-hairline)] bg-white rounded-[2px] p-4 hover:border-[var(--color-ink)] hover:bg-[var(--color-bg-elev)] transition group"
      >
        <div className="flex items-baseline justify-between gap-3 mb-1">
          <h3 className="font-medium text-[var(--color-ink)]">
            All Agents — raw ERC-8004 registry
          </h3>
          <span className="font-mono text-xs text-[var(--color-copper)] group-hover:underline">
            open /agents →
          </span>
        </div>
        <p className="text-sm text-[var(--color-mute)] leading-snug">
          Every on-chain registration, unfiltered. Filter by tier (Gold → Dormant),
          search by name / address / agent id, toggle &ldquo;rated only&rdquo;.
          ~88% of Arc Testnet agents ship without fetchable metadata — useful if you&rsquo;re
          looking for a specific id or doing taxonomy work.
        </p>
      </Link>
    </section>
  );
}

async function CategoriesGrid() {
  const cats = await loadCategoryCards();
  return (
    <section className="space-y-4">
      <h2 className="font-mono text-[13px] text-[var(--color-ink)] tracking-[0.02em]">
        //browse_by_category
      </h2>
      <div className="grid sm:grid-cols-2 gap-3">
        {cats.map((cat) => (
          <Link
            key={cat.slug}
            href={`/discover/category/${cat.slug}`}
            className="block border border-[var(--color-hairline)] bg-white rounded-[2px] p-4 hover:border-[var(--color-ink)] hover:bg-[var(--color-bg-elev)] transition"
          >
            <div className="flex items-baseline justify-between gap-3 mb-1">
              <h3 className="font-medium text-[var(--color-ink)]">{cat.title}</h3>
              <span className="font-mono text-xs text-[var(--color-mute)]">
                {cat.cluster_count > 0 ? `${cat.cluster_count} products` : '—'}
              </span>
            </div>
            <p className="text-sm text-[var(--color-mute)] leading-snug">{cat.blurb}</p>
            {cat.top.length > 0 && (
              <p className="font-mono text-[11px] text-[var(--color-mute)] mt-3 line-clamp-1">
                top: {cat.top.map((a) => a.name).filter(Boolean).join(' · ')}
              </p>
            )}
          </Link>
        ))}
      </div>
      <p className="font-mono text-[10px] text-[var(--color-mute)] leading-snug pt-2">
        // counts above show distinct products (deduped across bulk-deployed replicas).
        Categories drawn from agent descriptions; see{' '}
        <Link
          href="https://github.com/huicom/caliber/blob/main/docs/02-riskmodel/phase2-f2-taxonomy-proposal.md"
          target="_blank"
          rel="noreferrer"
          className="text-[var(--color-copper)] hover:underline"
        >
          taxonomy doc
        </Link>{' '}
        for the rules.
      </p>
    </section>
  );
}

async function SearchResults({ q, category }: { q: string; category?: string }) {
  const results = await searchAgents(q, category);

  return (
    <section className="space-y-4">
      <h2 className="font-mono text-[13px] text-[var(--color-ink)] tracking-[0.02em]">
        //matches for &ldquo;{q}&rdquo;
        {category && <span className="text-[var(--color-mute)]"> in {category}</span>}
      </h2>
      {results.length === 0 ? (
        <div className="border border-[var(--color-hairline)] bg-white rounded-[2px] p-5 text-sm text-[var(--color-ink)]">
          No agents matched. Try one of the category browses, or rephrase your query.
        </div>
      ) : (
        <div className="space-y-2">
          {results.map((r) => (
            <AgentCard
              key={r.agent_id}
              agentId={r.agent_id}
              name={r.name}
              description={r.description}
              tier={r.tier}
              jobsCompleted={r.jobs_completed}
              clusterSize={Number(r.cluster_size ?? 1)}
              category={r.category}
              similarity={Number(r.similarity ?? 0)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
