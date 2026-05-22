// Display metadata + classifier rules for the F2 taxonomy live in
// @arc-agents/db so the indexer can call classify() at insert time.
// This file re-exports the web-relevant surface so existing imports
// (e.g. `from '@/lib/categories'`) keep working.

export {
  type CategorySlug,
  type CategoryMeta,
  ALL_CATEGORIES,
  VISIBLE_CATEGORIES,
  categoryBySlug,
  classify,
} from '@arc-agents/db';

// Web-only alias kept for back-compat with prior imports.
export { ALL_CATEGORIES as CATEGORIES } from '@arc-agents/db';
