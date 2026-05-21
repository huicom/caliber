import { config, IPFS_CONCURRENCY, IPFS_TIMEOUT_MS, IPFS_GATEWAY } from './config';
import { db, agents, type AgentMetadata } from '@arc-agents/db';
import { eq, and, isNull, isNotNull, gt, asc } from 'drizzle-orm';
import { publicClient } from './viem';
import { IDENTITY_ABI } from './abis';
import { logger } from './logger';

export async function fetchMetadataFromUri(uri: string): Promise<AgentMetadata | null> {
  let url = uri;
  if (uri.startsWith('ipfs://')) {
    url = IPFS_GATEWAY + uri.replace('ipfs://', '');
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), IPFS_TIMEOUT_MS);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) return null;
    const data = (await res.json()) as AgentMetadata;
    return data;
  } catch {
    return null;
  }
}

export async function fetchTokenURI(agentId: bigint): Promise<string | null> {
  try {
    const uri = await publicClient.readContract({
      address: config.IDENTITY_REGISTRY as `0x${string}`,
      abi: IDENTITY_ABI,
      functionName: 'tokenURI',
      args: [agentId],
    });
    return uri ?? null;
  } catch {
    return null;
  }
}

export async function backfillMissingMetadata(): Promise<void> {
  // Cursor-paginate by agent_id so IPFS fetch failures skip forward instead
  // of looping forever on the same NULL-metadata batch.
  let total = 0;
  let fetched = 0;
  let cursor = 0n;
  const BATCH = 500;

  while (true) {
    const missing = await db
      .select()
      .from(agents)
      .where(
        and(
          isNull(agents.metadata),
          isNotNull(agents.metadataUri),
          gt(agents.agentId, cursor),
        ),
      )
      .orderBy(asc(agents.agentId))
      .limit(BATCH);

    if (missing.length === 0) break;

    logger.info(`Fetching metadata for ${missing.length} agents (cursor: ${cursor}, total scanned: ${total}, fetched: ${fetched})`);

    const queue = [...missing];
    const workers = Array.from({ length: IPFS_CONCURRENCY }, async () => {
      while (queue.length > 0) {
        const agent = queue.shift();
        if (!agent || !agent.metadataUri) continue;

        const metadata = await fetchMetadataFromUri(agent.metadataUri);
        if (metadata) {
          await db
            .update(agents)
            .set({
              metadata,
              name: metadata.name ?? null,
              agentType: metadata.agent_type ?? null,
              capabilities: metadata.capabilities ?? null,
              updatedAt: new Date(),
            })
            .where(eq(agents.agentId, agent.agentId));
          fetched++;
        }
      }
    });

    await Promise.all(workers);
    total += missing.length;
    cursor = missing[missing.length - 1].agentId;
  }

  logger.info(`Metadata backfill complete — ${total} scanned, ${fetched} fetched`);
}
