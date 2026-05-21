import 'dotenv/config';
import { publicClient } from './lib/viem';
import { config, BATCH_SIZE } from './lib/config';
import { parseLog } from './lib/parsers';
import { applyEvents } from './lib/handlers';
import { logger } from './lib/logger';
import { runBackfill } from '../../indexer/shared/backfill-core';
import { CHAINS } from '../../indexer/shared/chain-config';
import { backfillMissingMetadata } from './lib/ipfs';

async function main() {
  logger.info('🔄 Starting Arc backfill indexer');
  logger.info(`RPC: ${config.ARC_RPC_URL}`);

  const head = await publicClient.getBlockNumber();
  const maxBlockEnv = process.env.MAX_BLOCK;
  const toBlock = maxBlockEnv ? BigInt(maxBlockEnv) : head;
  logger.info(`Chain head: ${head}${maxBlockEnv ? ` | capped to: ${toBlock}` : ''}`);

  const result = await runBackfill({
    chain: CHAINS.arc,
    client: publicClient,
    fromBlock: BigInt(config.DEPLOYMENT_BLOCK),
    toBlock,
    batchSize: BATCH_SIZE,
    parseLog,
    applyEvents,
    onProgress: (p) => {
      logger.info(
        `✅ Blocks ${p.blocksDone}/${p.blocksTotal} | cu ~${p.cuUsedEstimate}`,
        p.rowsInsertedSoFar,
      );
    },
  });

  logger.info('Backfill complete', result);

  if (!maxBlockEnv) {
    logger.info('📦 Backfilling missing IPFS metadata...');
    await backfillMissingMetadata();
  } else {
    logger.info(`⏭️  Skipping IPFS metadata sweep (MAX_BLOCK=${maxBlockEnv})`);
  }

  logger.info('🎉 Backfill complete');
  process.exit(0);
}

main().catch((err) => {
  logger.error('Fatal error', err);
  process.exit(1);
});
