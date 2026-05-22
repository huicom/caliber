import 'dotenv/config';
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () {
  return this.toString();
};
import { sql as rawSql } from '@arc-agents/db';
import { rateAgent } from '../engine/rating';
import { TIER_ORDER, type CaliberTier } from '../engine/types';

// Caliber Rating v2.0 sanity check.
// Runs the new engine over a sample (or all) rateable agents and prints
// a tier histogram + per-tier score range + flag distribution. Replaces
// pd-sanity.ts which was tied to v1's PD output.

const SAMPLE = Number(process.env.SAMPLE ?? '50');
const CHAIN = process.env.CHAIN ?? 'arc';

async function main() {
  console.log(`Score-sanity check · chain=${CHAIN} · sample=${SAMPLE}`);
  console.log('');

  const agentRows = (await rawSql.unsafe(
    `SELECT agent_id::text FROM agents WHERE chain_id = $1 ORDER BY RANDOM() LIMIT ${SAMPLE}`,
    [CHAIN],
  )) as Array<{ agent_id: string }>;

  const histogram: Record<string, number> = {
    Established: 0,
    Proven: 0,
    Emerging: 0,
    Provisional: 0,
    Watch: 0,
    Inactive: 0,
    UNRATED: 0,
  };
  const tierScores: Record<CaliberTier, number[]> = {
    Established: [],
    Proven: [],
    Emerging: [],
    Provisional: [],
    Watch: [],
    Inactive: [],
  };
  const flagCounts: Record<string, number> = {};
  const rows: Array<Record<string, string | number>> = [];

  for (let i = 0; i < agentRows.length; i++) {
    const agentId = agentRows[i].agent_id;
    try {
      const result = await rateAgent(BigInt(agentId), CHAIN, 'PIT');
      if (result.rated) {
        histogram[result.tier] = (histogram[result.tier] ?? 0) + 1;
        tierScores[result.tier].push(result.score);
        for (const f of result.flags) flagCounts[f] = (flagCounts[f] ?? 0) + 1;
        rows.push({
          agent_id: result.agent_id,
          tier: result.tier,
          score: result.score,
          confidence: result.confidence,
          flags: result.flags.join('|'),
          interactions: result.interaction_count,
          completed: result.factors.completed_jobs,
          disputed: result.factors.disputed_jobs,
          in_flight: result.factors.in_flight_jobs,
          smoothed_completion: result.factors.completion_rate_smoothed.toFixed(4),
          forward_success: result.factors.forward_success.toFixed(4),
          network: result.factors.network_endorsement,
          latency: result.factors.latency_consistency,
          active_escrow: result.factors.active_escrow_usdc,
        });
      } else {
        histogram.UNRATED++;
        rows.push({
          agent_id: result.agent_id,
          tier: 'UNRATED',
          score: 0,
          confidence: '',
          flags: '',
          interactions: result.interactions,
          completed: 0,
          disputed: 0,
          in_flight: 0,
          smoothed_completion: '',
          forward_success: '',
          network: 0,
          latency: 0,
          active_escrow: '0',
        });
      }
    } catch (err) {
      console.warn(`Error rating ${agentId}: ${(err as Error).message}`);
    }
    if ((i + 1) % 25 === 0) {
      console.error(`Progress: ${i + 1}/${agentRows.length}`);
    }
  }

  console.log('=== Tier Histogram ===');
  for (const tier of [...TIER_ORDER, 'UNRATED' as const]) {
    const count = histogram[tier] ?? 0;
    const bar = '█'.repeat(Math.min(count, 50));
    let scoreRange = '';
    if (tier !== 'UNRATED' && tierScores[tier as CaliberTier].length > 0) {
      const scores = tierScores[tier as CaliberTier];
      const min = Math.min(...scores);
      const max = Math.max(...scores);
      const mean = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
      scoreRange = ` (score ${min}-${max}, mean ${mean})`;
    }
    console.log(`  ${tier.padEnd(13)} ${String(count).padEnd(3)} ${bar}${scoreRange}`);
  }

  console.log('\n=== Flag Distribution ===');
  if (Object.keys(flagCounts).length === 0) {
    console.log('  (no flags fired in this sample)');
  } else {
    for (const [flag, count] of Object.entries(flagCounts).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${flag.padEnd(28)} ${count}`);
    }
  }

  const rated = rows.filter((r) => r.tier !== 'UNRATED').length;
  const unrated = rows.length - rated;
  console.log(`\nRated: ${rated} | Unrated: ${unrated}\n`);

  console.log('=== Agent Details (CSV) ===');
  const csvHeaders = 'agent_id,tier,score,confidence,flags,interactions,completed,disputed,in_flight,smoothed_completion,forward_success,network,latency,active_escrow';
  console.log(csvHeaders);
  for (const r of rows) {
    console.log(
      `${r.agent_id},${r.tier},${r.score},${r.confidence},${r.flags},${r.interactions},${r.completed},${r.disputed},${r.in_flight},${r.smoothed_completion},${r.forward_success},${r.network},${r.latency},${r.active_escrow}`,
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Score sanity check failed:', err);
    process.exit(1);
  });
