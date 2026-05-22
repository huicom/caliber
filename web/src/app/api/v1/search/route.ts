// GET /api/v1/search?q=<text>&category=<slug>&limit=N&chain=arc
//
// Track 4 free-text search. Tries pgvector cosine first (semantic), falls
// back to trigram + ILIKE when the query is short or pgvector returns
// nothing useful. Results are deduped by (name + description) cluster
// so a query for "trading" doesn't show 600 identical Prism Trader rows;
// the representative is the highest-tier instance per cluster, with a
// cluster_size badge for the rest.

import { db } from '@/lib/db';
import { sql as drizzleSql } from 'drizzle-orm';
import { z } from 'zod';
import { ok, badRequest, serverError, parseQuery } from '@/lib/api-helpers';
import { categoryBySlug } from '@/lib/categories';
import { embedText, toVectorLiteral } from '@/lib/embeddings/embed';

export const dynamic = 'force-dynamic';

const schema = z.object({
  q: z.string().min(1).max(200),
  category: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  chain: z.string().default('arc'),
});

interface ResultRow {
  agent_id: string;
  name: string;
  category: string | null;
  tier: string | null;
  jobs_completed: number | null;
  description: string | null;
  similarity: number;
  cluster_key: string;
  cluster_size: number;
}

function escapeStringLit(s: string): string {
  return s.replace(/'/g, "''");
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = parseQuery(url, schema);
  if (!parsed.ok) return badRequest('bad query', parsed.error);
  const { q, category, limit } = parsed.data;

  try {
    // Resolve optional category filter
    const categoryClause =
      category && categoryBySlug(category) ? `AND a.category = '${escapeStringLit(category)}'` : '';

    const t0 = Date.now();

    // Pass 1: semantic search via pgvector cosine
    const embedding = await embedText(q);
    const vec = toVectorLiteral(embedding);

    // Pull more rows than `limit` so dedup leaves enough representatives.
    const semanticLimit = Math.max(limit * 6, 60);

    const semantic: any = await db.execute(drizzleSql.raw(`
      WITH ranked AS (
        SELECT
          a.agent_id::text AS agent_id,
          a.name,
          a.category,
          a.jobs_completed,
          LEFT(a.metadata->>'description', 220) AS description,
          1 - (a.embedding <=> '${vec}'::vector) AS similarity,
          CONCAT(a.name, '|', LEFT(COALESCE(a.metadata->>'description',''), 200)) AS cluster_key,
          s.tier
        FROM agents a
        LEFT JOIN LATERAL (
          SELECT tier FROM rating_snapshots
          WHERE agent_id = a.agent_id AND view = 'PIT'
          ORDER BY computed_at DESC LIMIT 1
        ) s ON true
        WHERE a.embedding IS NOT NULL
          AND a.name IS NOT NULL
          ${categoryClause}
        ORDER BY a.embedding <=> '${vec}'::vector ASC
        LIMIT ${semanticLimit}
      ),
      deduped AS (
        SELECT *,
          ROW_NUMBER() OVER (
            PARTITION BY cluster_key
            ORDER BY
              CASE tier
                WHEN 'Established' THEN 0
                WHEN 'Proven' THEN 1
                WHEN 'Emerging' THEN 2
                WHEN 'Provisional' THEN 3
                WHEN 'Watch' THEN 4
                WHEN 'Inactive' THEN 5
                ELSE 9
              END,
              jobs_completed DESC NULLS LAST
          ) AS rep_rank,
          COUNT(*) OVER (PARTITION BY cluster_key) AS cluster_size
        FROM ranked
      )
      SELECT * FROM deduped
      WHERE rep_rank = 1
      ORDER BY similarity DESC
      LIMIT ${limit};
    `));
    const rows = (semantic.rows ?? semantic) as ResultRow[];

    // Pass 2: if semantic returned fewer than 3 results OR top similarity
    // is very low, augment with trigram. We don't replace — we append the
    // missing slots so we always show *something* useful.
    const semanticOk = rows.length >= 3 && rows[0]?.similarity > 0.2;
    let trigramRows: ResultRow[] = [];
    if (!semanticOk) {
      const trigram: any = await db.execute(drizzleSql.raw(`
        WITH ranked AS (
          SELECT
            a.agent_id::text AS agent_id,
            a.name,
            a.category,
            a.jobs_completed,
            LEFT(a.metadata->>'description', 220) AS description,
            GREATEST(
              similarity(LOWER(COALESCE(a.name, '')), LOWER('${escapeStringLit(q)}')),
              similarity(LOWER(COALESCE(a.metadata->>'description', '')), LOWER('${escapeStringLit(q)}'))
            ) AS similarity,
            CONCAT(a.name, '|', LEFT(COALESCE(a.metadata->>'description',''), 200)) AS cluster_key,
            s.tier
          FROM agents a
          LEFT JOIN LATERAL (
            SELECT tier FROM rating_snapshots
            WHERE agent_id = a.agent_id AND view = 'PIT'
            ORDER BY computed_at DESC LIMIT 1
          ) s ON true
          WHERE a.name IS NOT NULL
            ${categoryClause}
            AND (
              LOWER(COALESCE(a.name,'')) ILIKE '%${escapeStringLit(q.toLowerCase())}%'
              OR LOWER(COALESCE(a.metadata->>'description','')) ILIKE '%${escapeStringLit(q.toLowerCase())}%'
            )
        ),
        deduped AS (
          SELECT *,
            ROW_NUMBER() OVER (
              PARTITION BY cluster_key
              ORDER BY similarity DESC, jobs_completed DESC NULLS LAST
            ) AS rep_rank,
            COUNT(*) OVER (PARTITION BY cluster_key) AS cluster_size
          FROM ranked
        )
        SELECT * FROM deduped
        WHERE rep_rank = 1
        ORDER BY similarity DESC, jobs_completed DESC NULLS LAST
        LIMIT ${limit};
      `));
      trigramRows = (trigram.rows ?? trigram) as ResultRow[];
    }

    // Merge — semantic first, then trigram fill-ins (deduped by agent_id).
    const seenIds = new Set(rows.map((r) => r.agent_id));
    const merged = [...rows];
    for (const r of trigramRows) {
      if (!seenIds.has(r.agent_id) && merged.length < limit) {
        seenIds.add(r.agent_id);
        merged.push(r);
      }
    }

    const elapsedMs = Date.now() - t0;

    return ok(
      {
        chain: 'arc',
        query: q,
        filters: { category: category ?? null, limit },
        method: semanticOk ? 'semantic' : trigramRows.length > 0 ? 'semantic+trigram' : 'semantic',
        elapsed_ms: elapsedMs,
        count: merged.length,
        results: merged.map((r) => ({
          agent_id: r.agent_id,
          name: r.name,
          category: r.category,
          tier: r.tier,
          jobs_completed: r.jobs_completed ?? 0,
          description: r.description,
          similarity: Number(r.similarity?.toFixed(3) ?? 0),
          cluster_size: Number(r.cluster_size ?? 1),
          passport_url: `/passport/arc/${r.agent_id}`,
        })),
      },
      { headers: { 'cache-control': 'public, max-age=60, s-maxage=60' } },
    );
  } catch (err) {
    return serverError('search failed', err);
  }
}
