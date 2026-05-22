// Deduped IPFS metadata sweep — fetch each unique unfetched URI once, fan the
// result out to every agent sharing it. This is 10–100x cheaper than the naive
// per-agent loop when many agents reuse the same CID (as is the case with the
// dominant CID on Arc Testnet that 5,500+ agents share).
//
// Run from indexer/arc:  pnpm ipfs-sweep

import { db, agents, type AgentMetadata } from '@arc-agents/db';
import { eq, isNull, isNotNull, and, sql } from 'drizzle-orm';
import { fetchMetadataFromUri } from './lib/ipfs';
import { logger } from './lib/logger';

const CONCURRENCY = 8;

async function main() {
  const t0 = Date.now();

  // Skiplist — URIs we've already confirmed are dead/junk, no point retrying.
  //   arc-agent.example.com — placeholder URLs, never had real content
  //   bafkreibdi6623... — JPEG image (5.5K agents share this; JSON.parse will always fail)
  //   QmGasStation*, bafkreiexample*, bafkreibarc*, agent-metadata-Agent_2 — test/example CIDs
  const rows: any = await db.execute(sql`
    SELECT metadata_uri AS uri, COUNT(*)::int AS agent_count
    FROM agents
    WHERE metadata IS NULL
      AND metadata_uri IS NOT NULL
      AND metadata_uri != ''
      AND metadata_uri NOT LIKE 'https://arc-agent.example.com/%'
      AND metadata_uri NOT LIKE 'ipfs://bafkreibdi6623n3xpf7ymk62ckb4bo75o3qemwkpfvp5i25j%'
      AND metadata_uri NOT LIKE 'ipfs://QmGasStation%'
      AND metadata_uri NOT LIKE 'ipfs://bafkreiexample%'
      AND metadata_uri NOT LIKE 'ipfs://bafkreibar%'
      AND metadata_uri NOT LIKE 'ipfs://bafybeihive-agent-metadata%'
      AND metadata_uri NOT LIKE 'ipfs://agent-metadata-Agent_2%'
      AND metadata_uri NOT LIKE 'ipfs://QmAgentBounty%'
    GROUP BY metadata_uri
    ORDER BY agent_count DESC;
  `);
  const uris = (rows.rows ?? rows) as Array<{ uri: string; agent_count: number }>;
  logger.info(`[ipfs-sweep] ${uris.length} unique unfetched URIs covering ${uris.reduce((s, r) => s + r.agent_count, 0)} agents`);

  let ok = 0;
  let fail = 0;
  let agentsUpdated = 0;
  const queue = [...uris];

  const workers = Array.from({ length: CONCURRENCY }, async (_, workerId) => {
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) continue;
      const { uri, agent_count } = item;
      const tStart = Date.now();
      const metadata: AgentMetadata | null = await fetchMetadataFromUri(uri);
      const ms = Date.now() - tStart;

      if (!metadata) {
        fail++;
        if (queue.length % 50 === 0) {
          logger.info(`[ipfs-sweep] worker ${workerId} · queue=${queue.length} · ok=${ok} · fail=${fail}`);
        }
        continue;
      }
      // Fan out: update every agent that referenced this URI.
      const updateRes = await db
        .update(agents)
        .set({
          metadata,
          name: metadata.name ?? null,
          agentType: metadata.agent_type ?? null,
          capabilities: metadata.capabilities ?? null,
          updatedAt: new Date(),
        })
        .where(and(eq(agents.metadataUri, uri), isNull(agents.metadata)));
      ok++;
      agentsUpdated += agent_count;
      const name = (metadata.name ?? metadata.description ?? '').slice(0, 60);
      logger.info(`[ipfs-sweep] ok · uri=${uri.slice(0, 56)} · agents=${agent_count} · ${ms}ms · ${name}`);
    }
  });

  await Promise.all(workers);

  const elapsedS = Math.round((Date.now() - t0) / 1000);
  logger.info('===');
  logger.info(`[ipfs-sweep] DONE · unique_uris=${uris.length} · fetched_ok=${ok} · fetched_fail=${fail} · agents_updated=${agentsUpdated} · ${elapsedS}s`);
  process.exit(0);
}

void main().catch((e) => {
  logger.error('[ipfs-sweep] fatal', e);
  process.exit(1);
});
