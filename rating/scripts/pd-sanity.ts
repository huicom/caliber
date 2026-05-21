import 'dotenv/config';
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () {
  return this.toString();
};
import { db, sql as rawSql } from '@arc-agents/db';
import { rateAgent } from '../engine/rating';
import type { RatingResult } from '../engine/types';

const AGENT_COUNT = 50;
const TIER_ORDER = [
  'Caliber-AAA',
  'Caliber-AA',
  'Caliber-A',
  'Caliber-BBB',
  'Caliber-BB',
  'Caliber-B',
  'Caliber-CCC',
  'Caliber-CC',
  'Caliber-D',
  'UNRATED',
];

async function main() {
  console.log(`Rating ${AGENT_COUNT} random Arc agents using production engine...\n`);

  const agentRows = (await rawSql.unsafe(
    `SELECT agent_id::text FROM agents WHERE chain_id = 'arc' ORDER BY RANDOM() LIMIT ${AGENT_COUNT}`,
  )) as Array<{ agent_id: string }>;

  const histogram: Record<string, number> = {};
  const rows: Array<Record<string, string | number>> = [];

  for (let i = 0; i < agentRows.length; i++) {
    const agentId = agentRows[i].agent_id;
    try {
      const result = await rateAgent(BigInt(agentId), 'arc', 'PIT');

      if (result.rated) {
        histogram[result.rating] = (histogram[result.rating] ?? 0) + 1;
        rows.push({
          agent_id: result.agent_id,
          tier: result.rating,
          pd: result.ppd_30d,
          lgd: result.lgd,
          ead: result.ead_usdc,
          el: result.el_usdc,
          confidence: result.confidence,
          interactions: result.factors.interaction_count,
          total_terminal_jobs: result.factors.total_terminal_jobs,
          defaulted_jobs: result.factors.defaulted_jobs,
          base_pd: result.factors.base_ppd,
          logit: result.factors.logit,
          segment: result.factors.segment,
        });
      } else {
        histogram['UNRATED'] = (histogram['UNRATED'] ?? 0) + 1;
        rows.push({
          agent_id: result.agent_id,
          tier: 'UNRATED',
          pd: 0,
          lgd: 0,
          ead: '0',
          el: '0',
          confidence: '',
          interactions: result.interactions,
          total_terminal_jobs: 0,
          defaulted_jobs: 0,
          base_pd: 0,
          logit: 0,
          segment: result.reason,
        });
      }
    } catch (err) {
      console.warn(`Error rating ${agentId}: ${(err as Error).message}`);
    }

    if ((i + 1) % 10 === 0) {
      console.error(`Progress: ${i + 1}/${agentRows.length}`);
    }
  }

  console.log('\n=== Tier Histogram ===');
  for (const tier of TIER_ORDER) {
    const count = histogram[tier] ?? 0;
    const bar = '\u2588'.repeat(Math.min(count, 50));
    console.log(`  ${tier.padEnd(10)} ${String(count).padEnd(3)} ${bar}`);
  }

  const rated = rows.filter((r) => r.tier !== 'UNRATED').length;
  const unrated = rows.length - rated;
  console.log(`\nRated: ${rated} | Unrated: ${unrated}`);

  console.log('\n=== Agent Details (CSV) ===');
  const csvHeaders = 'agent_id,tier,pd,lgd,ead,el,confidence,interactions,total_terminal_jobs,defaulted_jobs,base_pd,logit,segment';
  console.log(csvHeaders);
  for (const r of rows) {
    console.log(
      `${r.agent_id},${r.tier},${r.pd},${r.lgd},${r.ead},${r.el},${r.confidence},${r.interactions},${r.total_terminal_jobs},${r.defaulted_jobs},${r.base_pd},${r.logit},${r.segment}`,
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('PD sanity check failed:', err);
    process.exit(1);
  });
