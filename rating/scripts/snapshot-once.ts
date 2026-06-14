// On-demand snapshot for a single agent (WS-3). Runs rateAgent() for one agentId,
// writes a rating_snapshots row, and diffs it against the prior snapshot so a
// tier_transitions row is emitted on a change (e.g. a breach-driven tier_down).
//
// Reuses computeTransitions() from snapshot-daily.ts (the exact same diff rules
// the daily Sentinel uses) so an on-demand snapshot is indistinguishable from a
// scheduled one — same table, same transition kinds, same methodology stamp.
//
// Usage (from repo root):
//   pnpm --filter @arc-agents/rating snapshot:once -- --agent <id> [--chain arc]
//
// Prints the agent's BEFORE (prior snapshot) vs AFTER (this run) score + tier, and
// any tier_transitions rows emitted. Idempotent-ish: it always writes a fresh
// snapshot row; the daily unique index is per-day so two runs the same day reuse
// the same calendar slot only via the daily script — here we insert a new PIT row
// each time so the demo can show before→after within one day.

import 'dotenv/config';
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () {
  return this.toString();
};
import { db, sql, ratingSnapshots, tierTransitions } from '@arc-agents/db';
import { eq, and, desc, lt } from 'drizzle-orm';
import { rateAgent } from '../engine/rating';
import { METHODOLOGY_VERSION } from '../engine/version';
import { flagsToBitfield } from '../engine/types';
import { computeTransitions } from './snapshot-daily';

function parseArgs(argv: string[]): { agent: string; chain: string } {
  let agent = '';
  let chain = process.env.SNAPSHOT_CHAIN ?? 'arc';
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--agent') agent = argv[++i];
    else if (argv[i] === '--chain') chain = argv[++i];
    else if (/^--agent=/.test(argv[i])) agent = argv[i].split('=')[1];
    else if (/^--chain=/.test(argv[i])) chain = argv[i].split('=')[1];
  }
  if (!agent) {
    console.error('usage: snapshot:once -- --agent <id> [--chain arc]');
    process.exit(1);
  }
  return { agent, chain };
}

async function main() {
  const { agent, chain } = parseArgs(process.argv.slice(2));
  const agentId = BigInt(agent);
  const now = new Date();

  console.log(`[snapshot:once] agent=${agent} chain=${chain} methodology=${METHODOLOGY_VERSION}`);

  // Prior snapshot (BEFORE) for the diff + the printed comparison.
  const prevRows = await db
    .select({
      tier: ratingSnapshots.tier,
      flags: ratingSnapshots.flags,
      interactionCount: ratingSnapshots.interactionCount,
      ppd30d: ratingSnapshots.ppd30d,
      computedAt: ratingSnapshots.computedAt,
    })
    .from(ratingSnapshots)
    .where(
      and(
        eq(ratingSnapshots.agentId, agentId),
        eq(ratingSnapshots.chainId, chain),
        eq(ratingSnapshots.view, 'PIT'),
        lt(ratingSnapshots.computedAt, now),
      ),
    )
    .orderBy(desc(ratingSnapshots.computedAt))
    .limit(1);
  const prevSnapshot = prevRows[0] ?? null;

  // The prior snapshot's score, recovered from tier_transitions (which records the
  // integer score). rating_snapshots stores factors, not the composite score.
  let prevScore: number | null = null;
  const prevScoreRows = await sql<{ to_score: number | null }[]>`
    select to_score from tier_transitions
     where agent_id = ${agent} and chain_id = ${chain}
     order by at desc limit 1
  `;
  if (prevScoreRows.length) prevScore = prevScoreRows[0].to_score;

  const result = await rateAgent(agentId, chain, 'PIT');
  if (!result.rated) {
    console.log(`[snapshot:once] agent ${agent} is UNRATED (${result.reason}) — no snapshot written`);
    await sql.end();
    return;
  }

  const currentFlags = flagsToBitfield(result.flags);

  console.log('');
  console.log('  BEFORE (prior snapshot):');
  console.log(
    `    tier=${prevSnapshot?.tier ?? '(none)'}  score=${prevScore ?? '(unknown)'}  flags=${prevSnapshot?.flags ?? 0}`,
  );
  console.log('  AFTER  (this run):');
  console.log(
    `    tier=${result.tier}  score=${result.score}  flags=${currentFlags}  confidence=${result.confidence}`,
  );
  console.log('');

  // Write the AFTER snapshot row (same column reuse as snapshot-daily).
  await db.insert(ratingSnapshots).values({
    chainId: chain,
    agentId,
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

  // Diff → tier_transitions (same rules as the daily Sentinel).
  const transitions = computeTransitions(
    prevSnapshot,
    {
      tier: result.tier,
      flags: currentFlags,
      score: result.score,
      computedAt: now,
      agentId,
      chainId: chain,
    },
    METHODOLOGY_VERSION,
    prevScore,
  );

  if (transitions.length > 0) {
    await db.insert(tierTransitions).values(transitions);
    console.log(`[snapshot:once] emitted ${transitions.length} tier_transition row(s):`);
    for (const t of transitions) {
      console.log(
        `    ${t.kind.padEnd(14)} ${t.fromTier ?? '(none)'} → ${t.toTier}` +
          `  score ${t.fromScore ?? '?'} → ${t.toScore}`,
      );
    }
  } else {
    console.log('[snapshot:once] no transition (tier + flags unchanged vs prior snapshot)');
  }

  await sql.end();
}

main().catch((err) => {
  console.error('[snapshot:once] failed:', err);
  process.exit(1);
});
