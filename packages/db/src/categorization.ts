// F2 / Phase 2 — agent taxonomy + classifier rules. Lives in @arc-agents/db
// (not in web/) so the indexer can also call classify() at metadata-fetch
// time. Pure function; no IO, no DB access.
//
// To re-run the classifier proposal (markdown to docs/) or rewrite the
// agents.category column, see web/scripts/{classify-corpus,apply-categories}.ts.

export type CategorySlug =
  | 'trading'
  | 'validation'
  | 'assistants'
  | 'payments'
  | 'research'
  | 'content'
  | 'utility'
  | 'services'
  | 'identity'
  | 'other';

export interface CategoryMeta {
  slug: CategorySlug;
  title: string;
  blurb: string;
  hidden?: boolean;
}

interface CategoryDef extends CategoryMeta {
  rules: Array<{ where: 'name' | 'type' | 'desc' | 'cap'; match: RegExp; weight: number }>;
}

export const CATEGORIES: CategoryDef[] = [
  {
    slug: 'trading',
    title: 'Trading & Markets',
    blurb:
      'Agents that trade tokens, run market-making strategies, or operate on prediction markets like Polymarket.',
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
    blurb:
      'Agents that judge other agents — quality scoring, contract auditing, x402-protected validation endpoints.',
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
    slug: 'assistants',
    title: 'On-chain Assistants',
    blurb:
      'Co-pilot agents that help users act on-chain — swaps, pools, onboarding, reputation. The friendly guide layer.',
    rules: [
      { where: 'type', match: /^defi_assistant$/i, weight: 5 },
      { where: 'name', match: /\b(pilot|copilot|co-pilot|assistant|guide)\b/i, weight: 3 },
      { where: 'desc', match: /\bdefi\b/i, weight: 2 },
      { where: 'desc', match: /\b(liquidity|pool[s]?|yield)\b/i, weight: 2 },
      { where: 'desc', match: /\bonboarding\b/i, weight: 2 },
      { where: 'desc', match: /\bonchain (guide|copilot|assistant)\b/i, weight: 3 },
      { where: 'cap', match: /pool_discovery|swap_guidance|liquidity_monitoring|onboarding_support/i, weight: 3 },
    ],
  },
  {
    slug: 'payments',
    title: 'Payments & Stablecoins',
    blurb:
      'Agents that move USDC, route payments, settle x402 invoices, execute stablecoin-denominated jobs, or do on-chain lending/borrowing.',
    rules: [
      { where: 'type', match: /stablecoin/i, weight: 5 },
      { where: 'desc', match: /\bx402\b/i, weight: 3 },
      { where: 'desc', match: /\busdc\b/i, weight: 2 },
      { where: 'desc', match: /\bstablecoin/i, weight: 3 },
      { where: 'desc', match: /\bsettlement\b/i, weight: 2 },
      // Tuning 2026-05-22: pull lending/borrowing into payments (was landing
      // in 'other'). Lending is a treasury-style use of stablecoins, even if
      // the agent description doesn't say "stablecoin" outright.
      { where: 'name', match: /\b(lend|borrow|treasury|payment|paymaster)\b/i, weight: 3 },
      { where: 'desc', match: /\b(lend(ing|er)?|borrow|treasury|deposit|withdraw)\b/i, weight: 2 },
      { where: 'desc', match: /\b(aave|compound|morpho|euler|spark|maple)\b/i, weight: 2 },
      { where: 'cap', match: /payment-intent|settlement-routing|usdc-accounting|cctp-observer/i, weight: 4 },
    ],
  },
  {
    slug: 'research',
    title: 'Research & Analysis',
    blurb:
      'Agents that gather data, run analyses, produce reports, or monitor on-chain activity for insight.',
    rules: [
      { where: 'name', match: /\b(research|analyst|analysis|sentiment|scan|scanner|intel|scout|lens)\b/i, weight: 3 },
      { where: 'type', match: /^(research|analytical|analyst)$/i, weight: 5 },
      // Tuning 2026-05-22: drop the trailing \b so "researches" / "researcher"
      // / "researching" all match — was missing all of those before.
      { where: 'desc', match: /\bresearch/i, weight: 2 },
      { where: 'desc', match: /\b(analysis|analytics|analyz)/i, weight: 2 },
      { where: 'desc', match: /\bsentiment\b/i, weight: 3 },
      // Tuning 2026-05-22: "Web Intel Agent" / "Crypto Project Scanner" → research.
      // Verbs that signal data-gathering output rather than action.
      { where: 'desc', match: /\b(scans?|scrap(es?|ing)|extract(s|ing|ion)|monitors?)\b/i, weight: 2 },
      { where: 'desc', match: /\b(investment memo|key findings|structured (key|insights|report))\b/i, weight: 3 },
      { where: 'desc', match: /\bcoingecko\b/i, weight: 3 },
      { where: 'cap', match: /\b(research|data-analysis|statistics|event-monitoring)\b/i, weight: 3 },
    ],
  },
  {
    slug: 'content',
    title: 'Content & Social',
    blurb: 'Agents that write — tweets, threads, posts, copy, community engagement.',
    rules: [
      { where: 'name', match: /\b(content|writer|copy|tweet)\b/i, weight: 3 },
      { where: 'type', match: /^(copywriter|content)/i, weight: 5 },
      { where: 'desc', match: /\b(tweets?|threads?|posts?|community|social media)\b/i, weight: 3 },
      { where: 'cap', match: /\b(social|content[- ]generation)\b/i, weight: 3 },
    ],
  },
  {
    slug: 'utility',
    title: 'Utility & Workflow',
    blurb:
      'Agents that move information around — read documents, send notifications, orchestrate other agents, run general workflows.',
    rules: [
      { where: 'name', match: /\b(orchestrator|workflow|digest|email|sender|notifier|relay|composer)\b/i, weight: 4 },
      { where: 'name', match: /\b(copilot|co-pilot|co pilot)\b/i, weight: 4 },
      { where: 'desc', match: /\b(workflow|orchestrat|summariz|summary)\b/i, weight: 3 },
      { where: 'desc', match: /\bcopilot|\bco[- ]pilot\b/i, weight: 3 },
      { where: 'desc', match: /\b(email|inbox|notification)\b/i, weight: 3 },
      { where: 'desc', match: /\breads? (whitepapers?|docs?|documents?|long[- ]form)\b/i, weight: 4 },
      { where: 'desc', match: /\b(convert|deliver|forward|route)s? (the )?(result|output|message)\b/i, weight: 3 },
      // Tuning 2026-05-22: catch the rest of the workflow tail. Common
      // names that ended up in 'other': "Agent N" with descriptions like
      // "co-pilot for X", general-purpose assistants, automation scripts.
      { where: 'desc', match: /\b(automation|automated workflow|task runner|job runner|cron)\b/i, weight: 3 },
      { where: 'desc', match: /\bbridge\b/i, weight: 2 },
      { where: 'cap', match: /\b(webhook-relay|task-planning|coordination)\b/i, weight: 3 },
    ],
  },
  {
    slug: 'services',
    title: 'Autonomous Services',
    blurb:
      'Standalone agent products — virtual pet managers, memecoin deployers, niche utility bots running as services.',
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
    blurb:
      'Bare ERC-8004 identities tied to a wallet — registered for protocol presence rather than a specific product.',
    rules: [
      { where: 'type', match: /^wallet-agent$/i, weight: 6 },
      { where: 'name', match: /^arc agent w\d+$/i, weight: 6 },
      { where: 'desc', match: /wallet-linked erc-8004 identity/i, weight: 5 },
    ],
    hidden: true,
  },
];

export const VISIBLE_CATEGORIES: CategoryMeta[] = CATEGORIES.filter((c) => !c.hidden).map(
  ({ slug, title, blurb, hidden }) => ({ slug, title, blurb, hidden }),
);

export const ALL_CATEGORIES: CategoryMeta[] = CATEGORIES.map(({ slug, title, blurb, hidden }) => ({
  slug,
  title,
  blurb,
  hidden,
}));

export function categoryBySlug(slug: string | undefined | null): CategoryMeta | undefined {
  if (!slug) return undefined;
  return ALL_CATEGORIES.find((c) => c.slug === slug);
}

export const MIN_SCORE = 3;

export function classify(row: {
  name?: string | null;
  agent_type?: string | null;
  description?: string | null;
  capabilities?: string[] | null;
}): { category: CategorySlug; score: number } {
  const name = (row.name ?? '').toString();
  const type = (row.agent_type ?? '').toString();
  const desc = (row.description ?? '').toString();
  const caps = Array.isArray(row.capabilities) ? row.capabilities.join(' ') : '';

  let best: { slug: CategorySlug; score: number } = { slug: 'other', score: 0 };

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
