import { db, agents } from '@/lib/db';
import { count } from 'drizzle-orm';
import type { MetadataRoute } from 'next';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = 'https://arcagents.poko.blue';

  const staticRoutes = [
    { url: baseUrl, lastModified: new Date(), changeFrequency: 'hourly' as const, priority: 1 },
    { url: `${baseUrl}/agents`, lastModified: new Date(), changeFrequency: 'hourly' as const, priority: 0.9 },
    { url: `${baseUrl}/jobs`, lastModified: new Date(), changeFrequency: 'hourly' as const, priority: 0.9 },
    { url: `${baseUrl}/stats`, lastModified: new Date(), changeFrequency: 'hourly' as const, priority: 0.8 },
    { url: `${baseUrl}/live`, lastModified: new Date(), changeFrequency: 'always' as const, priority: 0.7 },
  ];

  let latestAgentIds: Array<{ agentId: bigint }> = [];
  try {
    latestAgentIds = await db
      .select({ agentId: agents.agentId })
      .from(agents)
      .orderBy(agents.registeredAtBlock)
      .limit(200);
  } catch {
    // skip if DB unavailable during build
  }

  const agentRoutes: MetadataRoute.Sitemap = latestAgentIds.map((a) => ({
    url: `${baseUrl}/agents/${String(a.agentId)}`,
    lastModified: new Date(),
    changeFrequency: 'weekly' as const,
    priority: 0.6,
  }));

  return [...staticRoutes, ...agentRoutes];
}
