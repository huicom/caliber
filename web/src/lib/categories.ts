// F2-defined agent taxonomy. Single source of truth for slug → display
// title + human-readable blurb + visibility on the Discover page.
//
// The classifier rules that ASSIGN agents to a category live in
// web/scripts/classify-corpus.ts (which imports nothing from here to
// keep the script self-contained). When category counts shift, run:
//   pnpm exec tsx --env-file=../.env scripts/classify-corpus.ts   # proposal markdown
//   pnpm exec tsx --env-file=../.env scripts/apply-categories.ts  # write to DB

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

export const CATEGORIES: CategoryMeta[] = [
  {
    slug: 'trading',
    title: 'Trading & Markets',
    blurb:
      'Agents that trade tokens, run market-making strategies, or operate on prediction markets like Polymarket.',
  },
  {
    slug: 'validation',
    title: 'Validation & Audit',
    blurb:
      'Agents that judge other agents — quality scoring, contract auditing, x402-protected validation endpoints.',
  },
  {
    slug: 'assistants',
    title: 'On-chain Assistants',
    blurb:
      'Co-pilot agents that help users act on-chain — swaps, pools, onboarding, reputation. The friendly guide layer.',
  },
  {
    slug: 'payments',
    title: 'Payments & Stablecoins',
    blurb:
      'Agents that move USDC, route payments, settle x402 invoices, or execute stablecoin-denominated jobs.',
  },
  {
    slug: 'research',
    title: 'Research & Analysis',
    blurb:
      'Agents that gather data, run analyses, produce reports, or monitor on-chain activity for insight.',
  },
  {
    slug: 'content',
    title: 'Content & Social',
    blurb: 'Agents that write — tweets, threads, posts, copy, community engagement.',
  },
  {
    slug: 'utility',
    title: 'Utility & Workflow',
    blurb:
      'Agents that move information around — read documents, send notifications, orchestrate other agents.',
  },
  {
    slug: 'services',
    title: 'Autonomous Services',
    blurb:
      'Standalone agent products — virtual pet managers, memecoin deployers, niche utility bots running as services.',
  },
  {
    slug: 'identity',
    title: 'Wallet Identities',
    blurb:
      'Bare ERC-8004 identities tied to a wallet — registered for protocol presence rather than a specific product.',
    hidden: true,
  },
];

export const VISIBLE_CATEGORIES = CATEGORIES.filter((c) => !c.hidden);

export function categoryBySlug(slug: string | undefined | null): CategoryMeta | undefined {
  if (!slug) return undefined;
  return CATEGORIES.find((c) => c.slug === slug);
}
