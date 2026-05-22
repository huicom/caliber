import {
  config,
  IPFS_CONCURRENCY,
  IPFS_TIMEOUT_MS,
  IPFS_GATEWAY,
  IPFS_GATEWAYS,
  IPFS_MAX_ATTEMPTS,
} from './config';
import { db, agents, classify, type AgentMetadata } from '@arc-agents/db';
import { eq, and, isNull, isNotNull, gt, asc } from 'drizzle-orm';
import { publicClient } from './viem';
import { IDENTITY_ABI } from './abis';
import { logger } from './logger';

// A permanent fail (404, JSON parse) tells the outer loop not to bother
// retrying. A transient fail (timeout, network) triggers backoff + retry.
type FetchOutcome =
  | { kind: 'ok'; data: AgentMetadata; gateway: string }
  | { kind: 'permanent'; status?: number; gateway: string }
  | { kind: 'transient'; reason: string; gateway: string };

function gatewayUrlFor(uri: string, gateway: string): string {
  if (uri.startsWith('ipfs://')) return gateway + uri.replace('ipfs://', '');
  // For non-ipfs:// URIs (e.g. https://gateway.x/ipfs/CID, or a direct https URL),
  // fall through and fetch as-is. The gateway parameter is only used for ipfs://.
  return uri;
}

async function tryFetchOnce(uri: string, gateway: string): Promise<FetchOutcome> {
  const url = gatewayUrlFor(uri, gateway);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), IPFS_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      // 4xx (except 408/429) is permanent — content gone, won't come back
      const isTransientStatus = res.status === 408 || res.status === 429 || res.status >= 500;
      return isTransientStatus
        ? { kind: 'transient', reason: `http ${res.status}`, gateway }
        : { kind: 'permanent', status: res.status, gateway };
    }
    const data = (await res.json()) as AgentMetadata;
    return { kind: 'ok', data, gateway };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    // AbortError (timeout) or network → transient. JSON parse → permanent.
    if (msg.includes('JSON') || msg.includes('Unexpected token')) {
      return { kind: 'permanent', gateway };
    }
    return { kind: 'transient', reason: msg.slice(0, 60), gateway };
  } finally {
    clearTimeout(timeout);
  }
}

// Race-fetch: fire all gateways at once. First 'ok' wins; permanent fails for
// non-ipfs:// URIs are taken as authoritative (the URI itself is dead). For
// ipfs:// URIs, only declare permanent if *all* gateways agree it's permanent.
async function raceFetchUri(uri: string): Promise<FetchOutcome> {
  const isIpfs = uri.startsWith('ipfs://');
  const gateways = isIpfs ? IPFS_GATEWAYS : [uri]; // non-ipfs: one shot to the URL itself

  const outcomes: FetchOutcome[] = [];
  let resolved: FetchOutcome | null = null;

  await new Promise<void>((resolve) => {
    let remaining = gateways.length;
    for (const gw of gateways) {
      void tryFetchOnce(uri, gw).then((o) => {
        if (resolved) return;
        if (o.kind === 'ok') {
          resolved = o;
          resolve();
          return;
        }
        outcomes.push(o);
        if (--remaining === 0) {
          resolve();
        }
      });
    }
  });

  if (resolved) return resolved;
  // No winner. Prefer 'permanent' only if every gateway said so (or 1 gateway for non-ipfs).
  const allPermanent = outcomes.length > 0 && outcomes.every((o) => o.kind === 'permanent');
  if (allPermanent) {
    return { kind: 'permanent', gateway: 'all' };
  }
  return { kind: 'transient', reason: 'all gateways failed', gateway: 'all' };
}

export interface FetchStats {
  ok: number;
  permanent: number;
  transient: number;
  attempts: number;
}

async function fetchWithRetry(uri: string, stats: FetchStats): Promise<AgentMetadata | null> {
  for (let attempt = 1; attempt <= IPFS_MAX_ATTEMPTS; attempt++) {
    stats.attempts++;
    const outcome = await raceFetchUri(uri);
    if (outcome.kind === 'ok') {
      stats.ok++;
      return outcome.data;
    }
    if (outcome.kind === 'permanent') {
      stats.permanent++;
      return null;
    }
    // transient — back off and try again
    if (attempt < IPFS_MAX_ATTEMPTS) {
      const delayMs = 1000 * 2 ** attempt; // 2s, 4s, ...
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  stats.transient++;
  return null;
}

// Kept for back-compat with callers (live.ts may import this name).
export async function fetchMetadataFromUri(uri: string): Promise<AgentMetadata | null> {
  // Single best-effort call for live-path callers — no retry, just race.
  const outcome = await raceFetchUri(uri);
  return outcome.kind === 'ok' ? outcome.data : null;
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

export async function backfillMissingMetadata(): Promise<FetchStats> {
  let total = 0;
  const stats: FetchStats = { ok: 0, permanent: 0, transient: 0, attempts: 0 };
  let cursor = 0n;
  const BATCH = 500;
  const t0 = Date.now();

  logger.info(
    `[ipfs-backfill] starting · gateways=${IPFS_GATEWAYS.length} · timeout=${IPFS_TIMEOUT_MS}ms · concurrency=${IPFS_CONCURRENCY} · max_attempts=${IPFS_MAX_ATTEMPTS}`,
  );

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

    logger.info(
      `[ipfs-backfill] batch · cursor=${cursor} · size=${missing.length} · scanned=${total} · ok=${stats.ok} · perm=${stats.permanent} · trans=${stats.transient}`,
    );

    const queue = [...missing];
    const workers = Array.from({ length: IPFS_CONCURRENCY }, async () => {
      while (queue.length > 0) {
        const agent = queue.shift();
        if (!agent || !agent.metadataUri) continue;

        const metadata = await fetchWithRetry(agent.metadataUri, stats);
        if (metadata) {
          // F2 categorization runs inline now that we have metadata. Pure
          // function, no IO, ~microseconds — adds no meaningful overhead to
          // the IPFS-bound metadata sweep. Embeddings get filled in by the
          // caliber-embed-pending timer (see deploy/) on a separate cadence.
          const { category } = classify({
            name: metadata.name,
            agent_type: metadata.agent_type,
            description: (metadata as Record<string, unknown>).description as string | undefined,
            capabilities: metadata.capabilities,
          });
          await db
            .update(agents)
            .set({
              metadata,
              name: metadata.name ?? null,
              agentType: metadata.agent_type ?? null,
              capabilities: metadata.capabilities ?? null,
              // Always write what classify() returns (including 'other').
              // NULL means "never classified"; 'other' means "tried and the
              // description didn't match any rule strongly enough". The
              // Discover UI filters on slug equality, so both render the
              // same to users — but the distinction matters for analytics.
              category,
              updatedAt: new Date(),
            })
            .where(eq(agents.agentId, agent.agentId));
        }
      }
    });

    await Promise.all(workers);
    total += missing.length;
    cursor = missing[missing.length - 1].agentId;
  }

  const elapsedS = Math.round((Date.now() - t0) / 1000);
  logger.info(
    `[ipfs-backfill] done · scanned=${total} · ok=${stats.ok} · permanent=${stats.permanent} · transient=${stats.transient} · attempts=${stats.attempts} · ${elapsedS}s`,
  );
  return stats;
}

// Suppress the unused import warning when IPFS_GATEWAY (the legacy single-gateway
// constant) isn't referenced anywhere in this file after the rewrite. Kept exported
// so existing callers (live.ts) don't break.
void IPFS_GATEWAY;
