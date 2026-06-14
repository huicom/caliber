// Active-mandate policy store (Steward Phase 1, task 13).
//
// The pipeline enforces the ACTIVE mandate's compiled_policy. This module:
//   • loads that policy from steward_mandates (status='active', newest version),
//     with a short TTL cache so the hot path doesn't hit Postgres every payment;
//   • falls back to a policy built from env (STEWARD_MAX_TX_USDC keeps working)
//     when no mandate row exists;
//   • on boot, if the table is empty, SEEDS one mandate whose plain-English
//     raw_text and compiled_policy are kept consistent.
//
// The LLM mandate-compiler (raw_text → compiled_policy) is a later task; this
// store only READS the compiled policy and seeds a deterministic default. The
// seam is the `compileModel` column: 'seed' here, 'opencode/<model>' later.

import { db, sql, stewardMandates } from '@arc-agents/db';
import type { StewardMandate } from '@arc-agents/db';
import { and, desc, eq } from 'drizzle-orm';
import {
  parseCompiledPolicy,
  DEFAULT_POLICY,
  type CompiledPolicy,
} from '@caliber/steward-core';

const TTL_MS = 10_000;

/** The active mandate + its parsed policy, as the route + pipeline consume it. */
export interface ActiveMandate {
  id: bigint | null;
  rawText: string;
  version: number;
  policy: CompiledPolicy;
}

let cache: { value: ActiveMandate; at: number } | null = null;

/**
 * Build a policy from env when there's no mandate row at all. STEWARD_MAX_TX_USDC
 * (the Phase-1 stand-in cap) still drives per-tx; daily falls to a generous
 * multiple so the env-only mode doesn't surprise-deny on the daily cap.
 */
function envPolicy(): CompiledPolicy {
  const perTx = process.env.STEWARD_MAX_TX_USDC?.trim() || '0.005';
  return {
    ...DEFAULT_POLICY,
    caps: {
      ...DEFAULT_POLICY.caps,
      perTxUsdc: perTx,
    },
  };
}

/** Read the newest active mandate row, or null if the table has none active. */
async function readActiveRow(): Promise<StewardMandate | null> {
  const rows = await db
    .select()
    .from(stewardMandates)
    .where(eq(stewardMandates.status, 'active'))
    .orderBy(desc(stewardMandates.version), desc(stewardMandates.id))
    .limit(1);
  return rows[0] ?? null;
}

function toActiveMandate(row: StewardMandate): ActiveMandate {
  // A malformed compiled_policy fails closed: parseCompiledPolicy throws, the
  // caller logs and falls back to the env policy (see getActivePolicy).
  const policy = parseCompiledPolicy(row.compiledPolicy);
  return { id: row.id, rawText: row.rawText, version: row.version, policy };
}

/**
 * The active mandate + policy, TTL-cached (~10s). On any failure (no row,
 * unparseable policy, DB error) returns the env policy with a synthetic mandate
 * so the pipeline always has a policy to enforce.
 */
export async function getActiveMandate(): Promise<ActiveMandate> {
  const now = Date.now();
  if (cache && now - cache.at < TTL_MS) return cache.value;

  let value: ActiveMandate;
  try {
    const row = await readActiveRow();
    value = row
      ? toActiveMandate(row)
      : { id: null, rawText: '(env fallback — no mandate row)', version: 0, policy: envPolicy() };
  } catch (err) {
    console.error('[steward] policy-store load failed; using env policy:', err);
    value = { id: null, rawText: '(env fallback — load error)', version: 0, policy: envPolicy() };
  }

  cache = { value, at: now };
  return value;
}

/** Just the policy (the pipeline's hot-path entry point). */
export async function getActivePolicy(): Promise<CompiledPolicy> {
  return (await getActiveMandate()).policy;
}

/** Drop the cache (used right after a seed so the next read sees the new row). */
export function invalidatePolicyCache(): void {
  cache = null;
}

/**
 * The seed mandate. raw_text is product-voice plain English; compiled_policy is
 * the matching machine policy. They MUST stay consistent: $0.005 per payment,
 * $0.50 per day, anything over $0.002 in one payment needs approval.
 */
const SEED_RAW_TEXT =
  'Spend at most $0.005 per payment and $0.50 per day. ' +
  'Anything above $0.002 in a single payment needs my approval. ' +
  'Hold the first payment to anyone new until I approve it.';

const SEED_POLICY: CompiledPolicy = {
  version: 1,
  caps: { perTxUsdc: '0.005', dailyUsdc: '0.50' },
  approvalThresholdUsdc: '0.002',
  newCounterparty: 'hold',
};

/**
 * On boot: if steward_mandates is empty, insert the seed mandate so the system
 * enforces a real, human-readable policy from the first payment. Idempotent —
 * a non-empty table is left untouched.
 */
export async function seedDefaultMandateIfEmpty(): Promise<void> {
  const [{ count }] = await sql<{ count: number }[]>`
    select count(*)::int as count from steward_mandates
  `;
  if (count > 0) return;

  await db.insert(stewardMandates).values({
    rawText: SEED_RAW_TEXT,
    compiledPolicy: SEED_POLICY,
    compileModel: 'seed',
    version: 1,
    status: 'active',
  });
  invalidatePolicyCache();
  console.log('[steward] seeded default mandate (raw_text + compiled_policy, model=seed)');
}
