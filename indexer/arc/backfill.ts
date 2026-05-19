import 'dotenv/config';
import { publicClient } from './lib/viem';
import { config, BATCH_SIZE } from './lib/config';
import { parseLog } from './lib/parsers';
import { applyEvents } from './lib/handlers';
import { getLastIndexedBlock, setLastIndexedBlock } from './lib/state';
import { backfillMissingMetadata, fetchTokenURI } from './lib/ipfs';
import { logger } from './lib/logger';
import { db, agents } from '@arc-agents/db';
import { eq } from 'drizzle-orm';

const CONTRACT_ADDRESSES = [
  config.IDENTITY_REGISTRY as `0x${string}`,
  config.REPUTATION_REGISTRY as `0x${string}`,
  config.VALIDATION_REGISTRY as `0x${string}`,
  config.AGENTIC_COMMERCE as `0x${string}`,
];

async function main() {
  logger.info('🔄 Starting Arc backfill indexer');
  logger.info(`RPC: ${config.ARC_RPC_URL}`);

  const chainHead = await publicClient.getBlockNumber();
  // Optional cap — set MAX_BLOCK in the env to stop the backfill early.
  // Used for hybrid runs where a slower archive RPC handles old blocks and
  // a fast local node handles the rest.
  const maxBlockEnv = process.env.MAX_BLOCK;
  const head = maxBlockEnv ? BigInt(maxBlockEnv) : chainHead;
  logger.info(`Chain head: ${chainHead}${maxBlockEnv ? ` | capped to: ${head}` : ''}`);

  let lastIndexed = await getLastIndexedBlock(config.DEPLOYMENT_BLOCK);
  logger.info(`Resuming from block: ${lastIndexed}`);

  while (lastIndexed < head) {
    const fromBlock = lastIndexed + 1n;
    const toBlock =
      fromBlock + BATCH_SIZE - 1n > head ? head : fromBlock + BATCH_SIZE - 1n;

    try {
      const logs = await publicClient.getLogs({
        address: CONTRACT_ADDRESSES,
        fromBlock,
        toBlock,
      });

      const events = logs
        .map(parseLog)
        .filter((e): e is NonNullable<typeof e> => e !== null);

      await applyEvents(events);

      const newAgents = events.filter((e) => e.kind === 'AgentRegistered');
      for (const ev of newAgents) {
        try {
          const uri = await fetchTokenURI(ev.agentId);
          if (uri) {
            await db
              .update(agents)
              .set({ metadataUri: uri })
              .where(eq(agents.agentId, ev.agentId));
          }
        } catch (err) {
          logger.warn(
            `Failed to fetch tokenURI for agent ${ev.agentId}`,
            err,
          );
        }
      }

      await setLastIndexedBlock(toBlock);

      const counts = events.reduce(
        (acc, e) => {
          acc[e.kind] = (acc[e.kind] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>,
      );

      logger.info(
        `✅ Blocks ${fromBlock}-${toBlock} | events: ${events.length}`,
        counts,
      );

      lastIndexed = toBlock;
    } catch (err) {
      logger.error(`Batch ${fromBlock}-${toBlock} failed, retrying in 5s`, err);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }

  // Skip the IPFS metadata sweep on capped runs — it should only fire once
  // at the end of the final leg.
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
