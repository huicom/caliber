import 'dotenv/config';
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () {
  return this.toString();
};
import { db, sql as rawSql, ratingSnapshots } from '@arc-agents/db';
import { rateAgent } from '../engine/rating';
import { METHODOLOGY_VERSION } from '../engine/version';

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

      await db
        .insert(ratingSnapshots)
        .values({
          chainId: CHAIN,
          agentId: BigInt(agentId),
          computedAt: now,
          tier: result.rating,
          ppd30d: String(result.ppd_30d),
          lgd: String(result.lgd),
          eadUsdc: result.ead_usdc,
          confidence: result.confidence,
          view: 'PIT',
          methodologyVersion: METHODOLOGY_VERSION,
          interactionCount: result.factors.interaction_count,
        });

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

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[snapshot] failed:', err);
    process.exit(1);
  });
