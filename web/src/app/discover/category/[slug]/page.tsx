import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { sql as drizzleSql } from 'drizzle-orm';
import { categoryBySlug, VISIBLE_CATEGORIES } from '@/lib/categories';
import { AgentCard } from '../../_components/AgentCard';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const cat = categoryBySlug(slug);
  if (!cat || cat.hidden) return { title: 'Caliber Discover — not found' };
  return {
    title: `${cat.title} on Arc — Caliber Discover`,
    description: cat.blurb,
    openGraph: {
      title: `${cat.title} on Arc — Caliber Discover`,
      description: cat.blurb,
      url: `https://caliber.poko.blue/discover/category/${slug}`,
      type: 'article',
    },
  };
}

interface Row {
  agent_id: string;
  name: string;
  category: string;
  description: string | null;
  jobs_completed: number;
  tier: string | null;
  cluster_size: number;
}

async function loadCategory(slug: string): Promise<Row[]> {
  const r: any = await db.execute(drizzleSql.raw(`
    WITH ranked AS (
      SELECT
        a.agent_id::text AS agent_id,
        a.name,
        a.category,
        LEFT(a.metadata->>'description', 200) AS description,
        a.jobs_completed,
        s.tier,
        CONCAT(a.name, '|', LEFT(COALESCE(a.metadata->>'description',''), 200)) AS cluster_key,
        ROW_NUMBER() OVER (
          PARTITION BY CONCAT(a.name, '|', LEFT(COALESCE(a.metadata->>'description',''), 200))
          ORDER BY
            CASE s.tier
              WHEN 'Gold' THEN 0 WHEN 'Silver' THEN 1 WHEN 'Bronze' THEN 2
              WHEN 'Pending' THEN 3 WHEN 'Watch' THEN 4 WHEN 'Dormant' THEN 5 ELSE 9
            END,
            a.jobs_completed DESC NULLS LAST,
            a.agent_id ASC
        ) AS rep_rank,
        COUNT(*) OVER (
          PARTITION BY CONCAT(a.name, '|', LEFT(COALESCE(a.metadata->>'description',''), 200))
        ) AS cluster_size
      FROM agents a
      LEFT JOIN LATERAL (
        SELECT tier FROM rating_snapshots WHERE agent_id = a.agent_id AND view = 'PIT'
        ORDER BY computed_at DESC LIMIT 1
      ) s ON true
      WHERE a.category = '${slug.replace(/'/g, "''")}' AND a.name IS NOT NULL
    )
    SELECT * FROM ranked
    WHERE rep_rank = 1
    ORDER BY
      CASE tier
        WHEN 'Gold' THEN 0 WHEN 'Silver' THEN 1 WHEN 'Bronze' THEN 2
        WHEN 'Pending' THEN 3 WHEN 'Watch' THEN 4 WHEN 'Dormant' THEN 5 ELSE 9
      END,
      cluster_size DESC,
      jobs_completed DESC NULLS LAST
    LIMIT 60;
  `));
  return (r.rows ?? r) as Row[];
}

export default async function CategoryPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const cat = categoryBySlug(slug);
  if (!cat || cat.hidden) return notFound();

  const agents = await loadCategory(slug);

  return (
    <main className="mx-auto max-w-3xl px-4 sm:px-5 py-10 sm:py-14 space-y-8">
      <section className="space-y-3">
        <nav className="font-mono text-[11px] text-[var(--color-mute)]">
          <Link href="/" className="hover:text-[var(--color-copper)]">caliber</Link>
          <span className="mx-2 opacity-50">/</span>
          <Link href="/discover" className="hover:text-[var(--color-copper)]">discover</Link>
          <span className="mx-2 opacity-50">/</span>
          <span>{cat.slug}</span>
        </nav>
        <h1 className="text-3xl sm:text-4xl font-semibold text-[var(--color-ink)] tracking-tight">
          {cat.title}
        </h1>
        <p className="text-[15px] text-[var(--color-ink)] leading-relaxed max-w-prose">{cat.blurb}</p>
        <p className="font-mono text-[10px] text-[var(--color-mute)] uppercase tracking-[0.06em]">
          {agents.length} distinct products · ordered by Caliber tier, then job count
        </p>
      </section>

      <section className="space-y-2">
        {agents.length === 0 ? (
          <div className="border border-[var(--color-hairline)] bg-white rounded-[2px] p-5 text-sm text-[var(--color-ink)]">
            No agents have published metadata matching this category yet.{' '}
            <Link href="/discover" className="text-[var(--color-copper)] hover:underline">
              back to discover →
            </Link>
          </div>
        ) : (
          agents.map((row) => (
            <AgentCard
              key={row.agent_id}
              agentId={row.agent_id}
              name={row.name}
              description={row.description}
              tier={row.tier}
              jobsCompleted={row.jobs_completed}
              clusterSize={Number(row.cluster_size)}
            />
          ))
        )}
      </section>

      <section className="border-t border-[var(--color-hairline)] pt-6 text-sm text-[var(--color-mute)] leading-relaxed">
        <p>
          Cards above are deduped: a product with N identical replicas appears once, with{' '}
          <em>× N replicas</em> on the card. Clicking takes you to the highest-tier instance&rsquo;s
          Caliber Passport.
        </p>
        <p className="mt-3">
          Other categories:{' '}
          {VISIBLE_CATEGORIES.filter((c) => c.slug !== slug).map((c, i, arr) => (
            <span key={c.slug}>
              <Link href={`/discover/category/${c.slug}`} className="text-[var(--color-copper)] hover:underline">
                {c.title.toLowerCase()}
              </Link>
              {i < arr.length - 1 ? ' · ' : ''}
            </span>
          ))}
        </p>
      </section>
    </main>
  );
}
