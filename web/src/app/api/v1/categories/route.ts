// GET /api/v1/categories?chain=arc
//
// Returns one row per visible Discover category with:
//   - total agent count
//   - cluster_count (distinct (name + first-200-of-description) clusters,
//     so duplicate bulk-deployed series are counted once)
//   - top_agents: 3 representatives ordered by latest tier (Gold
//     first), then jobs_completed
//
// Used by /discover landing for the category-grid cards.

import { db } from '@/lib/db';
import { sql as drizzleSql } from 'drizzle-orm';
import { ok, serverError } from '@/lib/api-helpers';
import { CATEGORIES, VISIBLE_CATEGORIES } from '@/lib/categories';

export const dynamic = 'force-dynamic';
export const revalidate = 300;

interface CategoryRow {
  category: string | null;
  agent_count: number;
  cluster_count: number;
}

interface TopAgentRow {
  category: string;
  agent_id: string;
  name: string;
  tier: string | null;
  jobs_completed: number | null;
  cluster_key: string;
  cluster_size: number;
}

export async function GET() {
  try {
    // Per-category counts (deduped cluster count via subquery).
    const totals: any = await db.execute(drizzleSql.raw(`
      SELECT
        category,
        COUNT(*)::int AS agent_count,
        COUNT(DISTINCT CONCAT(name, '|', LEFT(COALESCE(metadata->>'description',''), 200)))::int AS cluster_count
      FROM agents
      WHERE category IS NOT NULL
      GROUP BY category;
    `));
    const totalsMap = new Map<string, CategoryRow>();
    for (const row of (totals.rows ?? totals) as CategoryRow[]) {
      totalsMap.set(row.category ?? '', row);
    }

    // Top 3 agents per visible category, ordered by tier then job count.
    // Uses ROW_NUMBER() partitioned by category, picking the best representative
    // per (name + description) cluster.
    const topRows: any = await db.execute(drizzleSql.raw(`
      WITH ranked AS (
        SELECT
          a.category,
          a.agent_id::text AS agent_id,
          a.name,
          a.jobs_completed,
          s.tier,
          CONCAT(a.name, '|', LEFT(COALESCE(a.metadata->>'description',''), 200)) AS cluster_key,
          ROW_NUMBER() OVER (
            PARTITION BY a.category, CONCAT(a.name, '|', LEFT(COALESCE(a.metadata->>'description',''), 200))
            ORDER BY
              CASE s.tier
                WHEN 'Gold' THEN 0
                WHEN 'Silver' THEN 1
                WHEN 'Bronze' THEN 2
                WHEN 'Pending' THEN 3
                WHEN 'Watch' THEN 4
                WHEN 'Dormant' THEN 5
                ELSE 9
              END,
              a.jobs_completed DESC NULLS LAST,
              a.agent_id ASC
          ) AS cluster_rep_rank,
          COUNT(*) OVER (
            PARTITION BY a.category, CONCAT(a.name, '|', LEFT(COALESCE(a.metadata->>'description',''), 200))
          ) AS cluster_size
        FROM agents a
        LEFT JOIN LATERAL (
          SELECT tier FROM rating_snapshots
          WHERE agent_id = a.agent_id AND view = 'PIT'
          ORDER BY computed_at DESC LIMIT 1
        ) s ON true
        WHERE a.category IS NOT NULL AND a.name IS NOT NULL
      ),
      cluster_reps AS (
        SELECT *,
          ROW_NUMBER() OVER (
            PARTITION BY category
            ORDER BY
              CASE tier
                WHEN 'Gold' THEN 0
                WHEN 'Silver' THEN 1
                WHEN 'Bronze' THEN 2
                WHEN 'Pending' THEN 3
                WHEN 'Watch' THEN 4
                WHEN 'Dormant' THEN 5
                ELSE 9
              END,
              jobs_completed DESC NULLS LAST,
              agent_id ASC
          ) AS top_rank
        FROM ranked
        WHERE cluster_rep_rank = 1
      )
      SELECT category, agent_id, name, tier, jobs_completed, cluster_key, cluster_size::int AS cluster_size
      FROM cluster_reps
      WHERE top_rank <= 3
      ORDER BY category, top_rank;
    `));
    const topByCat = new Map<string, TopAgentRow[]>();
    for (const row of (topRows.rows ?? topRows) as TopAgentRow[]) {
      if (!topByCat.has(row.category)) topByCat.set(row.category, []);
      topByCat.get(row.category)!.push(row);
    }

    const categories = VISIBLE_CATEGORIES.map((cat) => {
      const counts = totalsMap.get(cat.slug);
      return {
        slug: cat.slug,
        title: cat.title,
        blurb: cat.blurb,
        agent_count: counts?.agent_count ?? 0,
        cluster_count: counts?.cluster_count ?? 0,
        top_agents: (topByCat.get(cat.slug) ?? []).map((r) => ({
          agent_id: r.agent_id,
          name: r.name,
          tier: r.tier,
          jobs_completed: r.jobs_completed,
          cluster_size: r.cluster_size,
        })),
      };
    });

    return ok(
      {
        chain: 'arc',
        categories,
        all_categories: CATEGORIES.map((c) => ({ slug: c.slug, hidden: c.hidden ?? false })),
      },
      { headers: { 'cache-control': 'public, max-age=300, s-maxage=300' } },
    );
  } catch (err) {
    return serverError('failed to load categories', err);
  }
}
