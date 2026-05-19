import { db } from '@/lib/db';
import { sql } from 'drizzle-orm';
import { LiveFeedClient, type SeedEvent } from './LiveFeedClient';

async function fetchSeed(): Promise<SeedEvent[]> {
  try {
    // Direct DB query (server-side pattern used elsewhere in this codebase).
    // Mirrors /api/feed but limits to the 3 most-recent rows.
    const rows = await db.execute(sql`
      SELECT * FROM (
        SELECT 'agent_registered' AS kind, agent_id::text AS ref_id,
               owner_address AS actor, registered_at_block AS block,
               name AS extra
        FROM agents
        ORDER BY registered_at_block DESC
        LIMIT 5
      ) a
      UNION ALL
      SELECT * FROM (
        SELECT 'feedback_given' AS kind, agent_id::text,
               validator_address, block_number, score::text
        FROM feedback_events
        ORDER BY block_number DESC
        LIMIT 5
      ) b
      UNION ALL
      SELECT * FROM (
        SELECT event_type AS kind, job_id::text,
               actor_address, block_number, NULL AS extra
        FROM job_events
        ORDER BY block_number DESC
        LIMIT 5
      ) c
      ORDER BY block DESC
      LIMIT 3
    `);

    return (rows as unknown as Array<Record<string, unknown>>).map((r) => ({
      kind: String(r.kind ?? ''),
      ref_id: r.ref_id != null ? String(r.ref_id) : null,
      actor: r.actor != null ? String(r.actor) : null,
      block: r.block != null ? Number(r.block) : null,
      extra: r.extra != null ? String(r.extra) : null,
    }));
  } catch {
    return [];
  }
}

export async function LiveFeedWidget() {
  const seed = await fetchSeed();
  return <LiveFeedClient seed={seed} />;
}
