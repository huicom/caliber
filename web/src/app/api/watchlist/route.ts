// GET /api/watchlist
//
// Track 3 of the Phase 2 voyage. Returns a chronological feed of agent
// tier_transition events with agent display data inlined so the watchlist
// UI / RSS reader / Discord webhook can consume one shape without joins.
//
// Query params (all optional):
//   since=YYYY-MM-DD     return only transitions on or after this date
//   limit=N              1..200, default 50
//   kind=k1,k2,...       filter to specific transition kinds
//                        (first_rating, tier_up, tier_down, enter_watch,
//                         enter_dormant, exit_watch, exit_dormant,
//                         flag_added, flag_removed)
//   chain=arc            chain id, default 'arc'

import { db } from '@/lib/db';
import { sql as drizzleSql } from 'drizzle-orm';
import { z } from 'zod';
import { ok, badRequest, serverError, parseQuery } from '@/lib/api-helpers';

export const dynamic = 'force-dynamic';

const KIND_VALUES = [
  'first_rating',
  'tier_up',
  'tier_down',
  'enter_watch',
  'enter_dormant',
  'exit_watch',
  'exit_dormant',
  'flag_added',
  'flag_removed',
] as const;

const schema = z.object({
  since: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'since must be YYYY-MM-DD').optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  kind: z
    .string()
    .optional()
    .transform((s) =>
      s
        ? s.split(',').map((k) => k.trim()).filter((k) => (KIND_VALUES as readonly string[]).includes(k))
        : undefined,
    ),
  chain: z.string().default('arc'),
});

export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = parseQuery(url, schema);
  if (!parsed.ok) return badRequest('bad query', parsed.error);
  const { since, limit, kind, chain } = parsed.data;

  try {
    const conditions: string[] = [`t.chain_id = '${chain.replace(/'/g, "''")}'`];
    if (since) conditions.push(`t.at >= '${since}'`);
    if (kind && kind.length > 0) {
      conditions.push(`t.kind IN (${kind.map((k) => `'${k}'`).join(',')})`);
    }
    const whereClause = conditions.join(' AND ');

    const rows: any = await db.execute(drizzleSql.raw(`
      SELECT
        t.id::text                                       AS id,
        t.chain_id                                       AS chain_id,
        t.agent_id::text                                 AS agent_id,
        t.at                                             AS at,
        t.kind                                           AS kind,
        t.from_tier                                      AS from_tier,
        t.to_tier                                        AS to_tier,
        t.from_flags                                     AS from_flags,
        t.to_flags                                       AS to_flags,
        t.from_score                                     AS from_score,
        t.to_score                                       AS to_score,
        t.methodology_version                            AS methodology_version,
        a.name                                           AS agent_name,
        a.category                                       AS agent_category,
        a.jobs_completed                                 AS agent_jobs_completed
      FROM tier_transitions t
      LEFT JOIN agents a ON a.agent_id = t.agent_id
      WHERE ${whereClause}
      ORDER BY t.at DESC, t.id DESC
      LIMIT ${limit};
    `));
    const events = (rows.rows ?? rows) as Array<any>;

    return ok(
      {
        chain,
        count: events.length,
        filters: { since: since ?? null, kind: kind ?? null, limit },
        events: events.map((e) => ({
          id: e.id,
          chain: e.chain_id,
          agent_id: e.agent_id,
          agent_name: e.agent_name,
          agent_category: e.agent_category,
          agent_jobs_completed: e.agent_jobs_completed,
          at: e.at instanceof Date ? e.at.toISOString() : e.at,
          kind: e.kind,
          from_tier: e.from_tier,
          to_tier: e.to_tier,
          from_flags: e.from_flags,
          to_flags: e.to_flags,
          from_score: e.from_score,
          to_score: e.to_score,
          methodology_version: e.methodology_version,
          passport_url: `/passport/${e.chain_id}/${e.agent_id}`,
        })),
      },
      {
        headers: { 'cache-control': 'public, max-age=60, s-maxage=60' },
      },
    );
  } catch (err) {
    return serverError('failed to load watchlist', err);
  }
}
