// One-off: rate every potentially-rateable agent against the snapshot's
// own filter (registered_at populated, age ≥14d), then bucket by
// (score, completed_jobs) so we can test multiple TIER_GATES combos
// without re-running snapshot:daily for each.
//
// Usage: pnpm --filter @arc-agents/rating tsx scripts/threshold-explore.ts

import 'dotenv/config';
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () {
  return this.toString();
};
import { sql as rawSql } from '@arc-agents/db';
import { rateAgent } from '../engine/rating';

const CHAIN = process.env.CHAIN ?? 'arc';

async function main() {
  console.log(`Threshold explorer · chain=${CHAIN}`);

  const rows = (await rawSql.unsafe(
    `SELECT agent_id::text FROM agents
       WHERE chain_id = $1
         AND registered_at IS NOT NULL
         AND registered_at <= NOW() - INTERVAL '14 days'
         AND registered_at_block > 0
       ORDER BY agent_id`,
    [CHAIN],
  )) as Array<{ agent_id: string }>;

  console.log(`Rating ${rows.length} eligible agents...`);

  const points: Array<{ agentId: string; score: number; jobs: number; interactions: number; rated: boolean; tier: string | null }> = [];
  let rated = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = await rateAgent(BigInt(rows[i].agent_id), CHAIN);
    if (r.rated) {
      rated++;
      points.push({
        agentId: rows[i].agent_id,
        score: r.score,
        jobs: r.factors.completed_jobs,
        interactions: r.interaction_count,
        rated: true,
        tier: r.tier,
      });
    }
    if ((i + 1) % 100 === 0) console.log(`  ${i + 1}/${rows.length}`);
  }
  console.log(`\nRated: ${rated}/${rows.length}\n`);

  // Combo R gold candidates (score >= 80 AND jobs >= 2, not flagged)
  console.log('Combo R — GOLD candidates (score≥80, jobs≥2, not Watch/Dormant):');
  console.log('  agent_id'.padEnd(12), 'score', 'jobs', 'interactions');
  console.log('  ' + '─'.repeat(44));
  const goldR = points
    .filter((p) => p.score >= 80 && p.jobs >= 2 && p.tier !== 'Watch' && p.tier !== 'Dormant')
    .sort((a, b) => b.score - a.score || b.jobs - a.jobs);
  for (const g of goldR) {
    console.log(`  #${g.agentId.padEnd(10)}`, String(g.score).padStart(5), String(g.jobs).padStart(4), String(g.interactions).padStart(12));
  }
  console.log(`  total: ${goldR.length}\n`);

  // Test many threshold combos
  const combos = [
    { name: 'R: Gold 80/2,  Silver 75/2,  Bronze 50/1', g: [80, 2], s: [75, 2], b: [50, 1] },
    { name: 'S: Gold 80/3,  Silver 75/2,  Bronze 50/1', g: [80, 3], s: [75, 2], b: [50, 1] },
    { name: 'T: Gold 80/2,  Silver 75/2,  Bronze 50/2', g: [80, 2], s: [75, 2], b: [50, 2] },
    { name: 'P: Gold 82/1,  Silver 75/1,  Bronze 50/1', g: [82, 1], s: [75, 1], b: [50, 1] },
  ];

  console.log('Combo'.padEnd(48), 'Gold', 'Silver', 'Bronze', 'Pending');
  console.log('─'.repeat(48 + 4 * 8));
  for (const c of combos) {
    let g = 0, s = 0, b = 0, p = 0;
    for (const pt of points) {
      // Skip Watch / Dormant — they're set by flags not score; we want
      // the score-driven tier distribution only.
      if (pt.tier === 'Watch' || pt.tier === 'Dormant') continue;
      if (pt.score >= c.g[0] && pt.jobs >= c.g[1]) g++;
      else if (pt.score >= c.s[0] && pt.jobs >= c.s[1]) s++;
      else if (pt.score >= c.b[0] && pt.jobs >= c.b[1]) b++;
      else p++;
    }
    console.log(
      c.name.padEnd(48),
      String(g).padStart(4),
      String(s).padStart(6),
      String(b).padStart(6),
      String(p).padStart(7),
    );
  }

  // Also dump score histogram + jobs distribution for inspection
  console.log('\nScore distribution (rated agents, not flagged):');
  const byScore: Record<number, number> = {};
  for (const pt of points) {
    if (pt.tier === 'Watch' || pt.tier === 'Dormant') continue;
    byScore[pt.score] = (byScore[pt.score] ?? 0) + 1;
  }
  Object.entries(byScore)
    .map(([k, v]) => ({ s: Number(k), n: v }))
    .sort((a, b) => a.s - b.s)
    .forEach(({ s, n }) => {
      const bar = '█'.repeat(Math.min(50, n));
      console.log(`  score ${String(s).padStart(3)} | ${bar} ${n}`);
    });

  // Optional: dump csv of (score, jobs) for further analysis
  console.log('\nDone.');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
