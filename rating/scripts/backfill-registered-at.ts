import 'dotenv/config';
import { sql } from '@arc-agents/db';

const BLOCK_TIME_SECONDS: Record<string, number> = {
  arc: 1,
  base: 2,
};

async function main() {
  const rows = (await sql.unsafe(
    `SELECT agent_id, chain_id, registered_at_block::text AS block_str
     FROM agents
     WHERE registered_at IS NULL AND registered_at_block > 0
     ORDER BY chain_id, registered_at_block`,
  )) as Array<{ agent_id: string; chain_id: string; block_str: string }>;

  console.log(`Found ${rows.length} agents with NULL registered_at\n`);

  if (rows.length === 0) {
    console.log('Nothing to backfill.');
    process.exit(0);
  }

  // Per-chain max reference block for block-time math
  const maxBlockPerChain = new Map<string, bigint>();
  for (const r of rows) {
    const bn = BigInt(r.block_str);
    const existing = maxBlockPerChain.get(r.chain_id);
    if (!existing || bn > existing) maxBlockPerChain.set(r.chain_id, bn);
  }

  const now = new Date();
  let updated = 0;

  for (const row of rows) {
    const chainId = row.chain_id;
    const blockNumber = BigInt(row.block_str);
    const refBlock = maxBlockPerChain.get(chainId)!;
    const blockTimeSec = BLOCK_TIME_SECONDS[chainId] ?? 1;
    const blocksAgo = refBlock >= blockNumber ? refBlock - blockNumber : 0n;
    const secondsAgo = Number(blocksAgo) * blockTimeSec;
    const ts = new Date(now.getTime() - secondsAgo * 1000);

    await sql.unsafe(
      `UPDATE agents SET registered_at = $1, updated_at = NOW()
       WHERE agent_id = $2 AND chain_id = $3 AND registered_at IS NULL`,
      [ts.toISOString(), row.agent_id, chainId],
    );
    updated++;

    if (updated % 1000 === 0) {
      console.log(`Progress: ${updated}/${rows.length}`);
    }
  }

  console.log(`\nDone. Updated: ${updated}`);

  const remaining = await sql.unsafe(
    `SELECT COUNT(*)::text AS c FROM agents WHERE registered_at IS NULL AND registered_at_block > 0`,
  ) as Array<{ c: string }>;
  console.log(`Remaining NULL: ${remaining[0]?.c ?? '?'}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Backfill failed:', err);
    process.exit(1);
  });
