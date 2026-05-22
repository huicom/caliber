# Phase 2 — Trust Surface Voyage

> Paste-ready PR description for `feat/passport-watchlist-discover` → `main`. Generated 2026-05-22 from the 17-commit branch.

## Summary

Ships the entire **Phase 2 voyage** (`docs/02-riskmodel/phase2-trust-surface-voyage.md`): three human-facing surfaces (Passport, Watchlist, Discover) plus two AI-native primitives (pgvector semantic search, `POST /api/v1/route` machine endpoint), plus the `@caliber/sdk` TypeScript wrapper. All planned tracks done; all approved polish items closed.

Every rated agent now has:
- A public, embeddable proof page at `/passport/arc/{id}` with tier-colored OG card + EIP-712 attestation download
- A 1.2 KB SVG badge at `/badge/arc/{id}` that any agent can drop on their own site via `<script src="/embed.js" ...>`
- An off-chain verifier at `/verify` that recovers EIP-712 signatures and checks them against the on-chain `RatingVerifier` without a transaction

A human looking for an agent can land at `/discover` and get clustered, deduped, semantically-searched results. A smart contract can call `POST /api/v1/route` with a plain-language intent and get back a signed attestation in one round-trip.

## Tracks (all complete)

| Track | Surfaces | Demo URL |
|---|---|---|
| F1 — IPFS metadata backfill | Multi-gateway race, +59 agents recovered, honest 11% ceiling documented | `pnpm --filter @arc-agents/indexer ipfs-sweep` |
| F2 — 8-category taxonomy | `agents.category` text column, classifier in `@arc-agents/db`, auto-tagging in indexer | `/api/v1/categories` |
| 1.1 — Caliber Passport | `/passport/arc/[id]` with tier explainer + flag chips + 3 actions | `/passport/arc/1317` (Proven), `/passport/arc/4093` (Watch) |
| 1.2 — Badge + embed | `/badge/arc/[id].svg` + `/embed.js` (1.2 KB each, CORS-open) | `curl /badge/arc/1317` returns 1191 B SVG |
| 1.3 — Verify | `/verify` page recovers EIP-712 signer locally via viem, compares to on-chain | `/verify?chain=arc&id=1317` (pre-fill) |
| 1.4 — Per-Passport OG card | 1200×630 tier-colored PNG via next/og co-located convention | Open `/passport/arc/1317/opengraph-image` |
| 3 — Watchlist feed | Tier-transition diff + `/watchlist`, `/api/watchlist`, `/watchlist.rss`, Discord webhook subs | `/watchlist`, `/watchlist.rss` |
| Embeddings | pgvector + 384-dim Xenova/all-MiniLM-L6-v2, 2,298 agents embedded in 45 s | n/a (backing) |
| 4 — Discover | `/discover` + `/discover/category/[slug]` with cluster-dedup ("× N replicas") | `/discover?q=trading%20bot` |
| 5 — Routing API | `POST /api/v1/route` returns signed attestation in one call | curl example in `/integrate#example_4` |
| SDK | `@caliber/sdk` v0.1 in `packages/sdk/` with off-chain `verifyAttestation()` | `import { Caliber } from '@caliber/sdk'` |

## Database

Four additive migrations, all already applied to the local DB. None alter or drop existing columns — `main` can be reverted to without DB rollback:

- **0004** — `agents.category text` + `idx_agents_category`
- **0005** — `rating_snapshots.flags smallint` + `tier_transitions` table + 3 indexes
- **0006** — `agents.embedding vector(384)` + `idx_agents_embedding_cosine` (ivfflat, lists=20)
- **0007** — `watchlist_webhooks` table

## New systemd timer

`deploy/caliber-embed-pending.timer` — fires `web/scripts/embed-agents.ts` every 15 min. The script is idempotent (`WHERE embedding IS NULL AND name IS NOT NULL`). Installs via the updated `deploy.sh`.

## Deferred to follow-ups (not in this PR)

- Per-passport screenshots into the methodology paper (manual once deployed)
- npm publish of `@caliber/sdk` (gated on hackathon close)
- TTC view (deferred since the testnet's history is < 180 days)
- Email-confirmation flow for Discord webhook subscriptions (the URL is the auth)

## Test plan

- [ ] `pnpm typecheck` — all six workspaces clean
- [ ] `pnpm build:web` — finishes; 18 static pages; no errors (warnings about Metamask SDK + CSS import order are pre-existing)
- [ ] `pnpm build:indexer` — finishes; `dist/` artifacts present
- [ ] `sudo systemctl restart arc-web arc-indexer-live arc-rating` — services come up healthy
- [ ] `sudo systemctl enable --now caliber-embed-pending.timer` — timer fires within 15 min
- [ ] Smoke production endpoints after restart:
  - `curl -sI https://caliber.poko.blue/passport/arc/1317 | head -1` → `HTTP/2 200`
  - `curl -sI https://caliber.poko.blue/discover | head -1` → `HTTP/2 200`
  - `curl -sI https://caliber.poko.blue/watchlist | head -1` → `HTTP/2 200`
  - `curl -sI https://caliber.poko.blue/verify | head -1` → `HTTP/2 200`
  - `curl -s "https://caliber.poko.blue/api/v1/search?q=trading%20bot" | jq '.count, .results[0].similarity'` → first hit ≥ 0.5
  - `curl -s -X POST -H 'content-type: application/json' -d '{"intent":"agent that summarizes papers","min_tier":"Provisional"}' https://caliber.poko.blue/api/v1/route | jq '.match.tier, .signature'` → signed envelope
  - `curl -s https://caliber.poko.blue/badge/arc/1317 -o /tmp/b.svg && file /tmp/b.svg` → SVG
- [ ] First `/discover` request after cold start is ~1-2 s slower (model warmup); subsequent ~ms
- [ ] Discord webhook subscribe flow: paste a webhook URL into `/watchlist/subscribe` → see a test message in the channel
- [ ] Snapshot timer fires at 04:00 UTC → transitions get written → existing subscribers get the day's fan-out

## Notes for reviewers

- **Branch deploys off `feat/...`, not `main`** until you merge. Services run from whatever is `git checkout`-ed.
- **No service-file changes** in this PR — the existing arc-web / arc-rating / arc-indexer-live units already point at this repo. Only `caliber-embed-pending` is new.
- **Cloudflare Tunnel** for caliber-api.poko.blue is unchanged.
- **Cluster-dedup** is the user-approved (2026-05-22) treatment for bulk-deployed series — `/discover` shows Prism Trader once with "× 631 replicas" instead of 631 cards.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
