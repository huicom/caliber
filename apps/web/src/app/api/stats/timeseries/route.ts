import { db } from '@/lib/db';
import { sql } from 'drizzle-orm';
import { ok, serverError } from '@/lib/api-helpers';
import { cached } from '@/lib/cache';

export const dynamic = 'force-dynamic';

async function computeTimeseries() {
  const result = await db.execute(sql`
    WITH days AS (
      SELECT generate_series(NOW()::date - INTERVAL '29 days', NOW()::date, INTERVAL '1 day')::date AS day
    ),
    agent_counts AS (
      SELECT registered_at::date AS day, COUNT(*) AS count
      FROM agents WHERE registered_at >= NOW() - INTERVAL '30 days'
      GROUP BY 1
    ),
    job_counts AS (
      SELECT created_at::date AS day, COUNT(*) AS count
      FROM jobs WHERE created_at >= NOW() - INTERVAL '30 days'
      GROUP BY 1
    ),
    usdc_volume AS (
      SELECT created_at::date AS day, SUM(budget_usdc) AS volume
      FROM jobs WHERE status = 'Completed' AND created_at >= NOW() - INTERVAL '30 days'
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
