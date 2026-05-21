# AGENTS.md

pnpm monorepo (Node 22, TypeScript strict, Drizzle ORM, viem, Next.js 15 App Router, React 19, Tailwind v4, shadcn/ui).

Workspaces: `indexer/*`, `rating`, `web`, `packages/*`. See `CLAUDE.md` for full architecture narrative.

## Commands

```bash
pnpm install                    # install all workspaces
pnpm typecheck                  # tsc --noEmit across all workspaces (recursive)

# DB (always generate → migrate, in that order)
pnpm db:generate                # drizzle-kit generate → SQL in packages/db/migrations/
pnpm db:migrate                 # apply migrations via packages/db/src/migrate.ts
pnpm db:studio                  # drizzle-kit studio

# Indexer
pnpm dev:indexer:backfill       # one-shot Arc backfill (reads .env from repo root)
pnpm dev:indexer:live           # long-running Arc live listener
pnpm build:indexer              # tsc emit into indexer/arc/dist
pnpm start:indexer:live         # production: runs compiled live listener

# Web
pnpm dev:web                    # next dev on :3000
pnpm build:web                  # next build
pnpm start:web                  # next start (production, used by systemd)
pnpm --filter web test:api      # web/scripts/test-api.ts

# Base backfill (optional, uses Alchemy free tier)
pnpm --filter @arc-agents/indexer-base backfill -- --window-days=3 --batch-size=10

# Rating research scripts (NOT a server yet, engine code is stubs)
pnpm --filter @arc-agents/rating spike:base
pnpm --filter @arc-agents/rating spike:pd
```

Backfill also takes `MAX_BLOCK` env var to cap range.

## Environment

Single `.env` at repo root (loaded by the Arc indexer via `tsx --env-file=../../.env`). Next.js loads `.env.local` via its own mechanism. Required vars:

```
DATABASE_URL=postgres://postgres:arcdev@localhost:5432/arc_agents
ARC_RPC_URL=…  ARC_RPC_WS=…  ARC_CHAIN_ID=5042002
IDENTITY_REGISTRY=0x8004A818BFB912233c491871b3d84c89A494BD9e
REPUTATION_REGISTRY=0x8004B663056A597Dffe9eCcC1965A193B7388713
VALIDATION_REGISTRY=0x8004Cb1BF31DAf7788923b405b754f57acEB4272
AGENTIC_COMMERCE=0x0747EEf0706327138c69792bF28Cd525089e4583
USDC_CONTRACT=0x3600000000000000000000000000000000000000
DEPLOYMENT_BLOCK=…
# Optional: BASE_RPC_URL=… BASE_RPC_WS=…
```

Postgres runs in Docker locally (`pgvector/pgvector:pg16`). Start with: `docker run -d --name arc-pg -e POSTGRES_PASSWORD=arcdev -e POSTGRES_DB=arc_agents -p 5432:5432 -v ~/arc-pg-data:/var/lib/postgresql/data pgvector/pgvector:pg16`

## Architecture Gotchas

**Shared backfill core.** `indexer/shared/backfill-core.ts` exports `runBackfill()` — both Arc (`indexer/arc/backfill.ts`) and Base (`indexer/base/backfill.ts`) inject their own `parseLog` and `applyEvents`. The Base indexer reuses Arc's parsers/handlers via relative imports (`../../indexer/arc/lib/`). When changing event handling, edit `indexer/arc/lib/handlers.ts` — Base picks it up automatically. `applyEvents(events, chainId)` tags rows with the correct `chain_id`.

**Handler quirks in `indexer/arc/lib/handlers.ts`:**
- Before inserting `feedback_events` or `validations`, the handler does an `ON CONFLICT DO NOTHING` insert into `agents` with empty `ownerAddress` and `registeredAtBlock=0`. This keeps FKs valid when an agent was registered before our backfill window. A real `AgentRegistered` event later does NOT overwrite.
- `reputation_score` and `feedback_count` on `agents` are recomputed inline via raw `UPDATE … SELECT AVG/COUNT` after each feedback insert. O(n) per event — fine at current volume.

**Live indexer → pg_notify → SSE.** The live indexer calls `pg_notify('arc_events', …)` once per block. `web/src/app/api/live/route.ts` opens its own `postgres` connection and `LISTEN`s on `arc_events`, re-emitting as SSE with a 15s heartbeat. If payload > 7000 bytes, falls back to a compact summary.

**BigInt serialization.** `web/src/lib/db.ts` monkey-patches `BigInt.prototype.toJSON` so JSON responses can serialize `bigint` columns. New API routes that return bigints need this.

**Nginx SSE config.** `/api/live` needs `proxy_buffering off` and `proxy_read_timeout 24h`. Already configured at `deploy/nginx-arcagents.conf`. Same setup required for any new streaming endpoint.

**Tailwind v4, dark default.** No `tailwind.config.ts` — uses `@theme` in CSS. Dark mode is the default. shadcn/ui uses "new-york" style, RSC, CSS variables.

**Next.js config.** `next.config.ts` has `transpilePackages: ['@arc-agents/db']` because the shared DB package is imported as source (no build step).

## Database

Sole source of truth: `packages/db/src/schema.ts` — 6 tables (`agents`, `feedback_events`, `validations`, `jobs`, `job_events`, `indexer_state`). Every event table has a `chain_id` column (default `'arc'`). `packages/db/src/client.ts` exports both typed `db` (drizzle) and raw `sql` (postgres-js). Use `sql` for `pg_notify`/`LISTEN`; `db` for everything else.

## Rating Engine (ArcRating)

**CRITICAL: `rating/engine/` stubs are OUTDATED and do NOT match the methodology.** `rating/engine/rating.ts` has old, incorrect tier mappings (uses LGD thresholds, wrong PD bands). The authoritative tier definitions are in `docs/02-riskmodel/01-Methodology.md` §3.1:

| Tier | PD Band |
|------|---------|
| Arc-AAA | <0.5% |
| Arc-AA | 0.5-1.5% |
| Arc-A | 1.5-3.0% |
| Arc-BBB | 3.0-6.0% |
| Arc-BB | 6.0-12.0% |
| Arc-B | 12.0-20.0% |
| Arc-CCC | 20.0-35.0% |
| Arc-CC | 35.0-60.0% |
| Arc-D | >60% |

The `pd-sanity.ts` script also has outdated tier boundaries. All engine modules are stubs scheduled for implementation Friday May 22 per the Phase 1 plan.

**Active build context.** The repo is in Phase 1, Week 1 of the rating service build. `docs/02-riskmodel/02-Roadmap.md` is the authoritative plan; `phase1.md` has the day-by-day breakdown. The hard checkpoint is Monday June 15. Current working branch: `restructure/rating-service-prep`.

Engine files: `rating/engine/{pd,lgd,ead,rating}.ts` → methodology §§3-6. No API endpoint is wired yet. Target URL: `rating-arcagents.poko.blue`.

**Base chain contracts** — `indexer/shared/chain-config.ts`: ValidationRegistry and AgenticCommerce on Base are NOT yet deployed (sentinel empty addresses `''`). IdentityRegistry: `0x8004A169…`, ReputationRegistry: `0x8004BAa1…`.

## Deployment

Single VPS, user `huicom`. Two systemd services managed by `deploy/deploy.sh`:
- `arc-indexer-live.service` → `pnpm start:indexer:live`
- `arc-web.service` → `pnpm start:web` (port 3000)

nginx terminates TLS for `arcagents.poko.blue`, proxies to `localhost:3000`. Logs at `/var/log/arc-{indexer,web}{,-err}.log`. Log rotate config at `deploy/logrotate-arcagents.conf`.
