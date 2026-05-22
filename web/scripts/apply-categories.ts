// Applies the F2 category classification to the agents table. Reads each
// named agent, runs classify(), writes the result into agents.category.
//
// Idempotent — re-running is safe. Categories are recomputed from current
// rules every time, so a classifier rule change followed by re-running will
// converge to the new taxonomy.
//
// Skips unnamed agents (category stays NULL — they're invisible to Discover
// anyway and can be classified later if their metadata fills in).
//
// Run from web/:  pnpm exec tsx --env-file=../.env scripts/apply-categories.ts

import { db, agents } from '../src/lib/db';
import { eq, sql } from 'drizzle-orm';
import { classify } from './classify-corpus';

interface Row {
  agent_id: string;
  name: string | null;
  agent_type: string | null;
  description: string | null;
  capabilities: string[] | null;
  current_category: string | null;
}

async function main() {
  const t0 = Date.now();

  const r: any = await db.execute(sql`
    SELECT agent_id::text AS agent_id,
           name,
           agent_type,
           capabilities,
           metadata->>'description' AS description,
           category AS current_category
    FROM agents
    WHERE name IS NOT NULL AND name != '';
  `);
  const rows = (r.rows ?? r) as Row[];
  console.log(`apply-categories · ${rows.length} named agents to classify`);

  const counts = new Map<string, number>();
  const changes = new Map<string, number>();
  let writes = 0;
  let unchanged = 0;

  // Batch updates by category — one UPDATE per category with an IN clause
  // is dramatically faster than 2,000 individual UPDATE statements.
  const byCategory = new Map<string, bigint[]>();
  for (const row of rows) {
    const { category } = classify({
      name: row.name,
      agent_type: row.agent_type,
      description: row.description,
      capabilities: row.capabilities,
    });
    counts.set(category, (counts.get(category) ?? 0) + 1);
    if (category === row.current_category) {
      unchanged++;
      continue;
    }
    const transitionKey = `${row.current_category ?? '(null)'} → ${category}`;
    changes.set(transitionKey, (changes.get(transitionKey) ?? 0) + 1);
    if (!byCategory.has(category)) byCategory.set(category, []);
    byCategory.get(category)!.push(BigInt(row.agent_id));
  }

  for (const [category, agentIds] of byCategory) {
    // Update in chunks of 500 to keep statement size reasonable.
    for (let i = 0; i < agentIds.length; i += 500) {
      const chunk = agentIds.slice(i, i + 500);
      await db.execute(sql`
        UPDATE agents
        SET category = ${category},
            updated_at = NOW()
        WHERE agent_id IN ${sql.raw(`(${chunk.join(',')})`)};
      `);
      writes += chunk.length;
    }
  }

  console.log('\nFinal counts:');
  for (const [cat, n] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${cat.padEnd(15)} ${String(n).padStart(5)}`);
  }
  console.log(`\nTransitions (change kind → count):`);
  for (const [k, n] of [...changes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    console.log(`  ${k.padEnd(35)} ${n}`);
  }
  console.log(`\nWrites: ${writes} · unchanged: ${unchanged} · elapsed: ${Math.round((Date.now() - t0) / 1000)}s`);
  process.exit(0);
}

void main().catch((e) => {
  console.error('apply-categories fatal', e);
  process.exit(1);
});
