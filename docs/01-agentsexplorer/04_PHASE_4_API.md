# Phase 4 — API Layer

> **Goal:** Build type-safe API routes in Next.js 15 that serve all the data the frontend needs — agents, jobs, stats, live feed.

**Estimated time:** 4 hours
**Output:** All API endpoints working, returning real data from Postgres.

---

## 🎯 Outcomes of Phase 4

After this phase:

1. ✅ All API routes implemented and tested
2. ✅ Zod validation on all query params
3. ✅ Pagination, sorting, filtering working
4. ✅ Stats endpoint with 30s in-memory cache
5. ✅ Health check endpoint
6. ✅ WebSocket endpoint for live feed (Postgres LISTEN)
7. ✅ Type-safe DB queries via Drizzle
8. ✅ Test script that hits every endpoint

---

## 📋 Pre-Phase Checklist

- [ ] Phase 3 live indexer is running and current
- [ ] Postgres has real data (agents + jobs)
- [ ] Your own agent #14176 returns correct data via `psql` query

---

## 🌐 API Endpoint Map

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Liveness + DB + indexer status |
| GET | `/api/stats` | Global counts (cached 30s) |
| GET | `/api/agents` | Paginated agent list (sort/filter) |
| GET | `/api/agents/[id]` | Single agent detail + recent activity |
| GET | `/api/agents/[id]/feedback` | Agent's feedback history (paginated) |
| GET | `/api/agents/[id]/jobs` | Jobs where agent was provider |
| GET | `/api/jobs` | Paginated jobs list (sort/filter) |
| GET | `/api/jobs/[id]` | Single job detail + timeline |
| GET | `/api/feed` | Recent activity across all event types |
| GET | `/api/live` | WebSocket — pushes events as they happen |

---

## Step 4.1 — Setup Next.js App (Claude Code, 30 min)

### CLAUDE CODE PROMPT #4.1 — Next.js initialization

> Initialize the Next.js 15 app in `apps/web/`. The package was scaffolded in Phase 1; now wire up the App Router structure, Tailwind, and a minimal layout.
>
> **File structure to create:**
>
> ```
> apps/web/
> ├── src/
> │   ├── app/
> │   │   ├── layout.tsx              # Root layout + global font/CSS
> │   │   ├── page.tsx                # Placeholder home page
> │   │   ├── globals.css             # Tailwind base + theme tokens
> │   │   └── api/
> │   │       └── health/
> │   │           └── route.ts        # GET /api/health
> │   ├── lib/
> │   │   ├── db.ts                   # Re-export shared db client
> │   │   ├── api-helpers.ts          # JSON response helpers + Zod
> │   │   └── format.ts               # Number/address/USDC formatters
> ├── next.config.ts
> ├── tailwind.config.ts
> ├── postcss.config.mjs
> └── tsconfig.json
> ```
>
> ## `next.config.ts`
>
> ```typescript
> import type { NextConfig } from 'next';
>
> const nextConfig: NextConfig = {
>   reactStrictMode: true,
>   transpilePackages: ['@arc-agents/db'],
>   experimental: {
>     serverActions: { allowedOrigins: ['arcagents.io', 'localhost:3000'] },
>   },
> };
>
> export default nextConfig;
> ```
>
> ## `tailwind.config.ts`
>
> Configure dark-first theme with Arc-inspired purple/blue palette.
>
> ```typescript
> import type { Config } from 'tailwindcss';
>
> export default {
>   content: ['./src/**/*.{ts,tsx}'],
>   darkMode: 'class',
>   theme: {
>     extend: {
>       colors: {
>         bg: {
>           DEFAULT: '#0B0D14',
>           subtle: '#12151F',
>           muted: '#1A1E2C',
>         },
>         border: {
>           DEFAULT: '#222838',
>           strong: '#2D3445',
>         },
>         brand: {
>           DEFAULT: '#5B5BD6',
>           hover: '#4A4AC0',
>           subtle: '#1F1F3A',
>         },
>         text: {
>           DEFAULT: '#E6E8EE',
>           muted: '#9095A6',
>           dim: '#6C7185',
>         },
>         success: '#3DDC97',
>         danger: '#F25C54',
>         warning: '#F2C744',
>       },
>       fontFamily: {
>         sans: ['var(--font-geist-sans)', 'system-ui', 'sans-serif'],
>         mono: ['var(--font-geist-mono)', 'monospace'],
>       },
>     },
>   },
>   plugins: [],
> } satisfies Config;
> ```
>
> ## `globals.css`
>
> ```css
> @tailwind base;
> @tailwind components;
> @tailwind utilities;
>
> html {
>   background: #0B0D14;
>   color: #E6E8EE;
>   font-family: var(--font-geist-sans);
> }
>
> body {
>   background: #0B0D14;
>   color: #E6E8EE;
> }
>
> ::selection {
>   background: #5B5BD6;
>   color: white;
> }
> ```
>
> ## `layout.tsx`
>
> ```tsx
> import './globals.css';
> import type { Metadata } from 'next';
> import { GeistSans } from 'geist/font/sans';
> import { GeistMono } from 'geist/font/mono';
>
> export const metadata: Metadata = {
>   title: 'ArcAgents — AI Agent Explorer for Arc',
>   description: 'Browse every ERC-8004 agent on Arc. Reputation, validations, jobs, earnings — all in one place.',
>   openGraph: {
>     title: 'ArcAgents',
>     description: 'The first agent explorer for Arc',
>     url: 'https://arcagents.io',
>     type: 'website',
>   },
> };
>
> export default function RootLayout({ children }: { children: React.ReactNode }) {
>   return (
>     <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
>       <body className="min-h-screen bg-bg text-text">
>         {children}
>       </body>
>     </html>
>   );
> }
> ```
>
> ## `app/page.tsx` (temporary placeholder)
>
> ```tsx
> export default function HomePage() {
>   return (
>     <main className="p-8">
>       <h1 className="text-3xl font-bold">ArcAgents</h1>
>       <p className="text-text-muted mt-2">API is being built. Frontend coming in Phase 5.</p>
>       <p className="mt-4">
>         <a href="/api/health" className="text-brand hover:underline">→ Test API health</a>
>       </p>
>     </main>
>   );
> }
> ```
>
> ## `lib/db.ts`
>
> ```typescript
> export { db, sql } from '@arc-agents/db';
> export * from '@arc-agents/db';
> ```
>
> ## `lib/api-helpers.ts`
>
> ```typescript
> import { NextResponse } from 'next/server';
> import { z, type ZodSchema } from 'zod';
>
> export function ok<T>(data: T, init?: ResponseInit): NextResponse {
>   return NextResponse.json(data, init);
> }
>
> export function badRequest(message: string, details?: unknown): NextResponse {
>   return NextResponse.json({ error: message, details }, { status: 400 });
> }
>
> export function notFound(message = 'Not found'): NextResponse {
>   return NextResponse.json({ error: message }, { status: 404 });
> }
>
> export function serverError(message = 'Internal server error', err?: unknown): NextResponse {
>   console.error('[API ERROR]', message, err);
>   return NextResponse.json({ error: message }, { status: 500 });
> }
>
> export function parseQuery<T extends ZodSchema>(
>   url: URL,
>   schema: T
> ): { ok: true; data: z.infer<T> } | { ok: false; error: string } {
>   const obj: Record<string, string> = {};
>   url.searchParams.forEach((value, key) => { obj[key] = value; });
>   const result = schema.safeParse(obj);
>   if (!result.success) {
>     return { ok: false, error: result.error.message };
>   }
>   return { ok: true, data: result.data };
> }
>
> export const paginationSchema = z.object({
>   limit: z.coerce.number().min(1).max(100).default(20),
>   offset: z.coerce.number().min(0).default(0),
> });
> ```
>
> ## `lib/format.ts`
>
> ```typescript
> export function truncateAddress(addr: string, chars = 4): string {
>   if (!addr || addr.length < 12) return addr;
>   return `${addr.slice(0, 2 + chars)}...${addr.slice(-chars)}`;
> }
>
> export function formatUSDC(raw: string | number | bigint, decimals = 2): string {
>   const value = typeof raw === 'string' ? parseFloat(raw) : Number(raw);
>   return value.toLocaleString('en-US', {
>     minimumFractionDigits: decimals,
>     maximumFractionDigits: decimals,
>   });
> }
>
> export function arcscanTxUrl(hash: string): string {
>   return `https://testnet.arcscan.app/tx/${hash}`;
> }
>
> export function arcscanAddressUrl(addr: string): string {
>   return `https://testnet.arcscan.app/address/${addr}`;
> }
> ```
>
> ## `app/api/health/route.ts`
>
> ```typescript
> import { db, indexerState } from '@/lib/db';
> import { eq } from 'drizzle-orm';
> import { ok, serverError } from '@/lib/api-helpers';
>
> export const dynamic = 'force-dynamic';
>
> export async function GET() {
>   try {
>     const startTime = Date.now();
>     const result = await db.select().from(indexerState).where(eq(indexerState.key, 'last_indexed_block')).limit(1);
>     const dbLatencyMs = Date.now() - startTime;
>
>     const lastBlock = result[0]?.value ?? '0';
>     const lastUpdate = result[0]?.updatedAt ?? null;
>
>     // Detect indexer staleness
>     const ageMs = lastUpdate ? Date.now() - new Date(lastUpdate).getTime() : Infinity;
>     const indexerHealthy = ageMs < 60_000; // 1 minute tolerance
>
>     return ok({
>       status: indexerHealthy ? 'ok' : 'degraded',
>       db: { connected: true, latencyMs: dbLatencyMs },
>       indexer: {
>         lastBlock,
>         lastUpdate,
>         ageSeconds: Math.floor(ageMs / 1000),
>         healthy: indexerHealthy,
>       },
>       timestamp: new Date().toISOString(),
>     });
>   } catch (err) {
>     return serverError('Health check failed', err);
>   }
> }
> ```
>
> ## Set up path aliases in `tsconfig.json`:
>
> ```json
> {
>   "compilerOptions": {
>     "paths": {
>       "@/*": ["./src/*"]
>     }
>   }
> }
> ```
>
> Verify:
> 1. `pnpm typecheck` passes
> 2. `pnpm dev:web` starts on port 3000
> 3. Visit `http://localhost:3000` → see placeholder page
> 4. Visit `http://localhost:3000/api/health` → see JSON health response
>
> Don't add other routes yet — confirm health works first.

### YOU: Verify health endpoint

```bash
pnpm dev:web

# Different terminal
curl http://localhost:3000/api/health | jq
```

Expected:
```json
{
  "status": "ok",
  "db": { "connected": true, "latencyMs": 12 },
  "indexer": {
    "lastBlock": "5234210",
    "lastUpdate": "2026-05-17T...",
    "ageSeconds": 3,
    "healthy": true
  }
}
```

---

## Step 4.2 — Stats Endpoint with Caching (Claude Code, 30 min)

### CLAUDE CODE PROMPT #4.2 — Stats endpoint

> Build the `/api/stats` endpoint with in-memory caching (30s TTL).
>
> ## `lib/cache.ts`
>
> ```typescript
> interface CacheEntry<T> {
>   value: T;
>   expiresAt: number;
> }
>
> const cache = new Map<string, CacheEntry<unknown>>();
>
> export async function cached<T>(
>   key: string,
>   ttlMs: number,
>   fetcher: () => Promise<T>
> ): Promise<T> {
>   const now = Date.now();
>   const hit = cache.get(key);
>   if (hit && hit.expiresAt > now) {
>     return hit.value as T;
>   }
>   const value = await fetcher();
>   cache.set(key, { value, expiresAt: now + ttlMs });
>   return value;
> }
> ```
>
> ## `app/api/stats/route.ts`
>
> ```typescript
> import { db, agents, jobs, feedbackEvents, sql as drizzleSql } from '@/lib/db';
> import { count, sum, desc, gte, and, eq } from 'drizzle-orm';
> import { ok, serverError } from '@/lib/api-helpers';
> import { cached } from '@/lib/cache';
>
> export const dynamic = 'force-dynamic';
>
> async function computeStats() {
>   const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
>
>   const [
>     totalAgentsRow,
>     totalJobsRow,
>     completedJobsAggRow,
>     last24hAgentsRow,
>     last24hJobsRow,
>     last24hUsdcRow,
>     topAgentsByReputation,
>     topAgentsByEarnings,
>   ] = await Promise.all([
>     db.select({ count: count() }).from(agents),
>     db.select({ count: count() }).from(jobs),
>     db.select({
>       count: count(),
>       sum: sum(jobs.budgetUsdc),
>     }).from(jobs).where(eq(jobs.status, 'Completed')),
>     db.select({ count: count() }).from(agents).where(gte(agents.createdAt, oneDayAgo)),
>     db.select({ count: count() }).from(jobs).where(gte(jobs.createdAt, oneDayAgo)),
>     db.select({
>       sum: sum(jobs.budgetUsdc),
>     }).from(jobs).where(and(eq(jobs.status, 'Completed'), gte(jobs.createdAt, oneDayAgo))),
>     db.select({
>       agentId: agents.agentId,
>       name: agents.name,
>       reputationScore: agents.reputationScore,
>       feedbackCount: agents.feedbackCount,
>     }).from(agents)
>       .where(drizzleSql`reputation_score IS NOT NULL`)
>       .orderBy(desc(agents.reputationScore))
>       .limit(10),
>     db.select({
>       agentId: agents.agentId,
>       name: agents.name,
>       usdcEarned: agents.usdcEarned,
>       jobsCompleted: agents.jobsCompleted,
>     }).from(agents).orderBy(desc(agents.usdcEarned)).limit(10),
>   ]);
>
>   return {
>     totals: {
>       agents: Number(totalAgentsRow[0]?.count ?? 0),
>       jobs: Number(totalJobsRow[0]?.count ?? 0),
>       completedJobs: Number(completedJobsAggRow[0]?.count ?? 0),
>       usdcVolume: completedJobsAggRow[0]?.sum ?? '0',
>     },
>     last24h: {
>       newAgents: Number(last24hAgentsRow[0]?.count ?? 0),
>       newJobs: Number(last24hJobsRow[0]?.count ?? 0),
>       usdcVolume: last24hUsdcRow[0]?.sum ?? '0',
>     },
>     topAgents: {
>       byReputation: topAgentsByReputation,
>       byEarnings: topAgentsByEarnings,
>     },
>     updatedAt: new Date().toISOString(),
>   };
> }
>
> export async function GET() {
>   try {
>     const stats = await cached('stats:global', 30_000, computeStats);
>     return ok(stats);
>   } catch (err) {
>     return serverError('Stats query failed', err);
>   }
> }
> ```
>
> Test: `curl http://localhost:3000/api/stats | jq` should return real numbers.

### YOU: Verify

```bash
curl http://localhost:3000/api/stats | jq '.totals'
```

Should show real numbers like:
```json
{
  "agents": 14180,
  "jobs": 20051,
  "completedJobs": 8432,
  "usdcVolume": "12450.50"
}
```

---

## Step 4.3 — Agents Endpoints (Claude Code, 60 min)

### CLAUDE CODE PROMPT #4.3 — Agents API

> Build the agents endpoints: list + detail + feedback + jobs.
>
> ## `app/api/agents/route.ts` — List
>
> ```typescript
> import { db, agents, sql as drizzleSql } from '@/lib/db';
> import { count, desc, asc, sql, and, ilike, or } from 'drizzle-orm';
> import { z } from 'zod';
> import { ok, badRequest, serverError, parseQuery, paginationSchema } from '@/lib/api-helpers';
>
> export const dynamic = 'force-dynamic';
>
> const schema = paginationSchema.extend({
>   sort: z.enum(['recent', 'reputation', 'earned', 'jobs']).default('recent'),
>   search: z.string().optional(),
>   minReputation: z.coerce.number().min(0).max(100).optional(),
>   validated: z.enum(['true', 'false']).optional(),
> });
>
> export async function GET(req: Request) {
>   try {
>     const url = new URL(req.url);
>     const parsed = parseQuery(url, schema);
>     if (!parsed.ok) return badRequest(parsed.error);
>     const q = parsed.data;
>
>     const whereParts = [];
>     if (q.search) {
>       const pattern = `%${q.search}%`;
>       whereParts.push(or(
>         ilike(agents.name, pattern),
>         ilike(agents.ownerAddress, pattern),
>         drizzleSql`agent_id::text ILIKE ${pattern}`,
>       ));
>     }
>     if (q.minReputation !== undefined) {
>       whereParts.push(drizzleSql`reputation_score >= ${q.minReputation}`);
>     }
>     if (q.validated === 'true') {
>       whereParts.push(drizzleSql`validation_status = 'PASSED'`);
>     }
>
>     const whereClause = whereParts.length > 0 ? and(...whereParts) : undefined;
>
>     let orderBy;
>     switch (q.sort) {
>       case 'reputation':
>         orderBy = desc(agents.reputationScore);
>         break;
>       case 'earned':
>         orderBy = desc(agents.usdcEarned);
>         break;
>       case 'jobs':
>         orderBy = desc(agents.jobsCompleted);
>         break;
>       case 'recent':
>       default:
>         orderBy = desc(agents.registeredAtBlock);
>     }
>
>     const [rows, totalRow] = await Promise.all([
>       db.select({
>         agentId: agents.agentId,
>         ownerAddress: agents.ownerAddress,
>         name: agents.name,
>         agentType: agents.agentType,
>         capabilities: agents.capabilities,
>         reputationScore: agents.reputationScore,
>         feedbackCount: agents.feedbackCount,
>         validationStatus: agents.validationStatus,
>         jobsCompleted: agents.jobsCompleted,
>         usdcEarned: agents.usdcEarned,
>         registeredAtBlock: agents.registeredAtBlock,
>       })
>         .from(agents)
>         .where(whereClause)
>         .orderBy(orderBy)
>         .limit(q.limit)
>         .offset(q.offset),
>       db.select({ count: count() }).from(agents).where(whereClause),
>     ]);
>
>     return ok({
>       agents: rows,
>       total: Number(totalRow[0]?.count ?? 0),
>       limit: q.limit,
>       offset: q.offset,
>     });
>   } catch (err) {
>     return serverError('Failed to list agents', err);
>   }
> }
> ```
>
> ## `app/api/agents/[id]/route.ts` — Detail
>
> ```typescript
> import { db, agents, feedbackEvents, validations, jobs } from '@/lib/db';
> import { eq, desc } from 'drizzle-orm';
> import { ok, notFound, serverError } from '@/lib/api-helpers';
>
> export const dynamic = 'force-dynamic';
>
> export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
>   try {
>     const { id } = await params;
>     const agentId = BigInt(id);
>
>     const [agent] = await db.select().from(agents).where(eq(agents.agentId, agentId)).limit(1);
>     if (!agent) return notFound('Agent not found');
>
>     const [recentFeedback, allValidations, recentJobs] = await Promise.all([
>       db.select().from(feedbackEvents).where(eq(feedbackEvents.agentId, agentId)).orderBy(desc(feedbackEvents.blockNumber)).limit(20),
>       db.select().from(validations).where(eq(validations.agentId, agentId)).orderBy(desc(validations.requestedAtBlock)),
>       db.select().from(jobs).where(eq(jobs.providerAddress, agent.ownerAddress.toLowerCase())).orderBy(desc(jobs.createdAtBlock)).limit(20),
>     ]);
>
>     return ok({
>       agent,
>       feedback: recentFeedback,
>       validations: allValidations,
>       recentJobs,
>     });
>   } catch (err) {
>     return serverError('Failed to fetch agent', err);
>   }
> }
> ```
>
> ## `app/api/agents/[id]/feedback/route.ts`
>
> ```typescript
> import { db, feedbackEvents } from '@/lib/db';
> import { eq, count, desc } from 'drizzle-orm';
> import { ok, parseQuery, paginationSchema, badRequest, serverError } from '@/lib/api-helpers';
>
> export const dynamic = 'force-dynamic';
>
> export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
>   try {
>     const { id } = await params;
>     const agentId = BigInt(id);
>     const parsed = parseQuery(new URL(req.url), paginationSchema);
>     if (!parsed.ok) return badRequest(parsed.error);
>
>     const [rows, totalRow] = await Promise.all([
>       db.select().from(feedbackEvents)
>         .where(eq(feedbackEvents.agentId, agentId))
>         .orderBy(desc(feedbackEvents.blockNumber))
>         .limit(parsed.data.limit)
>         .offset(parsed.data.offset),
>       db.select({ count: count() }).from(feedbackEvents).where(eq(feedbackEvents.agentId, agentId)),
>     ]);
>
>     return ok({
>       feedback: rows,
>       total: Number(totalRow[0]?.count ?? 0),
>       limit: parsed.data.limit,
>       offset: parsed.data.offset,
>     });
>   } catch (err) {
>     return serverError('Failed to fetch feedback', err);
>   }
> }
> ```
>
> ## `app/api/agents/[id]/jobs/route.ts`
>
> Same pattern — query `jobs` table where `providerAddress` matches the agent's owner address.
>
> Implement all three, run typecheck, then test with curl.

### YOU: Verify each endpoint

```bash
# List
curl 'http://localhost:3000/api/agents?sort=reputation&limit=5' | jq '.agents[].name'

# Search
curl 'http://localhost:3000/api/agents?search=translation' | jq '.total'

# Your agent
curl 'http://localhost:3000/api/agents/14176' | jq '.agent.name, .agent.reputationScore'

# Your agent's feedback
curl 'http://localhost:3000/api/agents/14176/feedback' | jq '.feedback[0]'

# Your agent's jobs
curl 'http://localhost:3000/api/agents/14176/jobs' | jq '.[0]'
```

---

## Step 4.4 — Jobs Endpoints (Claude Code, 30 min)

### CLAUDE CODE PROMPT #4.4 — Jobs API

> Mirror the agents pattern for jobs.
>
> ## `app/api/jobs/route.ts` — List
>
> Query params:
> - `status`: filter (`Open`, `Funded`, `Submitted`, `Completed`, `Rejected`, `Expired`)
> - `sort`: `recent` (default) or `biggest` (by budget)
> - `limit`, `offset`
>
> Join with agents table to embed provider info:
>
> ```typescript
> const result = await db
>   .select({
>     job: jobs,
>     providerAgent: {
>       agentId: agents.agentId,
>       name: agents.name,
>       reputationScore: agents.reputationScore,
>     },
>   })
>   .from(jobs)
>   .leftJoin(agents, sql`LOWER(${agents.ownerAddress}) = LOWER(${jobs.providerAddress})`)
>   .where(whereClause)
>   .orderBy(orderBy)
>   .limit(q.limit)
>   .offset(q.offset);
> ```
>
> ## `app/api/jobs/[id]/route.ts` — Detail
>
> Include event timeline from `jobEvents` table, ordered chronologically.
>
> ```typescript
> const [job] = await db.select().from(jobs).where(eq(jobs.jobId, jobId)).limit(1);
> const timeline = await db.select().from(jobEvents).where(eq(jobEvents.jobId, jobId)).orderBy(asc(jobEvents.blockNumber));
> ```
>
> Test each endpoint with curl.

### YOU: Verify

```bash
# All completed jobs
curl 'http://localhost:3000/api/jobs?status=Completed&limit=5' | jq

# Your job
curl 'http://localhost:3000/api/jobs/20049' | jq

# Timeline should have multiple events
curl 'http://localhost:3000/api/jobs/20049' | jq '.timeline | length'
```

---

## Step 4.5 — Feed Endpoint (Claude Code, 20 min)

### CLAUDE CODE PROMPT #4.5 — Activity feed

> Build `/api/feed` — recent events across all types, merged into a single timeline.
>
> ## `app/api/feed/route.ts`
>
> ```typescript
> import { db, agents, feedbackEvents, jobEvents } from '@/lib/db';
> import { desc, sql } from 'drizzle-orm';
> import { ok, serverError } from '@/lib/api-helpers';
>
> export const dynamic = 'force-dynamic';
>
> export async function GET() {
>   try {
>     // Use UNION ALL via raw SQL for performance
>     const rows = await db.execute(sql`
>       SELECT * FROM (
>         SELECT 'agent_registered' AS kind, agent_id::text AS ref_id, owner_address AS actor, registered_at_block AS block, registered_tx_hash AS tx_hash, name AS extra
>         FROM agents
>         ORDER BY registered_at_block DESC
>         LIMIT 30
>       ) a
>       UNION ALL
>       SELECT * FROM (
>         SELECT 'feedback_given' AS kind, agent_id::text, validator_address, block_number, tx_hash, score::text
>         FROM feedback_events
>         ORDER BY block_number DESC
>         LIMIT 30
>       ) b
>       UNION ALL
>       SELECT * FROM (
>         SELECT event_type AS kind, job_id::text, actor_address, block_number, tx_hash, NULL AS extra
>         FROM job_events
>         ORDER BY block_number DESC
>         LIMIT 30
>       ) c
>       ORDER BY block DESC
>       LIMIT 50
>     `);
>
>     return ok({ feed: rows });
>   } catch (err) {
>     return serverError('Failed to fetch feed', err);
>   }
> }
> ```
>
> Test: `curl http://localhost:3000/api/feed | jq '.feed | length'` should return 50.

---

## Step 4.6 — Live WebSocket Endpoint (Claude Code, 45 min)

This is the most complex endpoint. It uses Postgres LISTEN to push events to browsers.

### CLAUDE CODE PROMPT #4.6 — WebSocket live feed

> Build the WebSocket endpoint for live events. Next.js App Router doesn't natively support WebSockets in API routes, so use a different approach.
>
> **Approach: Use Server-Sent Events (SSE)** — simpler than raw WebSocket, supported natively by Next.js, fully bi-directional isn't needed (only server → client).
>
> ## `app/api/live/route.ts`
>
> ```typescript
> import { sql } from '@/lib/db';
>
> export const dynamic = 'force-dynamic';
> export const runtime = 'nodejs';  // not edge — need postgres LISTEN
>
> export async function GET() {
>   const encoder = new TextEncoder();
>   const stream = new ReadableStream({
>     async start(controller) {
>       // Create a dedicated connection for LISTEN (must not be pooled)
>       const listenSql = (await import('postgres')).default(process.env.DATABASE_URL!, {
>         max: 1,
>         idle_timeout: 0,
>       });
>
>       // Send initial connection ack
>       controller.enqueue(encoder.encode(`event: connected\ndata: ${JSON.stringify({ time: Date.now() })}\n\n`));
>
>       // Heartbeat every 15s to keep connection alive through proxies
>       const heartbeat = setInterval(() => {
>         try {
>           controller.enqueue(encoder.encode(`event: ping\ndata: ${JSON.stringify({ time: Date.now() })}\n\n`));
>         } catch {}
>       }, 15_000);
>
>       // Subscribe to Postgres NOTIFY
>       const subscription = listenSql.listen('arc_events', (payload) => {
>         try {
>           controller.enqueue(encoder.encode(`event: arc_event\ndata: ${payload}\n\n`));
>         } catch (err) {
>           // Stream closed, clean up
>           clearInterval(heartbeat);
>           subscription.unlisten();
>           listenSql.end();
>         }
>       });
>
>       // Cleanup on close
>       const cleanup = () => {
>         clearInterval(heartbeat);
>         subscription.then(s => s.unlisten()).catch(() => {});
>         listenSql.end().catch(() => {});
>         try {
>           controller.close();
>         } catch {}
>       };
>
>       // The stream's cancel() callback will fire when client disconnects
>       (stream as any)._cleanup = cleanup;
>     },
>     cancel() {
>       const cleanup = (this as any)._cleanup;
>       if (cleanup) cleanup();
>     },
>   });
>
>   return new Response(stream, {
>     headers: {
>       'Content-Type': 'text/event-stream',
>       'Cache-Control': 'no-cache, no-transform',
>       'Connection': 'keep-alive',
>       'X-Accel-Buffering': 'no',  // disable nginx buffering
>     },
>   });
> }
> ```
>
> **Why SSE over WebSocket:**
> - Native to Next.js (works on Vercel and self-hosted)
> - Simpler reconnect logic in browser (built-in)
> - Auto-handles HTTP/2 multiplexing
> - We only need server → client push
>
> The frontend will consume this with `new EventSource('/api/live')` in Phase 5.
>
> Test from terminal:
> ```bash
> curl -N http://localhost:3000/api/live
> ```
> Should print `event: connected\ndata: {...}` immediately, then `event: ping` every 15s.
>
> If you run `npm run register` in your demo project, a `event: arc_event` line should appear within 5 seconds.

### YOU: Test SSE

```bash
# Terminal 1
curl -N http://localhost:3000/api/live

# Terminal 2 — trigger an event
cd ~/arc-agent-demo
npm run register

# Terminal 1 should print:
# event: arc_event
# data: { "blockNumber": "...", "events": [{ "kind": "AgentRegistered", ... }] }
```

✅ If event arrives within 5 seconds, the full live pipeline works.

---

## Step 4.7 — Integration Test Script (Claude Code, 20 min)

### CLAUDE CODE PROMPT #4.7 — Test script

> Create `apps/web/scripts/test-api.ts` — a script that hits every endpoint and prints a pass/fail summary.
>
> ```typescript
> import 'dotenv/config';
>
> const BASE = process.env.API_BASE ?? 'http://localhost:3000';
>
> interface Test {
>   name: string;
>   path: string;
>   check: (res: any) => boolean | string;  // return true or error message
> }
>
> const tests: Test[] = [
>   {
>     name: 'Health',
>     path: '/api/health',
>     check: (r) => r.status === 'ok' || `status: ${r.status}`,
>   },
>   {
>     name: 'Stats',
>     path: '/api/stats',
>     check: (r) => typeof r.totals?.agents === 'number' || 'no totals.agents',
>   },
>   {
>     name: 'List Agents (recent)',
>     path: '/api/agents?sort=recent&limit=5',
>     check: (r) => Array.isArray(r.agents) || 'agents not array',
>   },
>   {
>     name: 'List Agents (reputation)',
>     path: '/api/agents?sort=reputation&limit=5',
>     check: (r) => Array.isArray(r.agents) || 'agents not array',
>   },
>   {
>     name: 'Search Agents',
>     path: '/api/agents?search=translation',
>     check: (r) => Array.isArray(r.agents) || 'agents not array',
>   },
>   {
>     name: 'Agent Detail',
>     path: '/api/agents/14176',
>     check: (r) => r.agent?.agentId === '14176' || `agentId: ${r.agent?.agentId}`,
>   },
>   {
>     name: 'Agent Feedback',
>     path: '/api/agents/14176/feedback',
>     check: (r) => Array.isArray(r.feedback) || 'feedback not array',
>   },
>   {
>     name: 'List Jobs',
>     path: '/api/jobs?sort=recent&limit=5',
>     check: (r) => Array.isArray(r.jobs) || 'jobs not array',
>   },
>   {
>     name: 'Job Detail',
>     path: '/api/jobs/20049',
>     check: (r) => r.job?.jobId === '20049' || `jobId: ${r.job?.jobId}`,
>   },
>   {
>     name: 'Feed',
>     path: '/api/feed',
>     check: (r) => Array.isArray(r.feed) || 'feed not array',
>   },
> ];
>
> async function run() {
>   let pass = 0;
>   let fail = 0;
>
>   console.log(`\n🧪 Testing API at ${BASE}\n`);
>   for (const t of tests) {
>     try {
>       const res = await fetch(BASE + t.path);
>       const json = await res.json();
>       const result = t.check(json);
>       if (result === true) {
>         console.log(`  ✅ ${t.name}`);
>         pass++;
>       } else {
>         console.log(`  ❌ ${t.name}: ${result}`);
>         fail++;
>       }
>     } catch (err) {
>       console.log(`  ❌ ${t.name}: ${(err as Error).message}`);
>       fail++;
>     }
>   }
>
>   console.log(`\n${pass} passed, ${fail} failed\n`);
>   process.exit(fail === 0 ? 0 : 1);
> }
>
> run();
> ```
>
> Add to `package.json`: `"test:api": "tsx scripts/test-api.ts"`
>
> Run with `pnpm --filter web test:api`

### YOU: Run the test

```bash
pnpm dev:web  # in one terminal

# In another
cd apps/web
pnpm test:api
```

Should output:
```
🧪 Testing API at http://localhost:3000

  ✅ Health
  ✅ Stats
  ✅ List Agents (recent)
  ...

10 passed, 0 failed
```

---

## ✅ Phase 4 Definition of Done

- [ ] `pnpm test:api` shows 10/10 passing
- [ ] `/api/health` returns 200 with `status: 'ok'`
- [ ] `/api/stats` returns real numbers, second call is faster (cache works)
- [ ] `/api/agents/14176` returns your translation agent
- [ ] `/api/jobs/20049` returns your job with timeline events
- [ ] `/api/live` SSE stream stays open and pushes events
- [ ] All endpoints have Zod validation on query params
- [ ] `pnpm typecheck` passes
- [ ] Committed to Git

### Git commit

```bash
git add .
git commit -m "feat: API layer with full CRUD endpoints (Phase 4)

- /api/health: liveness + DB latency + indexer freshness
- /api/stats: cached aggregates (30s TTL)
- /api/agents: list with sort/filter/search, detail with embedded relations
- /api/agents/[id]/feedback and /jobs: paginated children
- /api/jobs: list with provider agent join
- /api/jobs/[id]: detail with event timeline
- /api/feed: cross-table activity stream
- /api/live: Server-Sent Events with Postgres LISTEN/NOTIFY
- Zod validation on all query params
- Integration test script (10 endpoints, all green)"
git push
```

---

## 🔥 Common Issues & Fixes

### BigInt JSON serialization errors
Add at top of any route file with bigints:
```typescript
declare global {
  interface BigInt { toJSON(): string; }
}
BigInt.prototype.toJSON = function() { return this.toString(); };
```

Or convert before returning JSON.

### SSE drops every 30 seconds
Nginx is buffering or timing out. Add to nginx config (Phase 6):
```
proxy_buffering off;
proxy_cache off;
proxy_read_timeout 24h;
```

### Stats endpoint slow on first hit
Normal — first call hits the DB. Second call (within 30s) is instant from cache.

### "relation does not exist" errors
The web app's DB client is pointing to wrong DB. Verify `.env` has correct `DATABASE_URL` and that Next.js is loading it (`next dev` loads `.env.local` first, then `.env`).

---

**Next →** Open `05_PHASE_5_FRONTEND.md` to build the public-facing UI.
