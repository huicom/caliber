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
        <CategoriesGrid />
      )}
    </main>
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
