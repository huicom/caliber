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
              WHEN 'Established' THEN 0 WHEN 'Proven' THEN 1 WHEN 'Emerging' THEN 2
              WHEN 'Provisional' THEN 3 WHEN 'Watch' THEN 4 WHEN 'Inactive' THEN 5 ELSE 9
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
              WHEN 'Established' THEN 0 WHEN 'Proven' THEN 1 WHEN 'Emerging' THEN 2
              WHEN 'Provisional' THEN 3 WHEN 'Watch' THEN 4 WHEN 'Inactive' THEN 5 ELSE 9
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

async function loadRecentAgents(limit = 12): Promise<RecentAgentRow[]> {
  const r: any = await db.execute(
    drizzleSql.raw(`
    SELECT
      a.agent_id::text AS agent_id,
      a.name,
      a.category,
      a.registered_at,
      s.tier
    FROM agents a
    LEFT JOIN LATERAL (
      SELECT tier FROM rating_snapshots WHERE agent_id = a.agent_id AND view = 'PIT'
      ORDER BY computed_at DESC LIMIT 1
    ) s ON true
    WHERE a.name IS NOT NULL
    ORDER BY a.registered_at DESC NULLS LAST
    LIMIT ${limit};
  `),
  );
  return ((r.rows ?? r) as Array<any>).map((row) => ({
    ...row,
    registered_at: row.registered_at ? new Date(row.registered_at) : null,
  }));
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
              WHEN 'Established' THEN 0 WHEN 'Proven' THEN 1 WHEN 'Emerging' THEN 2
              WHEN 'Provisional' THEN 3 WHEN 'Watch' THEN 4 WHEN 'Inactive' THEN 5 ELSE 9
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
  searchParams: Promise<{ q?: string; category?: string }>;
}) {
  const { q, category } = await searchParams;

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
            <RecentlyRegistered />
          </Suspense>
          <CategoriesGrid />
          <FullRegistryLink />
        </>
      )}
    </main>
  );
}

const TIER_PILL: Record<string, string> = {
  Established: 'text-[#047857] bg-[#E6F7F2] border-[#00B894]/40',
  Proven: 'text-[#075985] bg-[#E0F2FE] border-[#0EA5E9]/40',
  Emerging: 'text-[#0F766E] bg-[#CCFBF1] border-[#14B8A6]/40',
  Provisional: 'text-[#475569] bg-[#F1F5F9] border-[#94A3B8]/40',
  Watch: 'text-[#B45309] bg-[#FEF3E2] border-[#F59E0B]/40',
  Inactive: 'text-[#111827] bg-[#E5E7EB] border-[#1F2937]/40',
};

async function RecentlyRegistered() {
  const rows = await loadRecentAgents(12);
  if (rows.length === 0) return null;
  const newestIso = rows[0]?.registered_at?.toISOString().slice(0, 16) ?? '';

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h2 className="font-mono text-[13px] text-[var(--color-ink)] tracking-[0.02em]">
          //recently_registered
        </h2>
        <span className="font-mono text-[10px] text-[var(--color-mute)]">
          latest indexed at {newestIso}Z · refreshes on every load
        </span>
      </div>
      <ul className="border border-[var(--color-hairline)] bg-white rounded-[2px] divide-y divide-[var(--color-hairline)]">
        {rows.map((r) => (
          <li
            key={r.agent_id}
            className="flex items-center gap-3 px-3 py-2 hover:bg-[var(--color-bg-elev)] transition"
          >
            <span className="font-mono text-[10px] w-16 shrink-0 text-[var(--color-mute)]">
              {relativeTime(r.registered_at)}
            </span>
            <Link
              href={`/passport/arc/${r.agent_id}`}
              className="flex-1 min-w-0 text-sm text-[var(--color-ink)] hover:text-[var(--color-copper)] truncate"
            >
              {r.name}
              <span className="font-mono text-[10px] text-[var(--color-mute)] ml-2">
                #{r.agent_id}
              </span>
            </Link>
            {r.category && (
              <span className="font-mono text-[9px] uppercase tracking-[0.04em] px-1.5 py-0.5 rounded-[2px] bg-[var(--color-bg-elev)] border border-[var(--color-hairline)] text-[var(--color-mute)] shrink-0 hidden sm:inline-block">
                {r.category}
              </span>
            )}
            <span
              className={
                'shrink-0 font-mono text-[10px] uppercase tracking-[0.04em] px-1.5 py-0.5 rounded-[2px] border ' +
                (r.tier ? TIER_PILL[r.tier] ?? TIER_PILL.Provisional : 'text-[var(--color-mute)] border-[var(--color-hairline)] bg-white')
              }
            >
              {r.tier ?? 'unrated'}
            </span>
          </li>
        ))}
      </ul>
      <p className="font-mono text-[10px] text-[var(--color-mute)] leading-snug">
        // newest ERC-8004 registrations the indexer has seen. Times are in UTC; tier is the
        latest Sentinel snapshot (refreshes daily 04:00 UTC).
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
          Every on-chain registration, unfiltered. Filter by tier (Established → Inactive),
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
          href="https://github.com/huicom/arc-agents-explorer/blob/main/docs/02-riskmodel/phase2-f2-taxonomy-proposal.md"
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
