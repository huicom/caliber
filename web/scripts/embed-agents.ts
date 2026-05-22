// Phase B / Track 4 prerequisite: embed every agent that has enough text
// to be searchable. Writes the 384-dim vector to agents.embedding.
//
// Idempotent: re-runs skip agents whose embedding column is already set.
// Pass --force to recompute everything (e.g. after a model change).
//
// Run from web/:  pnpm exec tsx --env-file=../.env scripts/embed-agents.ts

import { db } from '../src/lib/db';
import { sql as drizzleSql } from 'drizzle-orm';
import { embedText, agentEmbeddingInput, toVectorLiteral } from '../src/lib/embeddings/embed';

const FORCE = process.argv.includes('--force');

interface CandidateRow {
  agent_id: string;
  name: string | null;
  agent_type: string | null;
  capabilities: string[] | null;
  description: string | null;
}

async function main() {
  const t0 = Date.now();
  console.log(`[embed-agents] starting · force=${FORCE}`);

  const where = FORCE
    ? `name IS NOT NULL AND name != ''`
    : `embedding IS NULL AND name IS NOT NULL AND name != ''`;
  const rows: any = await db.execute(drizzleSql.raw(`
    SELECT agent_id::text AS agent_id,
           name,
           agent_type,
           capabilities,
           metadata->>'description' AS description
    FROM agents
    WHERE ${where}
    ORDER BY agent_id;
  `));
  const candidates = (rows.rows ?? rows) as CandidateRow[];
  console.log(`[embed-agents] ${candidates.length} candidates to embed`);

  // Warm up the model so the first row doesn't take 30 s.
  console.log('[embed-agents] warming up model (downloads ~80 MB on first run)…');
  await embedText('warmup');
  console.log('[embed-agents] model ready');

  let ok = 0;
  let failed = 0;
  const t1 = Date.now();
  for (let i = 0; i < candidates.length; i++) {
    const row = candidates[i];
    const input = agentEmbeddingInput(row);
    if (input.length < 4) {
      // Empty / near-empty input contributes no signal — skip cleanly.
      failed++;
      continue;
    }
    try {
      const vec = await embedText(input);
      await db.execute(drizzleSql.raw(`
        UPDATE agents
        SET embedding = '${toVectorLiteral(vec)}'::vector,
            updated_at = NOW()
        WHERE agent_id = ${row.agent_id};
      `));
      ok++;
    } catch (e) {
      failed++;
      console.warn(`[embed-agents] failed for agent ${row.agent_id}:`, (e as Error).message);
    }
    if ((i + 1) % 100 === 0) {
      const elapsed = (Date.now() - t1) / 1000;
      const rate = (i + 1) / elapsed;
      console.log(`[embed-agents] ${i + 1}/${candidates.length} · ${rate.toFixed(1)}/s · ok=${ok} failed=${failed}`);
    }
  }

  const elapsedS = Math.round((Date.now() - t0) / 1000);
  console.log(`\n[embed-agents] done · ok=${ok} · failed=${failed} · ${elapsedS}s`);

  // Quick sanity check — confirm we can do a similarity query end-to-end.
  if (ok > 0) {
    const probe = await embedText('autonomous trading bot for prediction markets');
    const hits: any = await db.execute(drizzleSql.raw(`
      SELECT agent_id::text AS agent_id, name,
             1 - (embedding <=> '${toVectorLiteral(probe)}'::vector) AS similarity
      FROM agents
      WHERE embedding IS NOT NULL
      ORDER BY embedding <=> '${toVectorLiteral(probe)}'::vector ASC
      LIMIT 5;
    `));
    console.log('\nsmoke test — top-5 for "autonomous trading bot for prediction markets":');
    for (const row of ((hits.rows ?? hits) as Array<any>)) {
      console.log(`  ${row.similarity.toFixed(3)}  ${row.name}  (#${row.agent_id})`);
    }
  }

  process.exit(0);
}

void main().catch((e) => {
  console.error('[embed-agents] fatal', e);
  process.exit(1);
});
