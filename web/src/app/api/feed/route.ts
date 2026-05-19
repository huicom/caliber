import { db } from '@/lib/db';
import { sql } from 'drizzle-orm';
import { ok, serverError } from '@/lib/api-helpers';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const rows = await db.execute(sql`
      SELECT * FROM (
        SELECT 'agent_registered' AS kind, agent_id::text AS ref_id, owner_address AS actor, registered_at_block AS block, registered_tx_hash AS tx_hash, name AS extra
        FROM agents
        ORDER BY registered_at_block DESC
        LIMIT 30
      ) a
      UNION ALL
      SELECT * FROM (
        SELECT 'feedback_given' AS kind, agent_id::text, validator_address, block_number, tx_hash, score::text
        FROM feedback_events
        ORDER BY block_number DESC
        LIMIT 30
      ) b
      UNION ALL
      SELECT * FROM (
        SELECT event_type AS kind, job_id::text, actor_address, block_number, tx_hash, NULL AS extra
        FROM job_events
        ORDER BY block_number DESC
        LIMIT 30
      ) c
      ORDER BY block DESC
      LIMIT 50
    `);

    return ok({ feed: rows });
  } catch (err) {
    return serverError('Failed to fetch feed', err);
  }
}
