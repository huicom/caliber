import { type Log, type PublicClient } from 'viem';
import { db, indexerState } from '@arc-agents/db';
import { eq } from 'drizzle-orm';
import type { ChainConfig } from './chain-config';

export interface ProgressEvent {
  blocksDone: bigint;
  blocksTotal: bigint;
  elapsedMs: number;
  etaMs: number;
  cuUsedEstimate: number;
  rowsInsertedSoFar: { agents: number; feedback: number; validations: number; jobs: number; jobEvents: number };
}

export interface BackfillResult {
  lastBlock: bigint;
  totals: { agents: number; feedback: number; validations: number; jobs: number; jobEvents: number };
  cuUsedEstimate: number;
  durationMs: number;
}

const CU_PER_CALL = 75;
const CHECKPOINT_INTERVAL = 5000n;

function checkpointKey(chainName: string): string {
  return `backfill:${chainName}:last_block`;
}

async function readCheckpoint(key: string): Promise<bigint | null> {
  const row = await db
    .select({ value: indexerState.value })
    .from(indexerState)
    .where(eq(indexerState.key, key))
    .limit(1);
  if (row.length === 0 || row[0].value == null) return null;
  return BigInt(row[0].value);
}

async function writeCheckpoint(key: string, block: bigint): Promise<void> {
  await db
    .insert(indexerState)
    .values({ key, value: block.toString() })
    .onConflictDoUpdate({
      target: indexerState.key,
      set: { value: block.toString(), updatedAt: new Date() },
    });
}

function buildContractAddrs(chain: ChainConfig): `0x${string}`[] {
  const addrs: `0x${string}`[] = [];
  const candidates = [
    chain.contracts.identityRegistry,
    chain.contracts.reputationRegistry,
    chain.contracts.validationRegistry,
    chain.contracts.agenticCommerce,
  ];
  for (const addr of candidates) {
    if (addr && addr !== '0x0000000000000000000000000000000000000000' && addr.trim() !== '') {
      addrs.push(addr);
    }
  }
  return addrs;
}

export interface BackfillOptions {
  chain: ChainConfig;
  client: PublicClient;
  fromBlock: bigint;
  toBlock: bigint | 'latest';
  batchSize: bigint;
  reset?: boolean;
  parseLog: (log: Log) => any;
  applyEvents: (events: any[], chainId?: string) => Promise<void>;
  onProgress?: (p: ProgressEvent) => void;
}

export async function runBackfill(opts: BackfillOptions): Promise<BackfillResult> {
  const key = checkpointKey(opts.chain.name);
  const startTime = Date.now();
  let callCount = 0;

  let fromBlock: bigint;
  if (opts.reset) {
    fromBlock = opts.fromBlock;
  } else {
    const cp = await readCheckpoint(key);
    fromBlock = cp ? cp : opts.fromBlock;
  }

  let toBlock: bigint;
  if (opts.toBlock === 'latest') {
    toBlock = await opts.client.getBlockNumber();
  } else {
    toBlock = opts.toBlock;
  }

  if (fromBlock >= toBlock) {
    return {
      lastBlock: toBlock,
      totals: { agents: 0, feedback: 0, validations: 0, jobs: 0, jobEvents: 0 },
      cuUsedEstimate: 0,
      durationMs: Date.now() - startTime,
    };
  }

  const contractAddrs = buildContractAddrs(opts.chain);
  if (contractAddrs.length === 0) {
    throw new Error(`No valid contract addresses for chain ${opts.chain.name}`);
  }
  console.log(`🔗 Contract addresses: ${JSON.stringify(contractAddrs)}`);

  const blocksTotal = toBlock - fromBlock;
  const totals = { agents: 0, feedback: 0, validations: 0, jobs: 0, jobEvents: 0 };

  let cursor = fromBlock;
  let retries = 0;
  const MAX_RETRIES = 5;
  const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 16_000];

  while (cursor < toBlock) {
    const batchEnd = cursor + opts.batchSize - 1n > toBlock ? toBlock : cursor + opts.batchSize - 1n;

    try {
      const logs = await opts.client.getLogs({
        address: contractAddrs,
        fromBlock: cursor,
        toBlock: batchEnd,
      });

      callCount++;

      const events = logs
        .map(opts.parseLog)
        .filter((e: any) => e !== null);

      await opts.applyEvents(events, opts.chain.id);

      for (const e of events) {
        if (e.kind === 'AgentRegistered') totals.agents++;
        else if (e.kind === 'FeedbackGiven') totals.feedback++;
        else if (e.kind === 'ValidationRequested' || e.kind === 'ValidationResponded') totals.validations++;
        else if (e.kind === 'JobCreated' || e.kind === 'BudgetSet' || e.kind === 'JobFunded' ||
                 e.kind === 'JobSubmitted' || e.kind === 'JobCompleted' || e.kind === 'JobRejected') {
          if (e.kind === 'JobCreated' || e.kind === 'BudgetSet' || e.kind === 'JobFunded' ||
              e.kind === 'JobSubmitted' || e.kind === 'JobCompleted' || e.kind === 'JobRejected') totals.jobs++;
          totals.jobEvents++;
        }
      }

      const blocksDone = batchEnd - fromBlock;
      const elapsedMs = Date.now() - startTime;
      const blocksPerMs = Number(blocksDone) / Math.max(elapsedMs, 1);
      const etaMs = blocksPerMs > 0 ? Number(blocksTotal - blocksDone) / blocksPerMs : 0;

      if (opts.onProgress) {
        opts.onProgress({
          blocksDone,
          blocksTotal,
          elapsedMs,
          etaMs,
          cuUsedEstimate: callCount * CU_PER_CALL,
          rowsInsertedSoFar: { ...totals },
        });
      }

      if ((batchEnd - fromBlock) % CHECKPOINT_INTERVAL === 0n || batchEnd === toBlock) {
        await writeCheckpoint(key, batchEnd);
      }

      cursor = batchEnd + 1n;
      retries = 0;
    } catch (err: any) {
      if (err?.message?.includes('rate') || err?.status === 429 || err?.code === 429) {
        if (retries >= MAX_RETRIES) {
          throw new Error(
            `Rate-limited after ${MAX_RETRIES} retries at block ${cursor}. ` +
            `Last successful block: ${cursor - 1n}. ${err.message}`,
          );
        }
        const delay = BACKOFF_MS[retries];
        console.warn(`Rate-limited, backing off ${delay}ms (attempt ${retries + 1}/${MAX_RETRIES})`);
        await new Promise((r) => setTimeout(r, delay));
        retries++;
        continue;
      }
      throw err;
    }
  }

  await writeCheckpoint(key, toBlock);

  const durationMs = Date.now() - startTime;
  return {
    lastBlock: toBlock,
    totals,
    cuUsedEstimate: callCount * CU_PER_CALL,
    durationMs,
  };
}
