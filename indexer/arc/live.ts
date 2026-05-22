import 'dotenv/config';
import { config } from './lib/config';
import { publicClient } from './lib/viem';
import { createWsClient } from './lib/ws-client';
import { parseLog, type ParsedEvent } from './lib/parsers';
import { applyEvents } from './lib/handlers';
import { getLastIndexedBlock, setLastIndexedBlock } from './lib/state';
import { notifyEvents } from './lib/notify';
import { fetchTokenURI, fetchMetadataFromUri } from './lib/ipfs';
import { classify } from '@arc-agents/db';
import { logger } from './lib/logger';
import { db, agents } from '@arc-agents/db';
import { eq } from 'drizzle-orm';

const CONTRACT_ADDRESSES = [
  config.IDENTITY_REGISTRY as `0x${string}`,
  config.REPUTATION_REGISTRY as `0x${string}`,
  config.VALIDATION_REGISTRY as `0x${string}`,
  config.AGENTIC_COMMERCE as `0x${string}`,
];

async function catchUpToHead(lastIndexed: bigint, head: bigint): Promise<bigint> {
  if (lastIndexed >= head) return lastIndexed;

  logger.info(`Catching up: ${lastIndexed + 1n} → ${head}`);

  const BATCH = 1000n;
  let cursor = lastIndexed;

  while (cursor < head) {
    const fromBlock = cursor + 1n;
    const toBlock =
      fromBlock + BATCH - 1n > head ? head : fromBlock + BATCH - 1n;

    const logs = await publicClient.getLogs({
      address: CONTRACT_ADDRESSES,
      fromBlock,
      toBlock,
    });

    const events = logs
      .map(parseLog)
      .filter((e): e is NonNullable<typeof e> => e !== null);
    await applyEvents(events);
    if (events.length > 0) {
      await notifyEvents(toBlock, events);
    }

    await processNewAgentMetadata(events);

    await setLastIndexedBlock(toBlock);
    cursor = toBlock;
    logger.info(`Caught up to block ${toBlock} (${events.length} events)`);
  }

  return cursor;
}

async function processNewAgentMetadata(
  events: ParsedEvent[],
): Promise<void> {
  for (const e of events) {
    if (e.kind !== 'AgentRegistered') continue;
    try {
      const uri = await fetchTokenURI(e.agentId);
      if (!uri) continue;

      const metadata = await fetchMetadataFromUri(uri);
      // F2 categorization runs inline. Returns 'other' when score below
      // threshold; we store NULL for 'other' so the Discover queries treat
      // it the same as "uncategorized" (already the convention).
      // Write 'other' literally when classify scores below threshold —
      // mirrors the offline backfill convention (NULL = never classified,
      // 'other' = tried and didn't fit any rule).
      let category: string | null = null;
      if (metadata) {
        category = classify({
          name: metadata.name,
          agent_type: metadata.agent_type,
          description: (metadata as Record<string, unknown>).description as string | undefined,
          capabilities: metadata.capabilities,
        }).category;
      }
      await db
        .update(agents)
        .set({
          metadataUri: uri,
          metadata: metadata ?? null,
          name: metadata?.name ?? null,
          agentType: metadata?.agent_type ?? null,
          capabilities: metadata?.capabilities ?? null,
          category,
          updatedAt: new Date(),
        })
        .where(eq(agents.agentId, e.agentId));
    } catch (err) {
      logger.warn(`Failed to fetch metadata for agent ${e.agentId}`, err);
    }
  }
}

async function processBlock(blockNumber: bigint): Promise<void> {
  try {
    const logs = await publicClient.getLogs({
      address: CONTRACT_ADDRESSES,
      fromBlock: blockNumber,
      toBlock: blockNumber,
    });

    const events = logs
      .map(parseLog)
      .filter((e): e is NonNullable<typeof e> => e !== null);

    if (events.length > 0) {
      await applyEvents(events);
      await notifyEvents(blockNumber, events);
      processNewAgentMetadata(events).catch((err) =>
        logger.warn('Metadata fetch failed', err),
      );
      logger.info(`📦 Block ${blockNumber}: ${events.length} events processed`);
    }

    await setLastIndexedBlock(blockNumber);
  } catch (err) {
    logger.error(`Failed to process block ${blockNumber}`, err);
    throw err;
  }
}

async function runLive(): Promise<never> {
  let attempt = 0;

  while (true) {
    try {
      attempt++;
      logger.info(`🔌 Connecting to WebSocket (attempt ${attempt})...`);

      const wsClient = createWsClient();

      const head = await publicClient.getBlockNumber();
      const lastIndexed = await getLastIndexedBlock(0n);
      if (lastIndexed < head) {
        await catchUpToHead(lastIndexed, head);
      }

      logger.info('✅ Live subscription active. Watching for new blocks...');
      attempt = 0;

      let lastProcessedBlock = await getLastIndexedBlock(0n);

      const unwatch = wsClient.watchBlockNumber({
        onBlockNumber: async (blockNumber) => {
          try {
            if (blockNumber > lastProcessedBlock + 2n) {
              logger.warn(
                `Gap detected: ${lastProcessedBlock + 1n} → ${blockNumber - 1n}, catching up`,
              );
              await catchUpToHead(lastProcessedBlock, blockNumber - 1n);
            }
            await processBlock(blockNumber);
            lastProcessedBlock = blockNumber;
          } catch (err) {
            logger.error(`Error processing block ${blockNumber}`, err);
          }
        },
        onError: (err) => {
          logger.error('WebSocket error', err);
        },
      });

      await new Promise<never>((_, reject) => {
        const cleanup = () => {
          unwatch();
          reject(new Error('signal'));
        };
        process.once('SIGINT', cleanup);
        process.once('SIGTERM', cleanup);
      });
    } catch (err) {
      if (err instanceof Error && err.message === 'signal') {
        logger.info('Shutting down live listener');
        process.exit(0);
      }
      const delayMs = Math.min(60_000, 1000 * Math.pow(2, attempt));
      logger.warn(`Disconnected. Reconnecting in ${delayMs}ms...`, err);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

runLive().catch((err) => {
  logger.error('Fatal in live loop', err);
  process.exit(1);
});
