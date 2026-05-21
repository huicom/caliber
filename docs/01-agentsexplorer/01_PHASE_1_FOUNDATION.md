# Phase 1 — Foundation & Schema

> **Goal:** Postgres running with pgvector, full database schema designed in Drizzle ORM, monorepo scaffolded, type-safe queries ready to use.

**Estimated time:** 3 hours
**Output:** Empty database with all tables, indexes, and extensions ready for Phase 2.

---

## 🎯 Outcomes of Phase 1

After this phase, you will have:

1. ✅ Postgres 16 + pgvector running in Docker
2. ✅ pnpm monorepo with 3 packages (`web`, `indexer`, `db`)
3. ✅ Drizzle ORM schema with 6 tables + indexes
4. ✅ Migrations applied successfully
5. ✅ Type-safe DB client ready for both indexer and web app
6. ✅ Environment variables configured
7. ✅ All TypeScript compiles cleanly

---

## 📋 Pre-Phase Checklist

Before starting:

- [ ] Docker is installed: `docker --version` (need 24+)
- [ ] Node.js 22+ installed: `node --version`
- [ ] pnpm installed: `pnpm --version` (install with `npm install -g pnpm` if missing)
- [ ] Git configured with SSH key for GitHub
- [ ] Arc node RPC URL ready (you'll need this in `.env`)

---

## Step 1.1 — Create the Monorepo (YOU + Claude Code, 30 min)

### YOU: Create empty repo + folder

```bash
# Create empty GitHub repo first via web UI: huicom/arc-agents-explorer

# Then locally
mkdir -p ~/arc-agents-explorer
cd ~/arc-agents-explorer
git init
git remote add origin git@github.com:huicom/arc-agents-explorer.git
git branch -m main
```

### YOU: Start Claude Code in the folder

```bash
claude
```

### CLAUDE CODE PROMPT #1.1 — Monorepo scaffold

Paste this exactly:

> Set up a new project as a **pnpm monorepo** with three packages:
>
> ```
> arc-agents-explorer/
> ├── apps/
> │   ├── web/        # Next.js 15 frontend (App Router + Tailwind + shadcn/ui)
> │   └── indexer/    # Standalone Node.js service that indexes Arc events
> ├── packages/
> │   └── db/         # Shared Drizzle ORM schema + migrations + DB client
> ├── package.json    # Root with workspaces
> ├── pnpm-workspace.yaml
> ├── tsconfig.base.json   # Shared TS config
> ├── .gitignore
> ├── .env.example
> └── README.md
> ```
>
> **Root `package.json`** must define these scripts:
> ```json
> "scripts": {
>   "dev:web": "pnpm --filter web dev",
>   "dev:indexer:backfill": "pnpm --filter indexer backfill",
>   "dev:indexer:live": "pnpm --filter indexer live",
>   "db:generate": "pnpm --filter @arc-agents/db generate",
>   "db:migrate": "pnpm --filter @arc-agents/db migrate",
>   "db:studio": "pnpm --filter @arc-agents/db studio",
>   "build:web": "pnpm --filter web build",
>   "build:indexer": "pnpm --filter indexer build",
>   "start:web": "pnpm --filter web start",
>   "start:indexer:live": "pnpm --filter indexer start:live",
>   "typecheck": "pnpm -r typecheck"
> }
> ```
>
> **`pnpm-workspace.yaml`** must include:
> ```yaml
> packages:
>   - 'apps/*'
>   - 'packages/*'
> ```
>
> **`packages/db/package.json`** name: `@arc-agents/db`
> Dependencies:
> - `drizzle-orm@latest`
> - `postgres@latest` (postgres.js driver — NOT pg)
>
> Dev deps:
> - `drizzle-kit@latest`
> - `typescript`
> - `tsx`
> - `@types/node`
>
> Scripts:
> - `generate`: `drizzle-kit generate`
> - `migrate`: `tsx src/migrate.ts`
> - `studio`: `drizzle-kit studio`
> - `typecheck`: `tsc --noEmit`
>
> **`apps/indexer/package.json`** name: `@arc-agents/indexer`
> Dependencies:
> - `@arc-agents/db@workspace:*`
> - `viem@latest`
> - `dotenv@latest`
>
> Dev deps:
> - `typescript`
> - `tsx`
> - `@types/node`
>
> Scripts:
> - `backfill`: `tsx --env-file=../../.env src/backfill.ts`
> - `live`: `tsx --env-file=../../.env src/live.ts`
> - `build`: `tsc`
> - `start:live`: `node dist/live.js`
> - `typecheck`: `tsc --noEmit`
>
> **`apps/web/package.json`** name: `web`
> Dependencies:
> - `next@15`
> - `react@19`
> - `react-dom@19`
> - `@arc-agents/db@workspace:*`
> - `viem@latest`
> - `postgres@latest`
> - `zod@latest`
> - `tailwindcss@latest`
> - `clsx`
> - `class-variance-authority`
> - `lucide-react`
> - `sonner`
> - `recharts`
>
> Dev deps:
> - `typescript`
> - `@types/node`
> - `@types/react`
> - `@types/react-dom`
> - `postcss`
> - `autoprefixer`
>
> Scripts:
> - `dev`: `next dev`
> - `build`: `next build`
> - `start`: `next start`
> - `typecheck`: `tsc --noEmit`
>
> **`tsconfig.base.json`** at root — strict mode, ESNext, bundler module resolution.
>
> **`.gitignore`** must exclude: `node_modules`, `.next`, `dist`, `.env`, `.env.local`, `*.log`, `.DS_Store`, `pg-data/`.
>
> **`.env.example`** should have these placeholders (no real values):
> ```
> # Postgres
> DATABASE_URL=postgres://postgres:arcdev@localhost:5432/arc_agents
>
> # Arc node RPC (yours)
> ARC_RPC_URL=https://arc-rpc.yourdomain.com
> ARC_RPC_WS=wss://arc-rpc.yourdomain.com
>
> # Arc Testnet chain ID
> ARC_CHAIN_ID=5042002
>
> # ERC-8004 contract addresses (Arc Testnet)
> IDENTITY_REGISTRY=0x8004A818BFB912233c491871b3d84c89A494BD9e
> REPUTATION_REGISTRY=0x8004B663056A597Dffe9eCcC1965A193B7388713
> VALIDATION_REGISTRY=0x8004Cb1BF31DAf7788923b405b754f57acEB4272
> AGENTIC_COMMERCE=0x0747EEf0706327138c69792bF28Cd525089e4583
> USDC_CONTRACT=0x3600000000000000000000000000000000000000
>
> # Deployment block (find from arcscan, hardcode below)
> DEPLOYMENT_BLOCK=0
> ```
>
> After scaffolding, run `pnpm install` from the root. Then run `pnpm typecheck` to confirm everything compiles cleanly (it should, even though there's no real code yet).
>
> **Don't write any business logic.** Just scaffold the structure, confirm `pnpm install` succeeds, confirm `pnpm typecheck` exits clean.

### YOU: Verify

```bash
# Should see the full tree
tree -L 3 -I node_modules

# All packages installed
pnpm install

# Clean compile
pnpm typecheck
```

---

## Step 1.2 — Start Postgres (YOU, 10 min)

### YOU: Run Postgres + pgvector

```bash
docker run -d \
  --name arc-pg \
  --restart unless-stopped \
  -e POSTGRES_PASSWORD=arcdev \
  -e POSTGRES_DB=arc_agents \
  -p 5432:5432 \
  -v ~/arc-pg-data:/var/lib/postgresql/data \
  pgvector/pgvector:pg16
```

### YOU: Verify it's running

```bash
# Container running?
docker ps | grep arc-pg

# Can connect?
docker exec -it arc-pg psql -U postgres -d arc_agents -c "SELECT version();"

# Test extensions are available
docker exec -it arc-pg psql -U postgres -d arc_agents -c "SELECT * FROM pg_available_extensions WHERE name IN ('vector', 'pg_trgm');"
```

Expected output: both extensions listed as available.

### YOU: Configure .env

```bash
cp .env.example .env
nano .env
```

Set these values:
- `DATABASE_URL=postgres://postgres:arcdev@localhost:5432/arc_agents`
- `ARC_RPC_URL=<your Arc node RPC URL>`
- `ARC_RPC_WS=<your Arc node WebSocket URL>` (replace `https` with `wss`)
- `DEPLOYMENT_BLOCK=<find this in next step>`

### YOU: Find the deployment block

Open https://testnet.arcscan.app/address/0x8004A818BFB912233c491871b3d84c89A494BD9e in browser.

Scroll to the **oldest transaction**. Note the block number. That's your `DEPLOYMENT_BLOCK`.

If unsure, set `DEPLOYMENT_BLOCK=0` for now — the indexer will work, just slower on first pass.

---

## Step 1.3 — Database Schema (Claude Code, 90 min)

This is the most important step. The schema must support every future feature.

### CLAUDE CODE PROMPT #1.3 — Schema design

Paste this exactly:

> Now design the **complete Postgres schema** in `packages/db/src/schema.ts` using Drizzle ORM. This schema must handle every ERC-8004 and ERC-8183 event on Arc, plus support future features like vector search.
>
> **Create these files:**
>
> ```
> packages/db/
> ├── src/
> │   ├── schema.ts        # Drizzle table definitions
> │   ├── client.ts        # Postgres connection + drizzle client (export `db`)
> │   ├── migrate.ts       # Run migrations programmatically
> │   ├── enums.ts         # Shared enums (JobStatus, ValidationStatus, EventType)
> │   └── index.ts         # Re-export everything public
> ├── drizzle.config.ts    # Drizzle Kit config
> └── migrations/          # Generated SQL migrations (auto-created)
> ```
>
> ## Schema Requirements
>
> **Enums** (in `enums.ts`):
> ```typescript
> export const JobStatus = {
>   Open: 'Open',
>   Funded: 'Funded',
>   Submitted: 'Submitted',
>   Completed: 'Completed',
>   Rejected: 'Rejected',
>   Expired: 'Expired',
> } as const;
> export type JobStatus = typeof JobStatus[keyof typeof JobStatus];
>
> export const ValidationStatus = {
>   Pending: 'PENDING',
>   Passed: 'PASSED',
>   Failed: 'FAILED',
> } as const;
> export type ValidationStatus = typeof ValidationStatus[keyof typeof ValidationStatus];
>
> export const JobEventType = {
>   Created: 'created',
>   BudgetSet: 'budgetSet',
>   Funded: 'funded',
>   Submitted: 'submitted',
>   Completed: 'completed',
>   Rejected: 'rejected',
> } as const;
> export type JobEventType = typeof JobEventType[keyof typeof JobEventType];
> ```
>
> ### Table 1: `agents`
> Each registered ERC-8004 agent.
>
> ```typescript
> import { pgTable, bigint, text, jsonb, numeric, integer, timestamp, index } from 'drizzle-orm/pg-core';
>
> export const agents = pgTable('agents', {
>   agentId: bigint('agent_id', { mode: 'bigint' }).primaryKey(),
>   ownerAddress: text('owner_address').notNull(),
>   metadataUri: text('metadata_uri'),
>   metadata: jsonb('metadata').$type<AgentMetadata | null>(),  // cached IPFS fetch
>   name: text('name'),  // extracted from metadata.name for fast search
>   agentType: text('agent_type'),  // extracted from metadata.agent_type
>   capabilities: jsonb('capabilities').$type<string[] | null>(),  // metadata.capabilities array
>   reputationScore: numeric('reputation_score', { precision: 10, scale: 2 }),  // avg
>   feedbackCount: integer('feedback_count').default(0).notNull(),
>   validationStatus: text('validation_status'),  // PASSED/PENDING/FAILED/null
>   jobsCompleted: integer('jobs_completed').default(0).notNull(),
>   usdcEarned: numeric('usdc_earned', { precision: 30, scale: 6 }).default('0').notNull(),
>   registeredAtBlock: bigint('registered_at_block', { mode: 'bigint' }).notNull(),
>   registeredTxHash: text('registered_tx_hash').notNull(),
>   registeredAt: timestamp('registered_at', { withTimezone: true }),
>   createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
>   updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
> }, (table) => ({
>   ownerIdx: index('idx_agents_owner').on(table.ownerAddress),
>   reputationIdx: index('idx_agents_reputation').on(table.reputationScore),  // DESC for leaderboard
>   earnedIdx: index('idx_agents_earned').on(table.usdcEarned),
>   blockIdx: index('idx_agents_block').on(table.registeredAtBlock),
>   nameIdx: index('idx_agents_name').on(table.name),
>   // GIN index for JSONB capabilities array search
>   capabilitiesGin: index('idx_agents_capabilities_gin').using('gin', table.capabilities),
>   metadataGin: index('idx_agents_metadata_gin').using('gin', table.metadata),
> }));
>
> export type Agent = typeof agents.$inferSelect;
> export type NewAgent = typeof agents.$inferInsert;
>
> // Metadata shape from IPFS
> export interface AgentMetadata {
>   name?: string;
>   description?: string;
>   image?: string;
>   agent_type?: string;
>   capabilities?: string[];
>   version?: string;
>   creator?: string;
>   location?: string;
>   [key: string]: unknown;
> }
> ```
>
> ### Table 2: `feedback_events`
> Every reputation feedback recorded on-chain.
>
> ```typescript
> export const feedbackEvents = pgTable('feedback_events', {
>   id: bigserial('id', { mode: 'bigint' }).primaryKey(),
>   agentId: bigint('agent_id', { mode: 'bigint' }).notNull()
>     .references(() => agents.agentId, { onDelete: 'cascade' }),
>   validatorAddress: text('validator_address').notNull(),
>   score: numeric('score', { precision: 10, scale: 2 }).notNull(),
>   scoreType: integer('score_type'),  // ERC-8004 second param (0 = absolute)
>   tag: text('tag'),
>   feedbackHash: text('feedback_hash'),
>   blockNumber: bigint('block_number', { mode: 'bigint' }).notNull(),
>   txHash: text('tx_hash').notNull().unique(),
>   logIndex: integer('log_index').notNull(),
>   createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
> }, (table) => ({
>   agentIdIdx: index('idx_feedback_agent').on(table.agentId),
>   blockIdx: index('idx_feedback_block').on(table.blockNumber),
>   validatorIdx: index('idx_feedback_validator').on(table.validatorAddress),
> }));
>
> export type FeedbackEvent = typeof feedbackEvents.$inferSelect;
> ```
>
> ### Table 3: `validations`
> ERC-8004 validation request/response pairs.
>
> ```typescript
> export const validations = pgTable('validations', {
>   id: bigserial('id', { mode: 'bigint' }).primaryKey(),
>   agentId: bigint('agent_id', { mode: 'bigint' }).notNull()
>     .references(() => agents.agentId, { onDelete: 'cascade' }),
>   validatorAddress: text('validator_address').notNull(),
>   requestHash: text('request_hash').notNull().unique(),
>   requestUri: text('request_uri'),
>   tag: text('tag'),
>   status: text('status').notNull(),  // PENDING/PASSED/FAILED
>   responseCode: integer('response_code'),  // 100 = passed in ERC-8004
>   responseUri: text('response_uri'),
>   responseHash: text('response_hash'),
>   requestedAtBlock: bigint('requested_at_block', { mode: 'bigint' }).notNull(),
>   respondedAtBlock: bigint('responded_at_block', { mode: 'bigint' }),
>   requestTxHash: text('request_tx_hash').notNull(),
>   responseTxHash: text('response_tx_hash'),
>   createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
>   updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
> }, (table) => ({
>   agentIdx: index('idx_validations_agent').on(table.agentId),
>   statusIdx: index('idx_validations_status').on(table.status),
>   validatorIdx: index('idx_validations_validator').on(table.validatorAddress),
> }));
>
> export type Validation = typeof validations.$inferSelect;
> ```
>
> ### Table 4: `jobs`
> Every ERC-8183 job — one row per job, current state cached.
>
> ```typescript
> export const jobs = pgTable('jobs', {
>   jobId: bigint('job_id', { mode: 'bigint' }).primaryKey(),
>   clientAddress: text('client_address').notNull(),
>   providerAddress: text('provider_address').notNull(),
>   evaluatorAddress: text('evaluator_address'),
>   budgetUsdc: numeric('budget_usdc', { precision: 30, scale: 6 }),  // human-readable USDC
>   budgetRaw: text('budget_raw'),  // raw uint256 string for precision
>   description: text('description'),
>   status: text('status').notNull(),
>   deliverableHash: text('deliverable_hash'),
>   completionReason: text('completion_reason'),
>   expiredAt: timestamp('expired_at', { withTimezone: true }),
>   createdAtBlock: bigint('created_at_block', { mode: 'bigint' }).notNull(),
>   createdTxHash: text('created_tx_hash').notNull(),
>   completedAtBlock: bigint('completed_at_block', { mode: 'bigint' }),
>   completedTxHash: text('completed_tx_hash'),
>   createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
>   updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
> }, (table) => ({
>   providerIdx: index('idx_jobs_provider').on(table.providerAddress),
>   clientIdx: index('idx_jobs_client').on(table.clientAddress),
>   statusIdx: index('idx_jobs_status').on(table.status),
>   blockIdx: index('idx_jobs_block').on(table.createdAtBlock),
>   budgetIdx: index('idx_jobs_budget').on(table.budgetUsdc),
> }));
>
> export type Job = typeof jobs.$inferSelect;
> ```
>
> ### Table 5: `job_events`
> Append-only log of every job state transition (for timeline).
>
> ```typescript
> export const jobEvents = pgTable('job_events', {
>   id: bigserial('id', { mode: 'bigint' }).primaryKey(),
>   jobId: bigint('job_id', { mode: 'bigint' }).notNull()
>     .references(() => jobs.jobId, { onDelete: 'cascade' }),
>   eventType: text('event_type').notNull(),  // see JobEventType enum
>   actorAddress: text('actor_address').notNull(),
>   blockNumber: bigint('block_number', { mode: 'bigint' }).notNull(),
>   txHash: text('tx_hash').notNull().unique(),
>   logIndex: integer('log_index').notNull(),
>   data: jsonb('data'),  // event-specific payload (budget amount, deliverable hash, etc.)
>   createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
> }, (table) => ({
>   jobIdx: index('idx_job_events_job').on(table.jobId),
>   blockIdx: index('idx_job_events_block').on(table.blockNumber),
>   typeIdx: index('idx_job_events_type').on(table.eventType),
> }));
>
> export type JobEvent = typeof jobEvents.$inferSelect;
> ```
>
> ### Table 6: `indexer_state`
> Key-value store for indexer bookkeeping (last block, etc.).
>
> ```typescript
> export const indexerState = pgTable('indexer_state', {
>   key: text('key').primaryKey(),
>   value: text('value').notNull(),
>   updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
> });
> ```
>
> ## `client.ts` — DB client
>
> ```typescript
> import { drizzle } from 'drizzle-orm/postgres-js';
> import postgres from 'postgres';
> import * as schema from './schema';
>
> const connectionString = process.env.DATABASE_URL!;
> if (!connectionString) {
>   throw new Error('DATABASE_URL is not set');
> }
>
> // Single connection for serverless / Next.js
> const queryClient = postgres(connectionString, { max: 10 });
>
> export const db = drizzle(queryClient, { schema });
>
> // Export raw client for LISTEN/NOTIFY (Phase 3)
> export const sql = queryClient;
> export * from './schema';
> export * from './enums';
> ```
>
> ## `migrate.ts` — Programmatic migrations
>
> ```typescript
> import 'dotenv/config';
> import { drizzle } from 'drizzle-orm/postgres-js';
> import { migrate } from 'drizzle-orm/postgres-js/migrator';
> import postgres from 'postgres';
>
> const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
> const db = drizzle(sql);
>
> async function main() {
>   console.log('🔧 Running migrations...');
>
>   // Ensure extensions exist BEFORE migrations
>   await sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`;
>   await sql`CREATE EXTENSION IF NOT EXISTS vector`;
>
>   await migrate(db, { migrationsFolder: './migrations' });
>
>   console.log('✅ Migrations complete');
>   await sql.end();
>   process.exit(0);
> }
>
> main().catch((err) => {
>   console.error('❌ Migration failed:', err);
>   process.exit(1);
> });
> ```
>
> ## `drizzle.config.ts`
>
> ```typescript
> import type { Config } from 'drizzle-kit';
>
> export default {
>   schema: './src/schema.ts',
>   out: './migrations',
>   dialect: 'postgresql',
>   dbCredentials: {
>     url: process.env.DATABASE_URL!,
>   },
>   verbose: true,
>   strict: true,
> } satisfies Config;
> ```
>
> ## `index.ts`
>
> ```typescript
> export * from './schema';
> export * from './enums';
> export { db, sql } from './client';
> ```
>
> ## After scaffolding:
>
> 1. Run `pnpm db:generate` from root — this generates SQL migrations in `packages/db/migrations/`
> 2. Open the generated migration file and **verify the SQL looks correct** (CREATE TABLE statements with all indexes)
> 3. Run `pnpm db:migrate` — applies migrations to Postgres
> 4. Run `pnpm typecheck` — must pass clean
>
> Report any errors. Don't write business logic yet — only schema.

### YOU: Run migrations + verify

```bash
# Generate SQL from Drizzle schema
pnpm db:generate

# Review what will be applied
cat packages/db/migrations/0000_*.sql

# Apply
pnpm db:migrate

# Should output:
# 🔧 Running migrations...
# ✅ Migrations complete
```

### YOU: Open Drizzle Studio to inspect

```bash
pnpm db:studio
# Open the URL it prints (usually https://local.drizzle.studio)
```

Verify you see 6 tables, all with the correct columns and indexes.

### YOU: Verify extensions installed

```bash
docker exec -it arc-pg psql -U postgres -d arc_agents -c "\dx"
```

Should show `vector`, `pg_trgm`, and `plpgsql`.

---

## Step 1.4 — Initial Git Commit (YOU, 5 min)

```bash
cd ~/arc-agents-explorer

# Ensure .env is not committed
git check-ignore .env

# Stage and commit
git add .
git commit -m "feat: initial scaffold — monorepo + Postgres + Drizzle schema

- pnpm workspaces with apps/web, apps/indexer, packages/db
- Postgres 16 + pgvector via Docker
- Drizzle ORM schema: agents, feedback_events, validations, jobs, job_events, indexer_state
- GIN indexes on JSONB columns for fast capability search
- Migration tooling configured"

git push -u origin main
```

---

## ✅ Phase 1 Definition of Done

Tick all before moving to Phase 2:

- [ ] `docker ps` shows `arc-pg` container running
- [ ] `pnpm typecheck` from root exits clean
- [ ] `pnpm db:studio` opens and shows 6 tables
- [ ] All 6 tables visible: `agents`, `feedback_events`, `validations`, `jobs`, `job_events`, `indexer_state`
- [ ] Extensions `vector` and `pg_trgm` are installed in DB
- [ ] `.env` is configured with `DATABASE_URL` + `ARC_RPC_URL` + `ARC_RPC_WS`
- [ ] `.env` is NOT committed to Git (check `git status`)
- [ ] Initial commit pushed to GitHub
- [ ] You can run `pnpm install` fresh without errors

---

## 🔥 Common Issues & Fixes

### "Cannot find module '@arc-agents/db'"
The workspace dependency hasn't resolved. Run from root:
```bash
pnpm install
```

### Postgres connection refused
```bash
# Check container is running
docker ps -a | grep arc-pg

# If stopped, restart
docker start arc-pg

# If broken, recreate
docker rm -f arc-pg
# Then re-run the original `docker run` command
```

### "vector extension not available"
You're using regular `postgres:16` instead of `pgvector/pgvector:pg16`. Recreate the container with the correct image.

### Drizzle Kit can't read .env
Make sure `drizzle.config.ts` either imports `dotenv/config` at the top, or you prefix the command:
```bash
DATABASE_URL="postgres://..." pnpm db:generate
```

---

**Next →** Open `02_PHASE_2_BACKFILL.md` to index all historical Arc events.
