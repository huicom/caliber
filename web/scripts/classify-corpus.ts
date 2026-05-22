// F2 of the Phase 2 voyage: classify the rated-agent corpus into 8 categories
// by keyword scoring. Rules are explicit and tweakable; no model dependency.
//
// Run from web/:  pnpm tsx --env-file=../.env scripts/classify-corpus.ts
//
// Output: rewrites docs/02-riskmodel/phase2-f2-taxonomy-proposal.md with the
// current counts + 5-sample-per-category preview. Does NOT touch the database.

import { db } from '../src/lib/db';
import { sql } from 'drizzle-orm';
import fs from 'node:fs';
import path from 'node:path';

export type Category =
  | 'trading'
  | 'validation'
  | 'defi'
  | 'payments'
  | 'research'
  | 'content'
  | 'services'
  | 'identity'
  | 'other';

interface CategoryDef {
  slug: Category;
  title: string;
  blurb: string;
  rules: Array<{ where: 'name' | 'type' | 'desc' | 'cap'; match: RegExp; weight: number }>;
  hidden?: boolean;
}

export const CATEGORIES: CategoryDef[] = [
  {
    slug: 'trading',
    title: 'Trading & Markets',
    blurb: 'Agents that trade tokens, run market-making strategies, or operate on prediction markets like Polymarket.',
    rules: [
      { where: 'name', match: /\btrad/i, weight: 3 },
      { where: 'name', match: /polymarket/i, weight: 3 },
      { where: 'name', match: /\btrader\b/i, weight: 3 },
      { where: 'type', match: /^trading/i, weight: 5 },
      { where: 'type', match: /^(aggressive|defensive|financial)$/i, weight: 3 },
      { where: 'desc', match: /polymarket/i, weight: 4 },
      { where: 'desc', match: /trading-r1/i, weight: 4 },
      { where: 'desc', match: /\barbitrage\b/i, weight: 3 },
      { where: 'desc', match: /market[- ]making/i, weight: 3 },
      { where: 'cap', match: /trade execution|arbitrage_detection|automated_execution/i, weight: 3 },
    ],
  },
  {
    slug: 'validation',
    title: 'Validation & Audit',
    blurb: 'Agents that judge other agents — quality scoring, contract auditing, evaluation, x402-protected validation endpoints.',
    rules: [
      { where: 'name', match: /sentinel/i, weight: 3 },
      { where: 'name', match: /\b(auditor|validator)\b/i, weight: 3 },
      { where: 'type', match: /audit|validator/i, weight: 4 },
      { where: 'desc', match: /\bvalidation\b/i, weight: 3 },
      { where: 'desc', match: /\baudit\b/i, weight: 3 },
      { where: 'desc', match: /x402-protected/i, weight: 4 },
      { where: 'desc', match: /quality[- ]?assessment/i, weight: 3 },
      { where: 'cap', match: /contract-audit|quality-assessment|job-evaluation|validation/i, weight: 3 },
    ],
  },
  {
    slug: 'defi',
    title: 'DeFi Operations',
    blurb: 'Agents that help with on-chain DeFi — swaps, liquidity pools, yield strategies, onboarding flows.',
    rules: [
      { where: 'type', match: /^defi_assistant$/i, weight: 5 },
      { where: 'desc', match: /\bdefi\b/i, weight: 2 },
      { where: 'desc', match: /\b(liquidity|pool[s]?|yield)\b/i, weight: 2 },
      { where: 'cap', match: /pool_discovery|swap_guidance|liquidity_monitoring|onboarding_support/i, weight: 3 },
    ],
  },
  {
    slug: 'payments',
    title: 'Payments & Stablecoins',
    blurb: 'Agents that move USDC, route payments, settle x402 invoices, or execute stablecoin-denominated jobs.',
    rules: [
      { where: 'type', match: /stablecoin/i, weight: 5 },
      { where: 'desc', match: /\bx402\b/i, weight: 3 },
      { where: 'desc', match: /\busdc\b/i, weight: 2 },
      { where: 'desc', match: /\bstablecoin/i, weight: 3 },
      { where: 'desc', match: /\bsettlement\b/i, weight: 2 },
      { where: 'cap', match: /payment-intent|settlement-routing|usdc-accounting|cctp-observer/i, weight: 4 },
    ],
  },
  {
    slug: 'research',
    title: 'Research & Analysis',
    blurb: 'Agents that gather data, run analyses, produce reports, or monitor on-chain activity for insight.',
    rules: [
      { where: 'name', match: /\b(research|analyst|analysis)\b/i, weight: 3 },
      { where: 'type', match: /^(research|analytical|analyst)$/i, weight: 5 },
      { where: 'desc', match: /\b(research|analysis|analytics)\b/i, weight: 2 },
      { where: 'cap', match: /\b(research|data-analysis|statistics|event-monitoring)\b/i, weight: 3 },
    ],
  },
  {
    slug: 'content',
    title: 'Content & Social',
    blurb: 'Agents that write — tweets, threads, posts, copy, community engagement. The voice of an on-chain org.',
    rules: [
      { where: 'name', match: /\b(content|writer|copy|tweet)\b/i, weight: 3 },
      { where: 'type', match: /^(copywriter|content)/i, weight: 5 },
      { where: 'desc', match: /\b(tweets?|threads?|posts?|community|social media)\b/i, weight: 3 },
      { where: 'cap', match: /\b(social|content[- ]generation)\b/i, weight: 3 },
    ],
  },
  {
    slug: 'services',
    title: 'Autonomous Services',
    blurb: 'Standalone agent products — virtual pet managers, memecoin deployers, niche utility bots running as services.',
    rules: [
      { where: 'name', match: /\bby olas\b/i, weight: 3 },
      { where: 'desc', match: /pett\.ai|virtual pet/i, weight: 5 },
      { where: 'desc', match: /\bmemecoin/i, weight: 4 },
      { where: 'desc', match: /pearl service|\bagents\.fun\b/i, weight: 4 },
      { where: 'desc', match: /autonomous (agent )?service/i, weight: 2 },
    ],
  },
  {
    slug: 'identity',
    title: 'Wallet Identities',
    blurb: 'Bare ERC-8004 identities tied to a wallet — registered for protocol presence rather than a specific product.',
    rules: [
      { where: 'type', match: /^wallet-agent$/i, weight: 6 },
      { where: 'name', match: /^arc agent w\d+$/i, weight: 6 },
      { where: 'desc', match: /wallet-linked erc-8004 identity/i, weight: 5 },
    ],
    hidden: true,
  },
];

export const MIN_SCORE = 3;

export function classify(row: {
  name?: string | null;
  agent_type?: string | null;
  description?: string | null;
  capabilities?: string[] | null;
}): { category: Category; score: number } {
  const name = (row.name ?? '').toString();
  const type = (row.agent_type ?? '').toString();
  const desc = (row.description ?? '').toString();
  const caps = Array.isArray(row.capabilities) ? row.capabilities.join(' ') : '';

  let best: { slug: Category; score: number } = { slug: 'other', score: 0 };

  for (const cat of CATEGORIES) {
    let score = 0;
    for (const rule of cat.rules) {
      const field =
        rule.where === 'name' ? name : rule.where === 'type' ? type : rule.where === 'desc' ? desc : caps;
      if (rule.match.test(field)) score += rule.weight;
    }
    if (score > best.score) best = { slug: cat.slug, score };
  }

  if (best.score < MIN_SCORE) return { category: 'other', score: 0 };
  return { category: best.slug, score: best.score };
}

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

  const buckets = new Map<Category, any[]>();
  for (const slug of [...CATEGORIES.map((c) => c.slug), 'other' as Category]) buckets.set(slug, []);
  for (const row of rows) {
    const { category } = classify(row);
    buckets.get(category)!.push(row);
  }

  const out: string[] = [];
  out.push('# F2 — Proposed Taxonomy (8 categories)');
  out.push('');
  out.push(
    `Corpus: ${rows.length} agents with a name (~${Math.round((rows.length / 18481) * 100)}% of ~18,500 total). Classification by keyword scoring against name + agent_type + description + capabilities; min-score threshold = ${MIN_SCORE}. Tie-breaks go to highest score.`,
  );
  out.push('');
  out.push('| # | Category | Slug | Count | Hidden? | Description |');
  out.push('|---|---|---|---|---|---|');
  for (const cat of CATEGORIES) {
    const n = buckets.get(cat.slug)!.length;
    const hide = cat.hidden ? 'yes (search only)' : '';
    out.push(`| ${CATEGORIES.indexOf(cat) + 1} | **${cat.title}** | \`${cat.slug}\` | ${n} | ${hide} | ${cat.blurb} |`);
  }
  out.push(
    `| 9 | Other / unclassified | \`other\` | ${buckets.get('other')!.length} | yes (search only) | Agents with a name but whose description doesn't match a category threshold. |`,
  );
  out.push('');
  const visibleCount = CATEGORIES.filter((c) => !c.hidden).reduce(
    (s, c) => s + buckets.get(c.slug)!.length,
    0,
  );
  out.push(
    `**Visible-on-Discover-page total:** ${visibleCount} agents across ${CATEGORIES.filter((c) => !c.hidden).length} categories.`,
  );
  out.push('');

  for (const cat of CATEGORIES) {
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
  for (const cat of CATEGORIES) {
    const n = buckets.get(cat.slug)!.length;
    console.log(`  ${cat.title.padEnd(28)} ${String(n).padStart(5)}${cat.hidden ? '  [hidden]' : ''}`);
  }
  console.log(`  ${'Other / unclassified'.padEnd(28)} ${String(buckets.get('other')!.length).padStart(5)}  [hidden]`);

  process.exit(0);
}

// Only run main if invoked directly (not when imported).
if (require.main === module) {
  void main().catch((e) => {
    console.error('classify-corpus fatal', e);
    process.exit(1);
  });
}
