# Phase 2 — Historical Backfill Indexer

> **Goal:** Scan every Arc testnet block from contract deployment to current head. Populate Postgres with every agent, feedback, validation, and job ever recorded.

**Estimated time:** 4 hours (build) + 30 min – 2 hours (running the actual backfill)
**Output:** Postgres tables populated with all historical Arc agentic activity.

---

## 🎯 Outcomes of Phase 2

After this phase, you will have:

1. ✅ A `backfill.ts` script that scans Arc blocks in batches
2. ✅ Event parsers for all 4 contracts (Identity, Reputation, Validation, AgenticCommerce)
3. ✅ Idempotent inserts (safe to re-run)
4. ✅ IPFS metadata fetcher with caching
5. ✅ All historical data indexed into Postgres
6. ✅ Your own Agent #14176 + Job #20049 visible in Drizzle Studio

---

## 📋 Pre-Phase Checklist

- [ ] Phase 1 complete (all 6 tables exist)
- [ ] Your Arc node is fully synced (`eth_blockNumber` returns current head)
- [ ] `ARC_RPC_URL` and `DEPLOYMENT_BLOCK` set in `.env`
- [ ] You have `tmux` or `screen` installed (`sudo apt install tmux`)

---

## 🧠 How the Indexer Works (Architecture)

```
                ┌────────────────────────┐
                │   Arc Node RPC         │
                │   (your VPS)           │
                └────────┬───────────────┘
                         │ eth_getLogs (batched)
                         ▼
┌──────────────────────────────────────────────────────────┐
│                BACKFILL SCRIPT                           │
│                                                          │
│  1. Read last_indexed_block from `indexer_state`         │
│  2. Loop:                                                │
│     a. Fetch logs for blocks [last+1, last+5000]         │
│        for all 4 contracts in ONE eth_getLogs call       │
│     b. Decode events with viem.decodeEventLog()          │
│     c. Group by event type                               │
│     d. INSERT into Postgres in a transaction             │
│        - ON CONFLICT DO NOTHING (idempotent)             │
│     e. Fetch IPFS metadata for new agents (async pool)   │
│     f. Update aggregate columns (reputation, USDC, etc.) │
│     g. Save new last_indexed_block                       │
│     h. Print progress                                    │
│  3. Stop when last_indexed_block == head                 │
└──────────────────────────────────────────────────────────┘
```

**Why one `eth_getLogs` call per batch (not 4):**
Combining all 4 contract addresses + topic filters into one RPC call cuts request count by 75%. Your node handles 5000-block ranges easily.

---

## Step 2.1 — Event ABIs Reference (YOU, 10 min)

Before prompting Claude, gather the canonical event signatures. These will be hardcoded into the indexer.

### IdentityRegistry (ERC-721 standard)
```solidity
event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
```
- New agent registration: `from == 0x0000...0000` (zero address = mint)
- `tokenId` is the agent ID
- `to` is the owner address

### ReputationRegistry (ERC-8004)
```solidity
event FeedbackGiven(
    uint256 indexed agentId,
    address indexed validator,
    int128 score,
    uint8 scoreType,
    string tag,
    string filename,
    string fileURL,
    string fileType,
    bytes32 feedbackHash
);
```

### ValidationRegistry (ERC-8004)
```solidity
event ValidationRequested(
    bytes32 indexed requestHash,
    address indexed validator,
    uint256 indexed agentId,
    string requestURI
);

event ValidationResponded(
    bytes32 indexed requestHash,
    uint8 response,
    string responseURI,
    bytes32 responseHash,
    string tag
);
```

### AgenticCommerce (ERC-8183)
```solidity
event JobCreated(
    uint256 indexed jobId,
    address indexed client,
    address indexed provider,
    address evaluator,
    uint256 expiredAt,
    string description
);

event BudgetSet(uint256 indexed jobId, uint256 amount);

event JobFunded(uint256 indexed jobId);

event JobSubmitted(uint256 indexed jobId, bytes32 deliverableHash);

event JobCompleted(uint256 indexed jobId, bytes32 reasonHash);

event JobRejected(uint256 indexed jobId, bytes32 reasonHash);
```

> ⚠️ **IMPORTANT:** These event signatures are best-effort from public Arc docs. Before running the backfill, **verify the actual event names and parameter order** by checking arcscan transactions for known events. The Claude Code prompt below includes a step to do this.

---

## Step 2.2 — Build the Backfill (Claude Code, 2.5 hours)

### CLAUDE CODE PROMPT #2.2 — Indexer foundation

Paste this exactly:

> Build the **historical backfill indexer** in `apps/indexer/`. This service scans every Arc block from a deployment block to the current head and populates Postgres.
>
> **File structure:**
> ```
> apps/indexer/
> ├── src/
> │   ├── backfill.ts       # Entry point — runs once
> │   ├── live.ts           # Placeholder for Phase 3 (don't implement yet)
> │   ├── lib/
> │   │   ├── viem.ts       # Public client setup
> │   │   ├── abis.ts       # Event ABIs (Transfer, FeedbackGiven, etc.)
> │   │   ├── parsers.ts    # Decode logs → typed event objects
> │   │   ├── handlers.ts   # Apply parsed events to Postgres
> │   │   ├── ipfs.ts       # Fetch agent metadata from IPFS
> │   │   ├── state.ts      # Read/write indexer_state
> │   │   ├── logger.ts     # Simple structured console logger
> │   │   └── config.ts     # Load + validate env
> │   └── types.ts          # Shared types
> ├── tsconfig.json
> └── package.json (already exists)
> ```
>
> ## `lib/config.ts`
>
> Load and validate env vars with Zod:
>
> ```typescript
> import { z } from 'zod';
>
> const envSchema = z.object({
>   DATABASE_URL: z.string().url(),
>   ARC_RPC_URL: z.string().url(),
>   ARC_RPC_WS: z.string().url(),
>   ARC_CHAIN_ID: z.coerce.number().default(5042002),
>   IDENTITY_REGISTRY: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
>   REPUTATION_REGISTRY: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
>   VALIDATION_REGISTRY: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
>   AGENTIC_COMMERCE: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
>   USDC_CONTRACT: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
>   DEPLOYMENT_BLOCK: z.coerce.bigint().default(0n),
> });
>
> export const config = envSchema.parse(process.env);
>
> export const BATCH_SIZE = 5000n;     // blocks per eth_getLogs call
> export const IPFS_CONCURRENCY = 5;   // parallel IPFS fetches
> export const IPFS_TIMEOUT_MS = 5000;
> export const IPFS_GATEWAY = 'https://ipfs.io/ipfs/';
> ```
>
> ## `lib/viem.ts`
>
> Create a viem `publicClient` for Arc Testnet:
>
> ```typescript
> import { createPublicClient, http, defineChain } from 'viem';
> import { config } from './config';
>
> export const arcTestnet = defineChain({
>   id: config.ARC_CHAIN_ID,
>   name: 'Arc Testnet',
>   nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 6 },
>   rpcUrls: {
>     default: { http: [config.ARC_RPC_URL], webSocket: [config.ARC_RPC_WS] },
>   },
> });
>
> export const publicClient = createPublicClient({
>   chain: arcTestnet,
>   transport: http(config.ARC_RPC_URL, { batch: true }),
> });
> ```
>
> ## `lib/abis.ts`
>
> Define event ABIs as `const` arrays so viem can decode them. Use the event signatures listed in the documentation. If you're unsure about exact signatures, **add a TODO comment** and we'll verify against arcscan later.
>
> Include:
> - `IDENTITY_ABI` — `Transfer(address,address,uint256)`
> - `REPUTATION_ABI` — `FeedbackGiven(uint256,address,int128,uint8,string,string,string,string,bytes32)`
> - `VALIDATION_ABI` — `ValidationRequested(bytes32,address,uint256,string)`, `ValidationResponded(bytes32,uint8,string,bytes32,string)`
> - `AGENTIC_COMMERCE_ABI` — `JobCreated`, `BudgetSet`, `JobFunded`, `JobSubmitted`, `JobCompleted`, `JobRejected`
> - `USDC_ABI` — `Transfer(address,address,uint256)` (for tracking USDC flow to agent wallets)
>
> Compute event topics:
> ```typescript
> import { keccak256, toHex } from 'viem';
>
> export const EVENT_TOPICS = {
>   Transfer: keccak256(toHex('Transfer(address,address,uint256)')),
>   FeedbackGiven: keccak256(toHex('FeedbackGiven(uint256,address,int128,uint8,string,string,string,string,bytes32)')),
>   // ... etc
> };
> ```
>
> ## `lib/parsers.ts`
>
> Convert raw `Log` objects from viem into typed event objects.
>
> Define a discriminated union:
>
> ```typescript
> export type ParsedEvent =
>   | { kind: 'AgentRegistered'; agentId: bigint; owner: string; blockNumber: bigint; txHash: string; logIndex: number }
>   | { kind: 'FeedbackGiven'; agentId: bigint; validator: string; score: number; scoreType: number; tag: string; feedbackHash: string; blockNumber: bigint; txHash: string; logIndex: number }
>   | { kind: 'ValidationRequested'; requestHash: string; validator: string; agentId: bigint; requestUri: string; blockNumber: bigint; txHash: string; logIndex: number }
>   | { kind: 'ValidationResponded'; requestHash: string; response: number; responseUri: string; responseHash: string; tag: string; blockNumber: bigint; txHash: string; logIndex: number }
>   | { kind: 'JobCreated'; jobId: bigint; client: string; provider: string; evaluator: string; expiredAt: bigint; description: string; blockNumber: bigint; txHash: string; logIndex: number }
>   | { kind: 'BudgetSet'; jobId: bigint; amount: bigint; blockNumber: bigint; txHash: string; logIndex: number }
>   | { kind: 'JobFunded'; jobId: bigint; blockNumber: bigint; txHash: string; logIndex: number }
>   | { kind: 'JobSubmitted'; jobId: bigint; deliverableHash: string; blockNumber: bigint; txHash: string; logIndex: number }
>   | { kind: 'JobCompleted'; jobId: bigint; reasonHash: string; blockNumber: bigint; txHash: string; logIndex: number }
>   | { kind: 'JobRejected'; jobId: bigint; reasonHash: string; blockNumber: bigint; txHash: string; logIndex: number };
>
> export function parseLog(log: Log): ParsedEvent | null {
>   // Determine contract by `log.address`, then decode with appropriate ABI
>   // Return null if event is not one we care about
> }
> ```
>
> Implement using `viem.decodeEventLog()`. Special case: for `Transfer` from `IdentityRegistry`, only emit `AgentRegistered` when `from === '0x0000000000000000000000000000000000000000'` (mint).
>
> ## `lib/handlers.ts`
>
> Apply parsed events to Postgres. Every handler is **idempotent** — uses `ON CONFLICT DO NOTHING` or upsert.
>
> ```typescript
> import { db, agents, feedbackEvents, validations, jobs, jobEvents } from '@arc-agents/db';
> import { eq, sql as drizzleSql } from 'drizzle-orm';
> import type { ParsedEvent } from './parsers';
>
> export async function applyEvents(events: ParsedEvent[]): Promise<void> {
>   if (events.length === 0) return;
>
>   await db.transaction(async (tx) => {
>     for (const e of events) {
>       switch (e.kind) {
>         case 'AgentRegistered':
>           await tx.insert(agents).values({
>             agentId: e.agentId,
>             ownerAddress: e.owner.toLowerCase(),
>             registeredAtBlock: e.blockNumber,
>             registeredTxHash: e.txHash,
>           }).onConflictDoNothing();
>           break;
>
>         case 'FeedbackGiven':
>           await tx.insert(feedbackEvents).values({
>             agentId: e.agentId,
>             validatorAddress: e.validator.toLowerCase(),
>             score: e.score.toString(),
>             scoreType: e.scoreType,
>             tag: e.tag,
>             feedbackHash: e.feedbackHash,
>             blockNumber: e.blockNumber,
>             txHash: e.txHash,
>             logIndex: e.logIndex,
>           }).onConflictDoNothing();
>
>           // Recompute agent reputation aggregate
>           await tx.execute(drizzleSql`
>             UPDATE agents SET
>               reputation_score = (SELECT AVG(score) FROM feedback_events WHERE agent_id = ${e.agentId}),
>               feedback_count = (SELECT COUNT(*) FROM feedback_events WHERE agent_id = ${e.agentId}),
>               updated_at = NOW()
>             WHERE agent_id = ${e.agentId}
>           `);
>           break;
>
>         case 'ValidationRequested':
>           await tx.insert(validations).values({
>             agentId: e.agentId,
>             validatorAddress: e.validator.toLowerCase(),
>             requestHash: e.requestHash,
>             requestUri: e.requestUri,
>             status: 'PENDING',
>             requestedAtBlock: e.blockNumber,
>             requestTxHash: e.txHash,
>           }).onConflictDoNothing();
>           break;
>
>         case 'ValidationResponded':
>           await tx.update(validations).set({
>             responseCode: e.response,
>             responseUri: e.responseUri,
>             responseHash: e.responseHash,
>             tag: e.tag,
>             status: e.response === 100 ? 'PASSED' : 'FAILED',
>             respondedAtBlock: e.blockNumber,
>             responseTxHash: e.txHash,
>             updatedAt: new Date(),
>           }).where(eq(validations.requestHash, e.requestHash));
>
>           // Update agent.validation_status if this is the latest validation
>           // (For MVP, just set to the latest validation result)
>           const v = await tx.select().from(validations).where(eq(validations.requestHash, e.requestHash)).limit(1);
>           if (v[0]) {
>             await tx.update(agents).set({
>               validationStatus: v[0].status,
>               updatedAt: new Date(),
>             }).where(eq(agents.agentId, v[0].agentId));
>           }
>           break;
>
>         case 'JobCreated':
>           await tx.insert(jobs).values({
>             jobId: e.jobId,
>             clientAddress: e.client.toLowerCase(),
>             providerAddress: e.provider.toLowerCase(),
>             evaluatorAddress: e.evaluator.toLowerCase(),
>             description: e.description,
>             status: 'Open',
>             expiredAt: new Date(Number(e.expiredAt) * 1000),
>             createdAtBlock: e.blockNumber,
>             createdTxHash: e.txHash,
>           }).onConflictDoNothing();
>
>           await tx.insert(jobEvents).values({
>             jobId: e.jobId,
>             eventType: 'created',
>             actorAddress: e.client.toLowerCase(),
>             blockNumber: e.blockNumber,
>             txHash: e.txHash,
>             logIndex: e.logIndex,
>             data: { evaluator: e.evaluator, description: e.description },
>           }).onConflictDoNothing();
>           break;
>
>         case 'BudgetSet': {
>           const budgetUsdc = (Number(e.amount) / 1_000_000).toString();
>           await tx.update(jobs).set({
>             budgetUsdc,
>             budgetRaw: e.amount.toString(),
>             updatedAt: new Date(),
>           }).where(eq(jobs.jobId, e.jobId));
>
>           await tx.insert(jobEvents).values({
>             jobId: e.jobId,
>             eventType: 'budgetSet',
>             actorAddress: '',  // not in event, will derive from tx if needed
>             blockNumber: e.blockNumber,
>             txHash: e.txHash,
>             logIndex: e.logIndex,
>             data: { amount: e.amount.toString() },
>           }).onConflictDoNothing();
>           break;
>         }
>
>         case 'JobFunded':
>           await tx.update(jobs).set({
>             status: 'Funded',
>             updatedAt: new Date(),
>           }).where(eq(jobs.jobId, e.jobId));
>
>           await tx.insert(jobEvents).values({
>             jobId: e.jobId,
>             eventType: 'funded',
>             actorAddress: '',
>             blockNumber: e.blockNumber,
>             txHash: e.txHash,
>             logIndex: e.logIndex,
>             data: {},
>           }).onConflictDoNothing();
>           break;
>
>         case 'JobSubmitted':
>           await tx.update(jobs).set({
>             status: 'Submitted',
>             deliverableHash: e.deliverableHash,
>             updatedAt: new Date(),
>           }).where(eq(jobs.jobId, e.jobId));
>
>           await tx.insert(jobEvents).values({
>             jobId: e.jobId,
>             eventType: 'submitted',
>             actorAddress: '',
>             blockNumber: e.blockNumber,
>             txHash: e.txHash,
>             logIndex: e.logIndex,
>             data: { deliverableHash: e.deliverableHash },
>           }).onConflictDoNothing();
>           break;
>
>         case 'JobCompleted': {
>           // Mark job completed
>           await tx.update(jobs).set({
>             status: 'Completed',
>             completionReason: e.reasonHash,
>             completedAtBlock: e.blockNumber,
>             completedTxHash: e.txHash,
>             updatedAt: new Date(),
>           }).where(eq(jobs.jobId, e.jobId));
>
>           await tx.insert(jobEvents).values({
>             jobId: e.jobId,
>             eventType: 'completed',
>             actorAddress: '',
>             blockNumber: e.blockNumber,
>             txHash: e.txHash,
>             logIndex: e.logIndex,
>             data: { reasonHash: e.reasonHash },
>           }).onConflictDoNothing();
>
>           // Update agent's earnings + completed count
>           const job = await tx.select().from(jobs).where(eq(jobs.jobId, e.jobId)).limit(1);
>           if (job[0]?.budgetUsdc) {
>             await tx.execute(drizzleSql`
>               UPDATE agents SET
>                 jobs_completed = jobs_completed + 1,
>                 usdc_earned = usdc_earned + ${job[0].budgetUsdc}::numeric,
>                 updated_at = NOW()
>               WHERE LOWER(owner_address) = LOWER(${job[0].providerAddress})
>                  OR agent_id IN (
>                    SELECT agent_id FROM agents WHERE LOWER(owner_address) = LOWER(${job[0].providerAddress})
>                  )
>             `);
>           }
>           break;
>         }
>
>         case 'JobRejected':
>           await tx.update(jobs).set({
>             status: 'Rejected',
>             completionReason: e.reasonHash,
>             updatedAt: new Date(),
>           }).where(eq(jobs.jobId, e.jobId));
>           break;
>       }
>     }
>   });
> }
> ```
>
> ## `lib/ipfs.ts`
>
> Fetch agent metadata from IPFS with concurrency control and timeout. Use a simple semaphore pattern:
>
> ```typescript
> import { config, IPFS_CONCURRENCY, IPFS_TIMEOUT_MS, IPFS_GATEWAY } from './config';
> import { db, agents, type AgentMetadata } from '@arc-agents/db';
> import { eq, isNull, and } from 'drizzle-orm';
> import { logger } from './logger';
>
> export async function fetchMetadataFromUri(uri: string): Promise<AgentMetadata | null> {
>   let url = uri;
>   if (uri.startsWith('ipfs://')) {
>     url = IPFS_GATEWAY + uri.replace('ipfs://', '');
>   }
>
>   try {
>     const controller = new AbortController();
>     const timeout = setTimeout(() => controller.abort(), IPFS_TIMEOUT_MS);
>     const res = await fetch(url, { signal: controller.signal });
>     clearTimeout(timeout);
>
>     if (!res.ok) return null;
>     const data = await res.json();
>     return data as AgentMetadata;
>   } catch (err) {
>     return null;
>   }
> }
>
> // Process agents that have metadataUri but no cached metadata yet
> export async function backfillMissingMetadata(): Promise<void> {
>   const missing = await db.select()
>     .from(agents)
>     .where(and(
>       isNull(agents.metadata),
>     ))
>     .limit(500);
>
>   logger.info(`Found ${missing.length} agents needing metadata`);
>
>   // Process in parallel with concurrency limit
>   const queue = [...missing];
>   const workers = Array.from({ length: IPFS_CONCURRENCY }, async () => {
>     while (queue.length > 0) {
>       const agent = queue.shift();
>       if (!agent || !agent.metadataUri) continue;
>
>       const metadata = await fetchMetadataFromUri(agent.metadataUri);
>       if (metadata) {
>         await db.update(agents).set({
>           metadata,
>           name: metadata.name ?? null,
>           agentType: metadata.agent_type ?? null,
>           capabilities: metadata.capabilities ?? null,
>           updatedAt: new Date(),
>         }).where(eq(agents.agentId, agent.agentId));
>       }
>     }
>   });
>
>   await Promise.all(workers);
>   logger.info('Metadata backfill batch complete');
> }
> ```
>
> Also implement `fetchTokenURI(agentId)` that calls `tokenURI(uint256)` on IdentityRegistry to retrieve a metadata URI on-chain — store this in `agents.metadataUri` after agent insertion.
>
> ## `lib/state.ts`
>
> ```typescript
> import { db, indexerState } from '@arc-agents/db';
> import { eq } from 'drizzle-orm';
>
> const LAST_BLOCK_KEY = 'last_indexed_block';
>
> export async function getLastIndexedBlock(defaultBlock: bigint): Promise<bigint> {
>   const row = await db.select().from(indexerState).where(eq(indexerState.key, LAST_BLOCK_KEY)).limit(1);
>   if (row.length === 0) return defaultBlock;
>   return BigInt(row[0].value);
> }
>
> export async function setLastIndexedBlock(block: bigint): Promise<void> {
>   await db.insert(indexerState).values({
>     key: LAST_BLOCK_KEY,
>     value: block.toString(),
>   }).onConflictDoUpdate({
>     target: indexerState.key,
>     set: { value: block.toString(), updatedAt: new Date() },
>   });
> }
> ```
>
> ## `lib/logger.ts`
>
> ```typescript
> export const logger = {
>   info: (msg: string, data?: any) => console.log(`[INFO] ${new Date().toISOString()} ${msg}`, data ?? ''),
>   warn: (msg: string, data?: any) => console.warn(`[WARN] ${new Date().toISOString()} ${msg}`, data ?? ''),
>   error: (msg: string, data?: any) => console.error(`[ERROR] ${new Date().toISOString()} ${msg}`, data ?? ''),
> };
> ```
>
> ## `src/backfill.ts` — Main entry point
>
> ```typescript
> import 'dotenv/config';
> import { publicClient } from './lib/viem';
> import { config, BATCH_SIZE } from './lib/config';
> import { parseLog } from './lib/parsers';
> import { applyEvents } from './lib/handlers';
> import { getLastIndexedBlock, setLastIndexedBlock } from './lib/state';
> import { backfillMissingMetadata, fetchTokenURI } from './lib/ipfs';
> import { logger } from './lib/logger';
> import { db, agents } from '@arc-agents/db';
> import { eq, isNull } from 'drizzle-orm';
>
> const CONTRACT_ADDRESSES = [
>   config.IDENTITY_REGISTRY,
>   config.REPUTATION_REGISTRY,
>   config.VALIDATION_REGISTRY,
>   config.AGENTIC_COMMERCE,
> ];
>
> async function main() {
>   logger.info('🔄 Starting Arc backfill indexer');
>   logger.info(`RPC: ${config.ARC_RPC_URL}`);
>
>   const head = await publicClient.getBlockNumber();
>   logger.info(`Current head block: ${head}`);
>
>   let lastIndexed = await getLastIndexedBlock(config.DEPLOYMENT_BLOCK);
>   logger.info(`Resuming from block: ${lastIndexed}`);
>
>   while (lastIndexed < head) {
>     const fromBlock = lastIndexed + 1n;
>     const toBlock = fromBlock + BATCH_SIZE - 1n > head ? head : fromBlock + BATCH_SIZE - 1n;
>
>     try {
>       // Fetch all logs for the 4 contracts in one call
>       const logs = await publicClient.getLogs({
>         address: CONTRACT_ADDRESSES,
>         fromBlock,
>         toBlock,
>       });
>
>       // Parse and filter
>       const events = logs.map(parseLog).filter((e): e is NonNullable<typeof e> => e !== null);
>
>       // Apply to DB
>       await applyEvents(events);
>
>       // Fetch metadataUri for newly registered agents
>       const newAgents = events.filter(e => e.kind === 'AgentRegistered');
>       for (const ev of newAgents) {
>         try {
>           const uri = await fetchTokenURI(ev.agentId);
>           if (uri) {
>             await db.update(agents).set({ metadataUri: uri }).where(eq(agents.agentId, ev.agentId));
>           }
>         } catch (err) {
>           logger.warn(`Failed to fetch tokenURI for agent ${ev.agentId}`, err);
>         }
>       }
>
>       // Save progress
>       await setLastIndexedBlock(toBlock);
>
>       // Stats
>       const counts = events.reduce((acc, e) => {
>         acc[e.kind] = (acc[e.kind] || 0) + 1;
>         return acc;
>       }, {} as Record<string, number>);
>
>       logger.info(`✅ Blocks ${fromBlock}-${toBlock} | events: ${events.length}`, counts);
>
>       lastIndexed = toBlock;
>     } catch (err) {
>       logger.error(`Batch ${fromBlock}-${toBlock} failed, retrying in 5s`, err);
>       await new Promise(r => setTimeout(r, 5000));
>     }
>   }
>
>   logger.info('📦 Backfilling missing IPFS metadata...');
>   await backfillMissingMetadata();
>
>   logger.info('🎉 Backfill complete');
>   process.exit(0);
> }
>
> main().catch((err) => {
>   logger.error('Fatal error', err);
>   process.exit(1);
> });
> ```
>
> ## Verification
>
> After writing all files:
> 1. Run `pnpm typecheck` from root — must pass
> 2. Print the final file tree so I can review
>
> **Do not run the backfill yet.** I want to verify the event ABIs against a known transaction first.

### YOU: Verify event ABIs against arcscan

Before running the full backfill, sanity-check the event ABIs against your own transactions from the demo:

```bash
# Open your AgentRegistered tx from the demo
# https://testnet.arcscan.app/tx/0xcfd95dade4a91602b0eb1ec3d42900bab6faecf696637e3b5758e1addc6cd00f
# Look at "Logs" tab — confirm:
#   - Event name "Transfer"
#   - 3 topics (event sig + from + to + tokenId)
#   - from = 0x0...0
#   - tokenId = 14176

# Similarly verify a FeedbackGiven event:
# https://testnet.arcscan.app/tx/0x5b866586861d3d272eb457580b22867d19059456886f38061b7d5673d76233d6

# Verify a JobCreated event:
# https://testnet.arcscan.app/tx/0xb0459a8b84ca667aa00153fc65711e8415830519434f1ee0eb1009c393165c05
```

If any event signature in `abis.ts` doesn't match what arcscan shows, **fix it before running the backfill**.

---

## Step 2.3 — Run the Backfill (YOU, 30 min – 2 hours)

### YOU: Use tmux so you don't lose progress

```bash
tmux new -s backfill

cd ~/arc-agents-explorer
pnpm dev:indexer:backfill
```

Detach from tmux with `Ctrl+B` then `D`. Re-attach with `tmux attach -t backfill`.

### YOU: Watch progress

You should see lines like:

```
[INFO] 2026-05-17T... 🔄 Starting Arc backfill indexer
[INFO] 2026-05-17T... Current head block: 5234210
[INFO] 2026-05-17T... Resuming from block: 0
[INFO] 2026-05-17T... ✅ Blocks 1-5000 | events: 23 { AgentRegistered: 8, FeedbackGiven: 7, JobCreated: 6, JobCompleted: 2 }
[INFO] 2026-05-17T... ✅ Blocks 5001-10000 | events: 12 ...
...
```

### YOU: Verify in Drizzle Studio while it runs

```bash
# Different terminal
pnpm db:studio
```

Open https://local.drizzle.studio → click `agents` table → search for `agent_id = 14176` → should be there with `reputation_score = 95`.

---

## Step 2.4 — Verify Your Own Agent (YOU, 5 min)

Once backfill completes, run this query in `psql`:

```bash
docker exec -it arc-pg psql -U postgres -d arc_agents
```

```sql
-- Your own agent
SELECT agent_id, name, owner_address, reputation_score, feedback_count, validation_status, jobs_completed, usdc_earned
FROM agents
WHERE agent_id = 14176;

-- Your own job
SELECT job_id, status, budget_usdc, provider_address, description
FROM jobs
WHERE job_id = 20049;

-- Top 10 agents by reputation
SELECT agent_id, name, reputation_score, feedback_count, jobs_completed
FROM agents
WHERE reputation_score IS NOT NULL
ORDER BY reputation_score DESC NULLS LAST
LIMIT 10;

-- Overall stats
SELECT
  (SELECT COUNT(*) FROM agents) AS total_agents,
  (SELECT COUNT(*) FROM jobs) AS total_jobs,
  (SELECT SUM(budget_usdc) FROM jobs WHERE status = 'Completed') AS total_usdc_paid;

\q
```

✅ If your agent shows up with `reputation_score = 95.00` and `validation_status = 'PASSED'`, Phase 2 worked.

---

## ✅ Phase 2 Definition of Done

- [ ] Backfill ran to completion without crashing
- [ ] `agents` table has > 0 rows (probably thousands)
- [ ] Your own agent (#14176) is in the database with correct reputation
- [ ] Your own job (#20049) is in the database with status `Completed`
- [ ] `jobs_completed` and `usdc_earned` aggregates look reasonable
- [ ] `indexer_state.last_indexed_block` is set to a recent block
- [ ] No TODO event-signature mismatches reported
- [ ] Committed to Git

### Git commit

```bash
git add .
git commit -m "feat: historical backfill indexer (Phase 2)

- viem-based event log fetcher (batched eth_getLogs)
- Parsers for ERC-8004 (Identity/Reputation/Validation) + ERC-8183 (AgenticCommerce)
- Idempotent handlers with ON CONFLICT DO NOTHING
- IPFS metadata fetcher with concurrency control
- Aggregate updates: reputation_score, feedback_count, jobs_completed, usdc_earned
- Indexer state tracking for resumable backfill"
git push
```

---

## 🔥 Common Issues & Fixes

### "Error: requested too many blocks"
Your Arc node has an `eth_getLogs` block range limit (usually 10k). Reduce `BATCH_SIZE` from 5000 to 1000 in `config.ts`.

### "Event signature doesn't match"
The hardcoded ABI doesn't match the on-chain event. Open arcscan, view the raw event topics, compute keccak256 of the actual signature, update `abis.ts`.

### "IPFS fetches timing out constantly"
Try a different IPFS gateway:
- `https://cloudflare-ipfs.com/ipfs/`
- `https://gateway.pinata.cloud/ipfs/`
- `https://nftstorage.link/ipfs/`

### Backfill is slow (< 100 blocks/sec)
- Confirm you're using your **own node**, not a public RPC
- Check Postgres isn't the bottleneck: `docker stats arc-pg`
- Increase `BATCH_SIZE` to 10000 if your node allows it

### "duplicate key value violates unique constraint"
Idempotency check failed. Confirm your handlers use `.onConflictDoNothing()` everywhere. If still happens, the issue is composite uniqueness — re-check the `txHash` unique constraint definitions.

---

**Next →** Open `03_PHASE_3_LIVE_LISTENER.md` to stream new events in real time.
