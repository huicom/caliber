# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Obsidian notes mapping (this project)

This repo's Obsidian vault folder is **`~/obsidian-vault/01 - Projects/15 - Caliber/`**.
(Vault sync + general PARA rules live in `~/.claude/CLAUDE.md`.)

- **Write Caliber session/decision/pattern notes to that folder ONLY** — do not split to
  `03 - Resources/` or anywhere else for this project.
- **Read only that folder by default.** Read the rest of the vault solely when explicitly
  asked, treated as one-time scoped permission.
- Frontmatter `project: Caliber`, tags include `caliber`. Filenames `YYYY-MM-DD <topic>.md`.

## Project

**Caliber** — a counterparty performance rating for ERC-8004 AI agents on Arc Testnet (chain 5042002), live at [caliber.poko.blue](https://caliber.poko.blue). API at [caliber-api.poko.blue](https://caliber-api.poko.blue). Methodology **v2.1.0** (announced and active on Arc Testnet 2026-06-14; 2026-06-14 → 2026-07-14 is the dual-version acceptance window, during which both v2.0.1 and v2.1.0 attestations verify on-chain; the 30-day-notice-before-effective-date rule still governs any future production/mainnet deployment) published openly at `caliber.poko.blue/methodology` (source: `docs/02-riskmodel/01-Methodology.md`).

**Current state (2026-05-28):** Methodology v2.0.1 shipped (metallurgical tier rename + calibration against the first ~900-agent rated cohort). Phase 2 voyage is fully merged to `main` and deployed. Circle Gateway x402 end-to-end is live. Phase 0 ops hardening (pg backup, banner restore, nodejs hold) landed today.

- **Human surface (gatekeeper layer):** `/passport/arc/[id]` (per-agent proof page + OG card + embed badge + off-chain verifier at `/verify`), `/discover` + `/discover/category/[slug]` (semantic search + clustered category browse), `/watchlist` + `/api/watchlist` + `/watchlist.rss` + `/watchlist/subscribe` (Discord webhook subscriptions).
- **AI-native surface:** pgvector 384-dim embeddings, `POST /api/v1/route` (intent → signed attestation in one call), `@caliber/sdk` v0.1 in `packages/sdk/`.
- **Circle integrations (shipped):** USDC settlement on Arc, Circle Programmable Wallets + Modular Wallets on `/jobs/new`, Circle Gateway via the batched-settlement x402 SDK (EIP-3009 signature → half-cent nanopayment queued in the seller batch), per-job rating attestations issued through that x402 flow.
- **Indexer:** auto-categorizes new agents at IPFS metadata-fetch time. Embedding catch-up runs every 15 min via `caliber-embed-pending.timer`. Daily Sentinel snapshot at 04:00 UTC writes `rating_snapshots` + emits `tier_transitions` + fans out Discord webhooks.

Live counts (2026-05-28, from `/api/stats`): **24,219 agents indexed · 56,709 jobs · 27,894 completed · 17,807 USDC volume**. Last 24h: 364 new agents, 2,010 new jobs. ~900 agents rated under v2.0.1 (Gold 9 · Silver ~130 · Bronze ~18 at the time of methodology paper publication; counts grow with each Sentinel run). 8 visible categories.

## Methodology pivot (v1 → v2)

The first published Caliber methodology used credit-rating vocabulary (Caliber-AAA … Caliber-D, PD/LGD/EAD/EL, logistic-form scorecard). It was rejected on 2026-05-22 because the dataset does not support credit-rating-grade claims. The current v2.0.1 methodology uses **counterparty performance rating** vocabulary with a **medal scheme** (intentionally not letter grades — every culture recognises Gold > Silver > Bronze without inheriting credit-rating semantics):

- **Tiers:** `Gold | Silver | Bronze | Pending | Watch | Dormant` (6 values; ordinals 0–5 in `rating/engine/types.ts`)
- **Score:** 0–100 (50% smoothed reliability + 25% forward estimate + 15% network diversity + 10% latency consistency)
- **Confidence:** `high | moderate | low | insufficient` (cutoffs in completed jobs: ≥50 high, ≥20 moderate, ≥5 low, else insufficient → no rating issued)
- **Flags:** 5 rule-based risk flags (`CounterpartyConcentration | ValidatorConcentration | SybilPattern | VolumeAnomaly | Dormancy`) — any flag pushes to Watch; Dormancy pushes to Dormant
- **Bond rates:** configurable on-chain (admin-set, event-logged, capped at 50% of budget). The methodology paper does not pin specific bps per tier — the bond table is operational, not methodological, and lives at `caliber.poko.blue/integrate`. Material changes follow the same 30-day notice rule as methodology version changes.
- **Methodology version:** `2.1.0` (signer stamps every attestation with this). v2.1.0 adds the **adverse-evidence factor**: negative validator feedback (a `feedback_events` row with `score < 50`, e.g. a signed conformance breach) now nets against the network-endorsement sub-score (weight 40 positive-equivalents per adverse observation, net floored at 0; see `rating/engine/rating.ts` `NEGATIVE_FEEDBACK_WEIGHT`). v2.1.0 is **active on Arc Testnet from 2026-06-14** (testnet is the calibration environment; new attestations are stamped `2.1.0` now). The on-chain `RatingVerifier` holds `bytes32("2.1.0")` (previous `bytes32("2.0.1")`) and accepts both during the **dual-version acceptance window 2026-06-14 → 2026-07-14**; after it closes, v2.0.1 is retired from operational use. The 30-day-notice-before-effective-date rule is unchanged for any future production/mainnet deployment. Bumped on-chain via `contracts/script/SyncMethodologyVersion.s.sol`.

The v1.x code is preserved at git tag `methodology-v1.0.1-final`. The provenance lesson is documented in the methodology paper's "Methodology Provenance" section and in `docs/04-public/02-methodology-and-service.md` §7.

## Workspace Layout

pnpm workspaces, globs in `pnpm-workspace.yaml`: `indexer/*`, `rating`, `web`, `packages/*`.

| Path | Package | Role |
|------|---------|------|
| `indexer/arc/` | `@arc-agents/indexer` | Arc testnet backfill + live WebSocket listener (the production indexer) |
| `indexer/base/` | `@arc-agents/indexer-base` | Base mainnet support (parked; Arc-first scope decision) |
| `indexer/shared/` | `@arc-agents/indexer-shared` | `chain-config.ts` (`CHAINS` registry + `BASE_CONFIG`), `backfill-core.ts`, shared types |
| `rating/` | `@arc-agents/rating` | Caliber Rating v2.0 engine + Express HTTP API on port 3100. Engine modules: `completion-rate.ts` (Step 1), `credibility.ts` (Step 2.1), `survival.ts` (Step 2.2), `flags.ts` (Step 2.3), `rating.ts` (orchestrator). Tests in `rating/tests/`. |
| `contracts/` | (Foundry, not pnpm) | Solidity contracts: RatingVerifier + RatingGateway + CaliberEscrow. Tests in `contracts/test/`. |
| `web/` | `web` (Next.js 15, App Router) | Public site + JSON API at `/api/*` + SSE feed at `/api/live` + Phase 2 surfaces (`/passport`, `/discover`, `/watchlist`, `/verify`) |
| `packages/db/` | `@arc-agents/db` | Drizzle ORM schema, migrations, `db` + raw `sql` clients. Also exports the F2 classifier (`classify()`, `CATEGORIES`) in `src/categorization.ts` — pure function shared by web + indexer |
| `packages/sdk/` | `@caliber/sdk` | v0.1 TypeScript wrapper: typed read/attest/route helpers + off-chain `verifyAttestation()`. MIT after July 2026 hackathon close |
| `deploy/` | — | systemd units, nginx config, `deploy.sh` |
| `docs/01-agentsexplorer/` | — | Original 7-day MVP build docs. Historical reference |
| `docs/02-riskmodel/01-Methodology.md` | — | **Authoritative.** Caliber Rating Methodology v2.0 paper. Renders at `caliber.poko.blue/methodology`. |
| `docs/04-public/` | — | Builder's Guide + Service Companion. Render at `/builders` and `/docs/service`. |
| `docs/05-methodology-pivot/` | — | Original pivot draft. Archive value only. |

`docs/01-roadmap.md` is the wave plan (W0 through W6 + WM). WM is the methodology pivot wave.

## Architecture: Shared Backfill Core

`indexer/shared/backfill-core.ts` exposes `runBackfill({ chain, client, parseLog, applyEvents, … })` which owns:

- The block-range loop with **one** `eth_getLogs` call covering all configured contract addresses per batch
- Per-chain resumable checkpoints in `indexer_state` under the key `backfill:<chain.name>:last_block`
- Rate-limit retry with exponential backoff (`429` / "rate" matches), 5 attempts, 1s→16s
- A `cuUsedEstimate` accounting (75 CU per `getLogs`) used by `indexer/base/backfill.ts` to enforce `CU_BUDGET_SAFETY = 25_000_000` against expensive providers like Alchemy

Both chain entrypoints (`indexer/arc/backfill.ts`, `indexer/base/backfill.ts`) inject their own `parseLog` and `applyEvents`. **The Base indexer reuses Arc's parsers and handlers** via relative imports (`../../indexer/arc/lib/{parsers,handlers}`). When changing event handling, edit `indexer/arc/lib/handlers.ts` — Base picks it up automatically. `applyEvents(events, chainId)` takes a chain id so all rows are tagged correctly via the `chain_id` column on every event table.

## Architecture: Live Indexer

`indexer/arc/live.ts` is a long-running Node process:

1. On startup, reads `last_indexed_block` from `indexer_state` and runs `catchUpToHead()` in 1000-block batches.
2. Subscribes to new blocks via WebSocket (`watchBlockNumber`). For each new block: `eth_getLogs` for that block, `applyEvents`, `pg_notify`, async IPFS metadata fetch for new agents, update `last_indexed_block`.
3. Reconnects with capped exponential backoff (max 60s). Detects gaps (`blockNumber > lastProcessedBlock + 2`) and runs catch-up.
4. Emits **one** `pg_notify('arc_events', …)` per block. If JSON > 7000 bytes (Postgres NOTIFY limit ~8000), falls back to a compact summary (block + count + kinds).

`web/src/app/api/live/route.ts` opens its **own** `postgres` connection (separate from the main pool) and `LISTEN`s on `arc_events`, re-emitting payloads as SSE with a 15s heartbeat. nginx must keep buffering off on this route — already configured.

## Architecture: Database & Migrations

All schema in `packages/db/src/schema.ts` — six tables (`agents`, `feedback_events`, `validations`, `jobs`, `job_events`, `indexer_state`). Every event table has a `chain_id` column (default `'arc'`) added during the recent restructure for multi-chain support.

```bash
pnpm db:generate   # drizzle-kit generate → new SQL into packages/db/migrations/
pnpm db:migrate    # apply via packages/db/src/migrate.ts
pnpm db:studio     # drizzle-kit studio (https://local.drizzle.studio)
```

`packages/db/src/client.ts` exports both typed `db` (drizzle) and raw `sql` (postgres-js). Use `sql` for `pg_notify`/`LISTEN`; `db` for everything else. `web/src/lib/db.ts` monkey-patches `BigInt.prototype.toJSON` so JSON responses can serialize `bigint` columns — relevant when adding new API routes.

## Architecture: Handler Quirks

`indexer/arc/lib/handlers.ts` has two patterns that look weird but are intentional:

- **Placeholder agent rows for FK safety.** Before inserting `feedback_events` or `validations`, the handler does an `ON CONFLICT DO NOTHING` insert into `agents` with empty `ownerAddress` and `registeredAtBlock=0`. This keeps the FK valid when an agent was registered *before* our backfill window. A real `AgentRegistered` event landing later does not overwrite (conflict clause) — that's why `applyEvents` cleans ` ` from strings but doesn't enforce non-empty `ownerAddress`.
- **Aggregate recomputation in SQL.** `reputation_score` and `feedback_count` on `agents` are recomputed inline via raw `UPDATE … SELECT AVG/COUNT FROM feedback_events WHERE agent_id = …` after each feedback insert. Correct but O(n) per event — fine at current volume; revisit if volume grows.

## Caliber Rating v2.1.0: Methodology Summary

Full spec at `docs/02-riskmodel/01-Methodology.md`. Live at `caliber.poko.blue/methodology`. Key points future Claude needs to honor:

**Framing.** Counterparty performance rating — **not** credit rating. The v1 PD/LGD/EAD/Caliber-AAA-D framing was rejected on 2026-05-22 because the dataset doesn't support credit-rating-grade claims. The current vocabulary is tier + score + confidence + flags.

**Outputs.** Tier (`Gold | Silver | Bronze | Pending | Watch | Dormant` — 6 ordinals 0–5), score (0–100 integer), confidence label (`high | moderate | low | insufficient`), 5-bit risk flag bitmask (`CounterpartyConcentration | ValidatorConcentration | SybilPattern | VolumeAnomaly | Dormancy` — any flag pushes to Watch; Dormancy pushes to Dormant), `methodology_version: "2.1.0"`.

**Score composition** — 50% smoothed reliability + 25% forward estimate + 15% network diversity + 10% latency consistency. See `rating/engine/rating.ts` `SCORE_WEIGHTS`. **v2.1.0 adverse-evidence factor:** the network sub-score's feedback-volume component is netted — each `feedback_events.score < 50` observation subtracts `NEGATIVE_FEEDBACK_WEIGHT = 40` positive-equivalents (net floored at 0), so a single signed breach zeroes the feedback-volume credit and drops the score.

**Smoothing** — Bühlmann credibility blend (k=20), forward-success exponential decay (60-day half-life). Population mean reliability = 0.95 (hardcoded for v2.0.1 launch from the 2026-05-22 dataset; updated via the snapshot cron if it drifts).

**Tier gates (testnet calibration, v2.0.1).** Per `TIER_GATES` in `rating/engine/rating.ts`:
- Gold: score ≥ 80 AND completed jobs ≥ **2**
- Silver: score ≥ 75 AND completed jobs ≥ **2**
- Bronze: score ≥ 50 AND completed jobs ≥ **1**
- Else: Pending (or Watch if any flag fires; Dormant if Dormancy flag fires)

The **production** thresholds (50 / 20 / 5 jobs) are the methodology's intended bar; they will activate when Arc Testnet accumulates enough genuine agent-to-agent commerce. The testnet column exists so the system is demonstrably operational from day one. See methodology paper §"Tier Assignment" and §Appendix F · Calibration history.

**Confidence cutoffs** — completed jobs: `HIGH_CONFIDENCE_JOBS = 50`, `MODERATE_CONFIDENCE_JOBS = 20`, `LOW_CONFIDENCE_JOBS = 5`. Below 5 → unrated (`insufficient_interactions`). Less than 14 days on-chain → unrated (`insufficient_history`).

**Bond rates** — configurable on-chain (admin-set, event-logged, capped at 50% of budget = `MAX_BOND_BPS = 5000`). The methodology paper does NOT publish per-tier bps. Current deployed configuration from `contracts/src/CaliberEscrow.sol` constructor: 50 / 150 / 500 / 1500 bps for ordinals 0–3 (Gold / Silver / Bronze / Pending); ordinals 4–5 (Watch / Dormant) refused. `CaliberEscrow.setBondBpsForTier(tier, bps)` is the admin lever; material changes follow the 30-day notice rule. Operational bond table also rendered at `caliber.poko.blue/integrate`.

**Contract-source naming quirk:** `contracts/src/CaliberEscrow.sol` still uses pre-pivot constant names (`TIER_ESTABLISHED`, `TIER_PROVEN`, `TIER_EMERGING`, `TIER_PROVISIONAL`, `TIER_WATCH`, `TIER_INACTIVE`) for the tier ordinals 0–5. Off-chain code (`rating/engine/types.ts` `CaliberTier`) maps those same ordinals to `Gold / Silver / Bronze / Pending / Watch / Dormant`. Same enum positions, different labels. The on-chain contract code doesn't care about the human label, only the ordinal — so attestations and bond gating stay consistent. A future contract rename would be cosmetic only.

**Governance** — material changes require a new minor version with 30-day notice; old and new versions accepted in parallel during transition. The on-chain `RatingVerifier` accepts the current methodology version and one previous version. Currently in the v2.0.1 → v2.1.0 dual-version window (2026-06-14 → 2026-07-14): contract holds `bytes32("2.1.0")` with previous `bytes32("2.0.1")`, signer stamps `2.1.0`; both verify.

**Audience layering (decided 2026-05-22):** AI consumers are the long-term audience; humans (investors, grant judges, partners, builders) are the gatekeepers. Human-readable surfaces ship first as the demo layer; AI-native primitives (pgvector semantic search + `POST /v1/route`) ship second as the proof underneath. See `~/.claude/projects/-home-huicom-arc-agents-explorer/memory/caliber_audience_layering.md` for the durable principle.

## Current Code State — v2.1.0 (Phase 2 + Circle Gateway)

**Engine (rating/engine/):**
- `completion-rate.ts` — Step 1: weighted completion rate from job outcomes
- `credibility.ts` — Step 2.1: Bühlmann blend with population mean (`POPULATION_COMPLETION_RATE = 0.95`, k=20)
- `survival.ts` — Step 2.2: exponential-decay forward-success estimate (60-day half-life)
- `flags.ts` — Step 2.3: 5 rule-based flags with explicit thresholds (see file constants)
- `rating.ts` — orchestrator. Exports `rateAgent()`. Returns `RatingResult` (rated or unrated). Owns `SCORE_WEIGHTS`, `TIER_GATES`, confidence cutoffs.
- `features.ts` — per-agent feature vector from Postgres
- `types.ts` — `CaliberTier` (Gold/Silver/Bronze/Pending/Watch/Dormant), `ConfidenceLabel`, `RatingFlag`, `FLAG_BIT`, `flagsToBitfield()`, `TIER_ORDINAL`
- `version.ts` — `METHODOLOGY_VERSION = '2.1.0'`
- `index.ts` — barrel export

**Rating HTTP service (rating/src/, Express on port 3100, exposed at `caliber-api.poko.blue` via Cloudflare Tunnel):**
- `server.ts` — mounts the routes + `/health`
- `rating.ts` — `GET /v1/agents/:chain/:id/rating`
- `bulk.ts` — `GET /v1/ratings/bulk?chain=&ids=`
- `attest.ts` — `POST /v1/agents/:chain/:id/attest` → signed EIP-712 envelope; **x402-gated** (half-cent USDC nanopayment via Circle Gateway batched-settlement SDK)
- `distribution.ts`, `history.ts`, `distribution-history.ts`, `exposure-summary.ts` — read endpoints powering the web charts

**Web Phase 2 surfaces (web/src/app/):**
- `passport/arc/[id]/page.tsx` — human-first agent proof page (tier + explainer + flags + actions)
- `passport/arc/[id]/opengraph-image.tsx` — per-agent 1200×630 OG share-card
- `badge/arc/[id]/route.ts` — server-rendered SVG badge for embed
- `embed.js/route.ts` — the embed script agents drop on their site
- `verify/page.tsx` + `_components/VerifyForm.tsx` — off-chain EIP-712 verifier (no wallet)
- `discover/page.tsx` + `discover/category/[slug]/page.tsx` — semantic search + clustered browse
- `watchlist/page.tsx` + `watchlist.rss/route.ts` + `watchlist/subscribe/` — tier-transition feed
- `api/v1/route/route.ts` — `POST /api/v1/route` AI-native recommendation
- `api/v1/search/route.ts` — semantic + trigram search
- `api/v1/categories/route.ts` — category counts + top reps
- `api/watchlist/route.ts` + `subscribe/route.ts` — feed JSON + Discord webhook mgmt
- `jobs/new/_components/PostJobForm.tsx` — 3-step Circle Programmable Wallet flow: USDC approve → EIP-3009 gasless signature for x402 attestation payment → RatingGateway tier check + escrow lock. MetaMask path also supported.

**Contracts (Arc Testnet, redeployed 2026-05-22 for v2.0):**
- RatingVerifier: `0xE3b1e82f1A047BC5B41d8982EaC635EC61526EE8`
- RatingGateway: `0x003234AAd031242052d7e580d337386f1B261b78`
- CaliberEscrow: `0xc76bb990E498ACace1ff6A83ea4CCDDa92485365`
- methodologyVersion stored on-chain = `bytes32("2.1.0")` (previous = `bytes32("2.0.1")`); signer = `0xbF017698BB2c936D54a74DCABF68Df42800bAA84` stamps `2.1.0` on attestations. Both versions verify during the v2.0.1↔v2.1.0 dual-version window (2026-06-14 → 2026-07-14). `contracts/script/SyncMethodologyVersion.s.sol` bumps on-chain (run it again after 2026-07-14 to close the window). EvidenceRegistry `0xD6A8184372EbcDcBe479513187Fdc6E7E50C4A1D` `methodologyVersion()` likewise bumped to `2.1.0` via `setMethodologyVersion`.

**Circle integrations (shipped, video-validatable):**
- **USDC** — settlement currency end-to-end (job budgets, escrow, x402 attestation payments)
- **Circle Programmable Wallets** — `web/src/app/jobs/new/_components/PostJobForm.tsx` `wallet_flows: 'circle_pw'` branch. Uses Circle PW as EOA, signs EIP-3009 for x402 payments
- **Circle Modular Wallets** — alternative wallet flow in the same form
- **Circle Gateway** — `rating/src/x402-*` middleware uses `@circle/gateway-sdk` for batched-settlement (half-cent nanopayments queue in the seller batch; Circle settles in one tx with hundreds of other payments)
- **Nanopayments** — per-job rating-attestation x402 charges (`X402_PRICE_USDC = 0.005` USDC settled ~$0.054 today including fees, half-cent target)

**SDK (packages/sdk/):**
- `@caliber/sdk` v0.1 — `Caliber` class wrapping rating + attest + route + off-chain verify
- Defaults point at the live Arc Testnet deployment
- Source-disclosed MIT after July 2026 hackathon close

**Database tables:**
- `agents`, `feedback_events`, `validations`, `jobs`, `job_events`, `indexer_state` — original schema
- `agents.category` text (nullable) — F2 classifier output, populated by `classify()` from `@arc-agents/db`
- `agents.embedding` vector(384) — populated by `web/scripts/embed-agents.ts` (also runs on a 15-min timer)
- `rating_snapshots` table (with `flags` smallint bitmask) — Sentinel writes one row per rated agent per day
- `tier_transitions` table — daily snapshot diff emits one row per interesting change (first_rating, tier_up, tier_down, enter_watch, enter_dormant, flag_added, flag_removed)
- `watchlist_webhooks` table — Discord subscribers, fanned out from `snapshot-daily.ts` after the day's transitions are written
- `job_drafts` — gated job form pre-commit state (min_tier + min_confidence stored as smallint ordinals)

**Indexer auto-categorization:**
Both `indexer/arc/lib/ipfs.ts` (backfill metadata sweep) and `indexer/arc/live.ts` (live AgentRegistered handler) run `classify()` against the freshly-fetched metadata and write `agents.category` in the same `UPDATE`. New agents become category-tagged within minutes of their on-chain registration. Embedding catches up on the 15-min `caliber-embed-pending.timer`.

**Known limitations:**
- §4.1b: `validations` table has no `job_id` FK — flags ALL terminal jobs as defaulted when ANY validation in agent history is FAILED. Migration proposal documented in `indexer/arc/lib/handlers.ts` near `ValidationRequested`.
- ~88% of Arc Testnet agents have no fetchable metadata (placeholder hostnames or shared image CIDs), so /discover browses ~12% of the index. See `docs/02-riskmodel/phase2-trust-surface-voyage.md` §6.
- `bond_events` indexer table NOT yet shipped — bond posts/releases on `CaliberEscrow` are on-chain but not indexed yet. Phase 1 of `~/.claude/plans/eager-plotting-horizon.md` covers this; lands post-grant/post-holiday.

## Commands

Root scripts (`package.json`) delegate to workspaces via `pnpm --filter`:

```bash
pnpm install                      # install all workspaces
pnpm typecheck                    # tsc --noEmit across every workspace (recursive)
pnpm dev:web                      # Next.js dev server on :3000
pnpm dev:indexer:backfill         # one-shot Arc backfill, reads .env from repo root
pnpm dev:indexer:live             # long-running Arc live listener
pnpm build:web                    # next build
pnpm build:indexer                # tsc emit into indexer/arc/dist
pnpm start:web                    # next start (production, used by systemd)
pnpm start:indexer:live           # runs the compiled live listener (production)
pnpm db:generate / db:migrate / db:studio
```

Per-workspace extras:

```bash
# Base spike (uses the same shared core; safer flags for Alchemy free tier)
pnpm --filter @arc-agents/indexer-base backfill -- --window-days=3 --batch-size=10

# Rating research scripts (real Base / Arc data, not yet a server)
pnpm --filter @arc-agents/rating spike:base
pnpm --filter @arc-agents/rating spike:pd

# Web type-check only
pnpm --filter web typecheck
pnpm --filter web test:api               # web/scripts/test-api.ts
```

Backfill takes optional `MAX_BLOCK` env var to cap range; without it, the run also sweeps missing IPFS metadata at the end (`backfillMissingMetadata()`).

## Environment

Single `.env` at the repo root (loaded by tsx via `--env-file=../../.env` in `indexer/arc/package.json`). Required vars from `.env.example`:

```
DATABASE_URL=postgres://postgres:arcdev@localhost:5432/arc_agents
ARC_RPC_URL=…       # your own Arc node (no public RPC has unlimited throughput)
ARC_RPC_WS=…
ARC_CHAIN_ID=5042002
IDENTITY_REGISTRY=0x8004A818BFB912233c491871b3d84c89A494BD9e
REPUTATION_REGISTRY=0x8004B663056A597Dffe9eCcC1965A193B7388713
VALIDATION_REGISTRY=0x8004Cb1BF31DAf7788923b405b754f57acEB4272
AGENTIC_COMMERCE=0x0747EEf0706327138c69792bF28Cd525089e4583
USDC_CONTRACT=0x3600000000000000000000000000000000000000
DEPLOYMENT_BLOCK=…
# Optional for Base spike:
BASE_RPC_URL=… BASE_RPC_WS=…
```

The Arc indexer validates env via Zod at `indexer/arc/lib/config.ts` and **fails loudly** on missing/malformed values. Base canonical contracts (referenced in `chain-config.ts`): IdentityRegistry `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`, ReputationRegistry `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63`. Base ValidationRegistry and AgenticCommerce are not yet deployed (sentinel addresses).

## Web App

Next.js 15 App Router, React 19, Tailwind v4, shadcn/ui primitives (config in `web/components.json`) + custom `aa-*` editorial CSS (dominant style, see `globals.css`). Pages in `web/src/app/`:

**Original (pre-Phase 2):** `/`, `/agents`, `/agents/[id]`, `/jobs`, `/jobs/[id]`, `/live`, `/stats`, `/methodology`, `/integrate`, `/builders`, `/docs/service`.

**Phase 2 (new):** `/passport/arc/[id]`, `/verify`, `/discover`, `/discover/category/[slug]`, `/watchlist`, `/watchlist/subscribe`, `/watchlist.rss`. The Passport page is the issuer-of-record proof page; Discover is the human-first front door; Verify recovers EIP-712 signatures off-chain.

JSON API co-located under `web/src/app/api/`. `web/src/lib/api.ts` defines response types. The new `web/src/app/api/v1/{categories,search,route}/route.ts` are the public-facing surface that `@caliber/sdk` and external orchestrators consume.

Server Components fetch directly from `db` (no internal HTTP hop). `/api/live` is the only SSE endpoint and requires nginx `proxy_buffering off` — already configured at `deploy/nginx-arcagents.conf`. The Discover page lazy-loads `@xenova/transformers` (Xenova/all-MiniLM-L6-v2 model, cached in `web/.cache/transformers`); first cold start is ~30 s, then ~10 ms/query.

## Deployment

Three long-running systemd services + two timers on a single VPS, all managed via `deploy/deploy.sh`:

- `arc-indexer-live.service` → `pnpm start:indexer:live`
- `arc-rating.service` → `pnpm --filter @arc-agents/rating start` on port 3100
- `arc-web.service` → `pnpm start:web` on port 3000
- `caliber-snapshot.timer` → daily 04:00 UTC, fires `caliber-snapshot.service` → runs `rating/scripts/snapshot-daily.ts` (writes rating_snapshots, emits tier_transitions, dispatches Discord webhooks)
- `caliber-embed-pending.timer` → every 15 min, fires `caliber-embed-pending.service` → runs `web/scripts/embed-agents.ts` (idempotent, picks up name-present + embedding-null rows)

nginx terminates TLS for `caliber.poko.blue`, proxies `/` to `localhost:3000`, and proxies `/api/live` with `proxy_buffering off` and a 24h read timeout for SSE. The rating service is served at `caliber-api.poko.blue` via a Cloudflare Tunnel (one-subdomain-level constraint — see `deploy/deploy.sh` for the tunnel hostname setup instructions). Postgres runs in Docker locally; everything connects via `localhost`.

**Deploy gotcha (2026-05-22):** Passwordless sudo is not configured. `deploy.sh` will prompt for password on every `sudo` invocation. The non-sudo parts (`pnpm build:web`, `pnpm build:indexer`) can be run independently; only the systemd / nginx / log-creation steps need sudo.

## Active Phase Context

Today is **2026-05-28**. Phase 2 voyage is fully **merged to `main` and deployed**. v2.0.1 publication (metallurgical tier rename + calibration) shipped. Circle Gateway x402 end-to-end is live (commit `98a3ad8` + follow-up fixes). Phase 0 ops hardening (pg backup script + banner restore + harden.sh) landed today (`bd53652`). Healthcheck: 33/33 pass.

**Active branch:** `main`.

**Concurrent open commitments:**
- **Agora** hackathon — submitted May 25
- **Stablecoin Commerce Stack Challenge v1** — submitted
- **Circle Developer Grant** — May 31 deadline. Submission demo artifacts: live site (Passport / Discover / Watchlist / Verify), `/methodology` v2.0.1 paper, Vimeo demo video, three deployed contracts, Circle PW + Gateway + Nanopayments integration. Application program details + form fields captured in `docs/05-grants/circle-developer-grant-program.md`.

**Next milestones:**
- **2026-05-30 → 2026-06-03:** Holiday window. Hands-off. Sentinel + embedding timer + pg backup continue running autonomously.
- **2026-05-31:** Circle Developer Grant submission deadline (lands mid-holiday — submit before May 30 EOD).
- **2026-06-04 → 2026-07-13:** Post-grant build window per `~/.claude/plans/eager-plotting-horizon.md` — Phase 1 (bond event indexer + auto-release/slash bot), Phase 2 (methodology v2.1 with bonding-rate factor), Phase 3 (CCTP cross-chain), Phase 4 (USYC + Stablecoin Commerce Stack v2 final submission).
- **2026-06-15:** Phase 1 checkpoint review (continue/reduce/park decision).
- **2026-07-13:** Stablecoin Commerce Stack Challenge v2 final deadline.

When asked about scope, deadlines, or what's next, **read `~/.claude/plans/eager-plotting-horizon.md` first** (the authoritative 1-month roadmap), then `docs/02-riskmodel/phase2-trust-surface-voyage.md` for the shipped Phase 2 details.
