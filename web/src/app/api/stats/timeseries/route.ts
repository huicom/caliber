import { db } from '@/lib/db';
import { sql } from 'drizzle-orm';
import { ok, serverError } from '@/lib/api-helpers';
import { cached } from '@/lib/cache';

export const dynamic = 'force-dynamic';

async function computeTimeseries() {
  const result = await db.execute(sql`
    WITH latest AS (
      SELECT value::bigint AS block FROM indexer_state WHERE key = 'last_indexed_block'
    ),
    oldest AS (
      SELECT MIN(registered_at_block) AS min_blk FROM agents WHERE registered_at_block > 0
    ),
    range AS (
      SELECT
        GREATEST(
          (NOW() - ((SELECT block FROM latest) - COALESCE((SELECT min_blk FROM oldest), (SELECT block FROM latest))) * INTERVAL '1 second')::date,
          NOW()::date - INTERVAL '179 days'
        ) AS start_date,
        NOW()::date AS end_date
    ),
    days AS (
      SELECT generate_series(
        (SELECT start_date FROM range),
        (SELECT end_date FROM range),
        INTERVAL '1 day'
      )::date AS day
    ),
    agent_counts AS (
      SELECT
        (NOW() - ((SELECT block FROM latest) - registered_at_block) * INTERVAL '1 second')::date AS day,
        COUNT(*) AS count
      FROM agents
      WHERE registered_at_block > 0
      GROUP BY 1
    ),
    job_counts AS (
      SELECT
        (NOW() - ((SELECT block FROM latest) - created_at_block) * INTERVAL '1 second')::date AS day,
        COUNT(*) AS count
      FROM jobs
      WHERE created_at_block > 0
      GROUP BY 1
    ),
    usdc_volume AS (
      SELECT
        (NOW() - ((SELECT block FROM latest) - created_at_block) * INTERVAL '1 second')::date AS day,
        SUM(budget_usdc) AS volume
      FROM jobs
      WHERE status = 'Completed' AND created_at_block > 0
      GROUP BY 1
    )
    SELECT
      d.day::text,
      COALESCE(a.count, 0) AS agents,
      COALESCE(j.count, 0) AS jobs,
      COALESCE(u.volume, 0) AS usdc
    FROM days d
    LEFT JOIN agent_counts a ON a.day = d.day
    LEFT JOIN job_counts j ON j.day = d.day
    LEFT JOIN usdc_volume u ON u.day = d.day
    ORDER BY d.day
  `);

  return result;
}

export async function GET() {
  try {
    const data = await cached('stats:timeseries', 30_000, computeTimeseries);
    return ok(data);
  } catch (err) {
    return serverError('Timeseries query failed', err);
  }
}
