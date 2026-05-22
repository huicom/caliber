// Track 3 (Phase 2 voyage): backfill historical tier_transitions from
// existing rating_snapshots. Walks every PIT snapshot per agent in
// chronological order and emits transition rows using the SAME diff
// rules snapshot-daily.ts uses going forward.
//
// Historical snapshots taken before 2026-05-22 do not have `flags`
// persisted (column added in migration 0005). For those rows the diff
// treats flags as 0, so flag_added / flag_removed transitions can only
// be detected once the column starts populating.
//
// Idempotent — re-runnable; truncates the existing tier_transitions
// table first so a re-run produces the same final state.
//
// Run from rating/:  pnpm exec tsx --env-file=../.env scripts/backfill-transitions.ts

import 'dotenv/config';
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () {
  return this.toString();
};
import { db, sql as rawSql, tierTransitions } from '@arc-agents/db';
import { METHODOLOGY_VERSION } from '../engine/version';
import { computeTransitions, type PrevState } from './snapshot-daily';

interface SnapshotRow {
  agent_id: string;
  chain_id: string;
  computed_at: Date;
  tier: string;
  flags: number | null;
}

async function main() {
  const t0 = Date.now();

  // Truncate so the run is deterministic.
  console.log('[backfill-transitions] truncating tier_transitions…');
  await rawSql`TRUNCATE tier_transitions RESTART IDENTITY`;

  const rows = (await rawSql.unsafe(`
    SELECT agent_id::text AS agent_id,
           chain_id,
           computed_at,
           tier,
           flags
    FROM rating_snapshots
    WHERE view = 'PIT'
    ORDER BY agent_id, computed_at ASC;
  `)) as SnapshotRow[];

  console.log(`[backfill-transitions] ${rows.length} historical PIT snapshots`);

  const transitionsToInsert: any[] = [];
  let prevAgentId: string | null = null;
  let prev: PrevState | null = null;

  for (const row of rows) {
    if (row.agent_id !== prevAgentId) {
      prevAgentId = row.agent_id;
      prev = null;
    }
    // postgres-js returns timestamp columns as strings via .unsafe() — coerce
    // to Date so drizzle's insert mapper can serialize them back.
    const computedAt =
      row.computed_at instanceof Date ? row.computed_at : new Date(row.computed_at);
    const curr = {
      tier: row.tier,
      flags: row.flags ?? 0,
      score: 0, // historical snapshots don't store score; engine produces it fresh each run
      computedAt,
      agentId: BigInt(row.agent_id),
      chainId: row.chain_id,
    };
    const ts = computeTransitions(prev, curr, METHODOLOGY_VERSION, null);
    for (const t of ts) transitionsToInsert.push(t);
    prev = { tier: row.tier, flags: row.flags, interactionCount: null };
  }

  console.log(`[backfill-transitions] computed ${transitionsToInsert.length} transitions to insert`);

  // Insert in chunks of 1000 to keep statement size reasonable.
  let inserted = 0;
  for (let i = 0; i < transitionsToInsert.length; i += 1000) {
    const chunk = transitionsToInsert.slice(i, i + 1000);
    await db.insert(tierTransitions).values(chunk);
    inserted += chunk.length;
    if (i % 5000 === 0) console.log(`[backfill-transitions] inserted ${inserted}/${transitionsToInsert.length}`);
  }

  // Quick by-kind histogram for sanity
  const histogram = (await rawSql.unsafe(`
    SELECT kind, COUNT(*)::int AS n
    FROM tier_transitions
    GROUP BY kind
    ORDER BY n DESC;
  `)) as Array<{ kind: string; n: number }>;
  console.log('\n[backfill-transitions] by kind:');
  for (const r of histogram) console.log(`  ${r.kind.padEnd(20)} ${r.n}`);

  const elapsedS = Math.round((Date.now() - t0) / 1000);
  console.log(`\n[backfill-transitions] done · ${inserted} rows · ${elapsedS}s`);
  process.exit(0);
}

void main().catch((e) => {
  console.error('[backfill-transitions] fatal', e);
  process.exit(1);
});
