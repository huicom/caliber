// F2 of the Phase 2 voyage: regenerate the taxonomy proposal markdown
// at docs/02-riskmodel/phase2-f2-taxonomy-proposal.md.
//
// The actual classification rules and `classify()` function live in
// @arc-agents/db/src/categorization.ts so the indexer can tag agents
// at metadata-fetch time.
//
// Run from web/:  pnpm exec tsx --env-file=../.env scripts/classify-corpus.ts

import { db } from '../src/lib/db';
import { sql } from 'drizzle-orm';
import fs from 'node:fs';
import path from 'node:path';
import { classify, ALL_CATEGORIES, MIN_SCORE, type CategorySlug } from '@arc-agents/db';

async function main() {
  const r: any = await db.execute(sql`
    SELECT agent_id::text AS agent_id,
           name,
           agent_type,
           capabilities,
           metadata->>'description' AS description,
           jobs_completed,
           feedback_count
    FROM agents
    WHERE name IS NOT NULL AND name != '';
  `);
  const rows = (r.rows ?? r) as Array<any>;
  console.log(`classifying ${rows.length} agents…\n`);

  const buckets = new Map<CategorySlug, any[]>();
  for (const slug of [...ALL_CATEGORIES.map((c) => c.slug), 'other' as CategorySlug]) {
    buckets.set(slug, []);
  }
  for (const row of rows) {
    const { category } = classify({
      name: row.name,
      agent_type: row.agent_type,
      description: row.description,
      capabilities: row.capabilities,
    });
    buckets.get(category)!.push(row);
  }

  const visibleCats = ALL_CATEGORIES.filter((c) => !c.hidden);

  const out: string[] = [];
  out.push(`# F2 — Proposed Taxonomy (${visibleCats.length} visible + 2 hidden)`);
  out.push('');
  out.push(
    `Corpus: ${rows.length} agents with a name. Classification by keyword scoring against name + agent_type + description + capabilities; min-score threshold = ${MIN_SCORE}. Tie-breaks go to highest score. Rules live in \`packages/db/src/categorization.ts\` — indexer + web both use the same function.`,
  );
  out.push('');
  out.push('| # | Category | Slug | Count | Hidden? | Description |');
  out.push('|---|---|---|---|---|---|');
  for (const cat of ALL_CATEGORIES) {
    const n = buckets.get(cat.slug)!.length;
    const hide = cat.hidden ? 'yes (search only)' : '';
    const idx = ALL_CATEGORIES.indexOf(cat) + 1;
    out.push(`| ${idx} | **${cat.title}** | \`${cat.slug}\` | ${n} | ${hide} | ${cat.blurb} |`);
  }
  out.push(
    `| ${ALL_CATEGORIES.length + 1} | Other / unclassified | \`other\` | ${buckets.get('other')!.length} | yes (search only) | Agents with a name but whose description doesn't match a category threshold. |`,
  );
  out.push('');
  const visibleCount = visibleCats.reduce((s, c) => s + buckets.get(c.slug)!.length, 0);
  out.push(`**Visible-on-Discover-page total:** ${visibleCount} agents across ${visibleCats.length} categories.`);
  out.push('');

  for (const cat of ALL_CATEGORIES) {
    const all = buckets.get(cat.slug)!;
    out.push(`---\n\n## ${cat.title} (${all.length})\n`);
    out.push(`> ${cat.blurb}`);
    out.push('');
    if (cat.hidden) out.push('_Hidden from the Discover category browse; surfaced only via free-text search._\n');
    const samples = [...all].sort(() => Math.random() - 0.5).slice(0, 5);
    if (samples.length === 0) {
      out.push('_No agents matched._');
    } else {
      out.push('| Agent | Type | Jobs | Description (first 100 chars) |');
      out.push('|---|---|---|---|');
      for (const s of samples) {
        const desc = ((s.description ?? '') as string).replace(/\n/g, ' ').replace(/\|/g, '\\|').slice(0, 100);
        const name = (s.name ?? '(no name)').toString().replace(/\|/g, '\\|').slice(0, 40);
        out.push(`| ${name} (#${s.agent_id}) | ${s.agent_type ?? '—'} | ${s.jobs_completed ?? 0} | ${desc} |`);
      }
    }
    out.push('');
  }

  out.push(`---\n\n## Other / unclassified (${buckets.get('other')!.length})\n`);
  out.push(
    "_Agents with a name but whose description doesn't hit any category threshold. Often very short descriptions or names without context._\n",
  );
  const otherSamples = [...buckets.get('other')!].sort(() => Math.random() - 0.5).slice(0, 10);
  out.push('| Agent | Type | Description |');
  out.push('|---|---|---|');
  for (const s of otherSamples) {
    const desc = ((s.description ?? '') as string).replace(/\n/g, ' ').replace(/\|/g, '\\|').slice(0, 100);
    const name = (s.name ?? '(no name)').toString().replace(/\|/g, '\\|').slice(0, 40);
    out.push(`| ${name} (#${s.agent_id}) | ${s.agent_type ?? '—'} | ${desc} |`);
  }

  const outPath = path.resolve(__dirname, '../../docs/02-riskmodel/phase2-f2-taxonomy-proposal.md');
  fs.writeFileSync(outPath, out.join('\n'));
  console.log(`Wrote: ${outPath}`);

  console.log('\nCategory counts:');
  for (const cat of ALL_CATEGORIES) {
    const n = buckets.get(cat.slug)!.length;
    console.log(`  ${cat.title.padEnd(28)} ${String(n).padStart(5)}${cat.hidden ? '  [hidden]' : ''}`);
  }
  console.log(`  ${'Other / unclassified'.padEnd(28)} ${String(buckets.get('other')!.length).padStart(5)}  [hidden]`);

  process.exit(0);
}

if (require.main === module) {
  void main().catch((e) => {
    console.error('classify-corpus fatal', e);
    process.exit(1);
  });
}
