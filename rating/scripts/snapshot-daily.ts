import 'dotenv/config';
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () {
  return this.toString();
};
import { db, sql as rawSql, ratingSnapshots, tierTransitions } from '@arc-agents/db';
import { eq, and, desc, lt } from 'drizzle-orm';
import { rateAgent } from '../engine/rating';
import { METHODOLOGY_VERSION } from '../engine/version';
import { flagsToBitfield, TIER_ORDINAL, type CaliberTier } from '../engine/types';

// Diff one snapshot against the previous one for the same agent. Returns
// zero or more tier_transition rows. Exported so the historical backfill
// script can reuse the exact same diff rules.
//
// Transition kinds:
//   first_rating    — no previous snapshot existed
//   tier_up         — moved up the tier scale (e.g. Proven → Established)
//   tier_down       — moved down (e.g. Proven → Watch)
//   enter_watch     — entered Watch tier from anything else
//   exit_watch      — left Watch tier
//   enter_inactive  — entered Inactive tier
//   exit_inactive   — left Inactive tier
//   flag_added      — gained at least one risk flag
//   flag_removed    — cleared at least one risk flag
// Tier moves and flag changes can co-occur — both rows emitted.
export interface PrevState {
  tier: string;
  flags: number | null;
  interactionCount: number | null;
}
export interface CurrState {
  tier: string;
  flags: number;
  score: number;
  computedAt: Date;
  agentId: bigint;
  chainId: string;
}
export function computeTransitions(
  prev: PrevState | null,
  curr: CurrState,
  methodologyVersion: string,
  prevScore: number | null = null,
): Array<{
  chainId: string;
  agentId: bigint;
  at: Date;
  kind: string;
  fromTier: string | null;
  toTier: string;
  fromFlags: number | null;
  toFlags: number;
  fromScore: number | null;
  toScore: number;
  methodologyVersion: string;
}> {
  const base = {
    chainId: curr.chainId,
    agentId: curr.agentId,
    at: curr.computedAt,
    toTier: curr.tier,
    toFlags: curr.flags,
    fromTier: prev?.tier ?? null,
    fromFlags: prev?.flags ?? null,
    fromScore: prevScore,
    toScore: curr.score,
    methodologyVersion,
  };

  if (!prev) {
    return [{ ...base, kind: 'first_rating' }];
  }

  const out: typeof base[] & Array<typeof base & { kind: string }> = [];

  if (prev.tier !== curr.tier) {
    const prevOrd = TIER_ORDINAL[prev.tier as CaliberTier];
    const currOrd = TIER_ORDINAL[curr.tier as CaliberTier];
    if (Number.isFinite(prevOrd) && Number.isFinite(currOrd) && currOrd < prevOrd) {
      out.push({ ...base, kind: 'tier_up' });
    } else if (Number.isFinite(prevOrd) && Number.isFinite(currOrd) && currOrd > prevOrd) {
      out.push({ ...base, kind: 'tier_down' });
    }
    if (curr.tier === 'Watch' && prev.tier !== 'Watch') out.push({ ...base, kind: 'enter_watch' });
    if (curr.tier !== 'Watch' && prev.tier === 'Watch') out.push({ ...base, kind: 'exit_watch' });
    if (curr.tier === 'Inactive' && prev.tier !== 'Inactive') out.push({ ...base, kind: 'enter_inactive' });
    if (curr.tier !== 'Inactive' && prev.tier === 'Inactive') out.push({ ...base, kind: 'exit_inactive' });
  }

  const prevFlags = prev.flags ?? 0;
  if (prevFlags !== curr.flags) {
    const added = curr.flags & ~prevFlags;
    const removed = prevFlags & ~curr.flags;
    if (added !== 0) out.push({ ...base, kind: 'flag_added' });
    if (removed !== 0) out.push({ ...base, kind: 'flag_removed' });
  }

  return out;
}

/**
 * Wave 3 — Daily snapshot of every rateable agent's current Caliber rating.
 *
 * Run by the caliber-snapshot systemd timer. Writes one PIT row per agent
 * per UTC day. Idempotent: a unique partial index on
 * (chain_id, agent_id, view, date(computed_at)) prevents double-inserts if
 * the timer fires twice in the same day.
 *
 * TTC view is deferred — requires ≥180 days of history (methodology §3.3).
 * The testnet is too young; we'll start emitting TTC rows automatically once
 * agents cross the threshold.
 */

const CHAIN = process.env.SNAPSHOT_CHAIN ?? 'arc';
const BATCH_LOG_EVERY = 50;

async function main() {
  const startedAt = new Date();
  console.log(
    `[snapshot] starting daily snapshot · chain=${CHAIN} · methodology=${METHODOLOGY_VERSION}`,
  );

  // The pre-filter mirrors web/src/app/api/agents/route.ts ratedOnly:
  // feedback_count + jobs_completed + validation count >= 5. Validations are
  // joined via correlated subquery (uses idx_validations_agent).
  const agentRows = (await rawSql.unsafe(`
    SELECT agent_id::text AS agent_id
    FROM agents
    WHERE chain_id = $1
      AND (
        COALESCE(feedback_count, 0)
        + COALESCE(jobs_completed, 0)
        + (SELECT COUNT(*) FROM validations v WHERE v.agent_id = agents.agent_id AND v.chain_id = agents.chain_id)
      ) >= 5
  `, [CHAIN])) as Array<{ agent_id: string }>;

  console.log(`[snapshot] ${agentRows.length} potentially-rateable agents on ${CHAIN}`);

  let written = 0;
  let skippedUnrated = 0;
  let errors = 0;
  const now = new Date();

  for (let i = 0; i < agentRows.length; i++) {
    const agentId = agentRows[i].agent_id;
    try {
      const result = await rateAgent(BigInt(agentId), CHAIN, 'PIT');
      if (!result.rated) {
        skippedUnrated++;
        continue;
      }

      // v2.0 column reuse:
      //   ppd_30d  → completion_rate_smoothed (was probability of default)
      //   lgd      → forward_success           (was loss given default)
      //   ead_usdc → active_escrow_usdc        (was funded EAD)
      // Schema kept stable for now; column-rename migration is a separate
      // follow-up so existing snapshots in the table remain queryable while
      // the dashboards update. The semantic shift is captured in code +
      // methodology Appendix F v2.0 entry.
      const currentFlags = flagsToBitfield(result.flags);

      // Fetch the most recent snapshot BEFORE today, for transition diff.
      const prevRows = await db
        .select({
          tier: ratingSnapshots.tier,
          flags: ratingSnapshots.flags,
          interactionCount: ratingSnapshots.interactionCount,
        })
        .from(ratingSnapshots)
        .where(
          and(
            eq(ratingSnapshots.agentId, BigInt(agentId)),
            eq(ratingSnapshots.chainId, CHAIN),
            eq(ratingSnapshots.view, 'PIT'),
            lt(ratingSnapshots.computedAt, now),
          ),
        )
        .orderBy(desc(ratingSnapshots.computedAt))
        .limit(1);
      const prevSnapshot = prevRows[0] ?? null;

      await db
        .insert(ratingSnapshots)
        .values({
          chainId: CHAIN,
          agentId: BigInt(agentId),
          computedAt: now,
          tier: result.tier,
          ppd30d: String(result.factors.completion_rate_smoothed),
          lgd: String(result.factors.forward_success),
          eadUsdc: result.factors.active_escrow_usdc,
          confidence: result.confidence,
          flags: currentFlags,
          view: 'PIT',
          methodologyVersion: METHODOLOGY_VERSION,
          interactionCount: result.interaction_count,
        });

      // Emit transition rows (0+ per snapshot diff)
      const transitions = computeTransitions(
        prevSnapshot,
        {
          tier: result.tier,
          flags: currentFlags,
          score: result.score,
          computedAt: now,
          agentId: BigInt(agentId),
          chainId: CHAIN,
        },
        METHODOLOGY_VERSION,
      );
      if (transitions.length > 0) {
        await db.insert(tierTransitions).values(transitions);
      }

      written++;
    } catch (err) {
      errors++;
      console.warn(`[snapshot] error on agent ${agentId}: ${(err as Error).message}`);
    }

    if ((i + 1) % BATCH_LOG_EVERY === 0) {
      console.error(`[snapshot] progress: ${i + 1}/${agentRows.length}`);
    }
  }

  const elapsedSec = ((Date.now() - startedAt.getTime()) / 1000).toFixed(1);
  console.log(
    `[snapshot] done · written=${written} · skipped_unrated=${skippedUnrated} · errors=${errors} · ${elapsedSec}s`,
  );
}

// Only auto-run when invoked directly. When this file is imported (e.g. by
// backfill-transitions.ts which reuses computeTransitions), don't fire main().
if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[snapshot] failed:', err);
      process.exit(1);
    });
}
