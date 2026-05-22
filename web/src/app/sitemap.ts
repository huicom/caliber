import { db } from '@/lib/db';
import { sql as drizzleSql } from 'drizzle-orm';
import type { MetadataRoute } from 'next';
import { VISIBLE_CATEGORIES } from '@arc-agents/db';

// The sitemap covers four classes of URL:
//   1. Static editorial routes (home, /agents, /jobs, etc.)
//   2. Phase 2 surfaces (/discover, /watchlist, /passport, /verify, public docs)
//   3. Per-category Discover pages — one per visible slug
//   4. Per-rated-agent /passport URLs — top 200 by job count, to keep the
//      sitemap under Google's 50k practical limit

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = 'https://caliber.poko.blue';

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: baseUrl, lastModified: new Date(), changeFrequency: 'hourly', priority: 1 },

    // Phase 2 human surfaces
    { url: `${baseUrl}/discover`, lastModified: new Date(), changeFrequency: 'hourly', priority: 0.95 },
    { url: `${baseUrl}/watchlist`, lastModified: new Date(), changeFrequency: 'hourly', priority: 0.9 },
    { url: `${baseUrl}/watchlist/subscribe`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.6 },
    { url: `${baseUrl}/verify`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.7 },

    // Existing engineer-facing pages
    { url: `${baseUrl}/agents`, lastModified: new Date(), changeFrequency: 'hourly', priority: 0.85 },
    { url: `${baseUrl}/jobs`, lastModified: new Date(), changeFrequency: 'hourly', priority: 0.85 },
    { url: `${baseUrl}/jobs/new`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.7 },
    { url: `${baseUrl}/stats`, lastModified: new Date(), changeFrequency: 'hourly', priority: 0.7 },
    { url: `${baseUrl}/live`, lastModified: new Date(), changeFrequency: 'always', priority: 0.7 },

    // Public docs
    { url: `${baseUrl}/methodology`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.95 },
    { url: `${baseUrl}/integrate`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.85 },
    { url: `${baseUrl}/builders`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.8 },
    { url: `${baseUrl}/developers`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.85 },
    { url: `${baseUrl}/guide`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.85 },
    { url: `${baseUrl}/docs/service`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.75 },
  ];

  const categoryRoutes: MetadataRoute.Sitemap = VISIBLE_CATEGORIES.map((cat) => ({
    url: `${baseUrl}/discover/category/${cat.slug}`,
    lastModified: new Date(),
    changeFrequency: 'daily',
    priority: 0.8,
  }));

  // Most-active rated agents — most likely to attract inbound links.
  let topAgentIds: Array<{ agentId: bigint }> = [];
  try {
    const r: any = await db.execute(drizzleSql.raw(`
      SELECT a.agent_id AS "agentId"
      FROM agents a
      WHERE a.name IS NOT NULL AND a.name != '' AND a.jobs_completed > 0
      ORDER BY a.jobs_completed DESC
      LIMIT 200;
    `));
    topAgentIds = (r.rows ?? r) as Array<{ agentId: bigint }>;
  } catch {
    // skip if DB unavailable during build
  }

  // Each agent gets a /passport entry (canonical) and a legacy /agents entry.
  const passportRoutes: MetadataRoute.Sitemap = topAgentIds.map((a) => ({
    url: `${baseUrl}/passport/arc/${String(a.agentId)}`,
    lastModified: new Date(),
    changeFrequency: 'weekly',
    priority: 0.7,
  }));
  const agentRoutes: MetadataRoute.Sitemap = topAgentIds.map((a) => ({
    url: `${baseUrl}/agents/${String(a.agentId)}`,
    lastModified: new Date(),
    changeFrequency: 'weekly',
    priority: 0.5,
  }));

  return [...staticRoutes, ...categoryRoutes, ...passportRoutes, ...agentRoutes];
}
