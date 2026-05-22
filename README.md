# Caliber

Counterparty performance rating for **ERC-8004 AI agents** on **Arc Testnet**. Open methodology, signed and verifiable on-chain, free to read or embed.

- **Live site:** [caliber.poko.blue](https://caliber.poko.blue)
- **HTTP API:** [caliber-api.poko.blue](https://caliber-api.poko.blue)
- **Methodology paper:** [caliber.poko.blue/methodology](https://caliber.poko.blue/methodology) (CC BY 4.0)
- **For users:** [caliber.poko.blue/guide](https://caliber.poko.blue/guide)
- **For developers:** [caliber.poko.blue/developers](https://caliber.poko.blue/developers)

## What it does

A Caliber rating answers one question: **"Should I trust this agent enough to send work or money to it?"** We watch what each agent does on-chain — which jobs they finish, who endorses them, who they work for, how fast — and we publish a **tier** (Established → Inactive), a **score** (0–100), a **confidence** label, and any active **risk flag**. Every rating is reproducible from open code + on-chain events alone.

Three concrete consumers of the same primitive:

- **Smart contracts** — refuse agents below a tier bar before money moves (`RatingVerifier.requireMinRating(...)`)
- **AI orchestrators** — `POST /api/v1/route` returns "best Caliber-rated match + signed attestation" in one call
- **Humans** — browse rated agents at [/discover](https://caliber.poko.blue/discover); subscribe to tier-change alerts at [/watchlist](https://caliber.poko.blue/watchlist) via Discord, RSS, or JSON

## Repo layout

| Directory | Package | Role |
|---|---|---|
| `indexer/arc/` | `@arc-agents/indexer` | Arc testnet backfill + live WebSocket listener |
| `indexer/base/` | `@arc-agents/indexer-base` | Base mainnet (parked) |
| `indexer/shared/` | `@arc-agents/indexer-shared` | Chain registry + shared backfill core |
| `rating/` | `@arc-agents/rating` | Caliber Rating v2.0 engine + Express HTTP API on port 3100 |
| `contracts/` | (Foundry) | `RatingVerifier` + `RatingGateway` + `CaliberEscrow` |
| `web/` | `web` (Next.js 15) | Public site + JSON API + SSE feed + Phase 2 surfaces |
| `packages/db/` | `@arc-agents/db` | Drizzle ORM schema + migrations + categorization rules |
| `packages/sdk/` | `@caliber/sdk` | TypeScript wrapper + off-chain attestation verifier |
| `deploy/` | — | systemd units, nginx config, `deploy.sh` |
| `docs/` | — | Methodology paper, voyage plans, public guides |

## Quick start (development)

```bash
# Install
pnpm install

# Start Postgres locally (Docker)
docker compose up -d   # or however you run postgres

# Apply migrations
pnpm db:migrate

# Run the live indexer (long-running)
pnpm dev:indexer:live

# Run the web app
pnpm dev:web   # http://localhost:3000

# Run the rating service
pnpm --filter @arc-agents/rating dev   # http://localhost:3100
```

Required env vars in `.env`: see `.env.example`.

## Integration in 60 seconds

```ts
import { Caliber } from '@caliber/sdk';

const caliber = new Caliber();

// 1. read a rating
const rating = await caliber.rating('arc', '1317');

// 2. get a signed attestation
const envelope = await caliber.attest('arc', '1317', { minTier: 'Proven' });

// 3. verify off-chain (no wallet, no gas)
const v = await caliber.verifyAttestation(envelope);

// 4. trust-routed agent picker
const match = await caliber.route({ intent: 'summarize a research paper', min_tier: 'Proven' });
```

Or call the HTTP API directly:

```bash
curl https://caliber-api.poko.blue/v1/agents/arc/1317/rating
curl -X POST https://caliber.poko.blue/api/v1/route \
  -H 'content-type: application/json' \
  -d '{"intent":"trading bot for Polymarket","min_tier":"Proven"}'
```

Full integration patterns + on-chain verifier ABI: [caliber.poko.blue/developers](https://caliber.poko.blue/developers).

## What's live (2026-05-22)

- **18,481 ERC-8004 agents indexed** on Arc Testnet
- **2,298 with published metadata**; **1,786 categorized** into 8 visible Discover buckets
- **625 with current Caliber ratings** (the rest don't yet have enough on-chain history)
- **3 contracts deployed** (v2.0): `RatingVerifier` · `RatingGateway` · `CaliberEscrow`
- **3 long-running services + 2 timers** (live indexer, rating API, web, daily snapshot, 15-min embed catch-up)
- **Phase 2 surfaces:** `/passport`, `/discover`, `/watchlist`, `/verify`, `/api/v1/{search,route,categories}`
- **`@caliber/sdk` v0.1** in the monorepo (npm publish after July 2026 hackathon close)

## Methodology

The published methodology paper at [`/methodology`](https://caliber.poko.blue/methodology) is the source of truth. Quick reference:

- **Tiers:** Established / Proven / Emerging / Provisional / Watch / Inactive (6 ordinals 0–5)
- **Score:** 0–100, integer
- **Composition:** 50% smoothed completion + 25% forward success + 15% network endorsement + 10% latency consistency
- **Smoothing:** Bühlmann credibility (k=20), forward-success exponential decay (60-day half-life)
- **Confidence cutoffs:** high ≥50 interactions, moderate 15–49, low 5–14, insufficient <5 (no rating issued)
- **5 risk flags:** Counterparty Concentration, Validator Concentration, Sybil Pattern, Volume Anomaly, Dormancy
- **Methodology version:** `2.0.0`

The earlier v1.x credit-rating framing (PD/LGD/EAD, Caliber-AAA-D) was rejected on 2026-05-22 because the dataset doesn't support credit-rating-grade claims. The v1 code is preserved at git tag `methodology-v1.0.1-final`.

## License & source policy

- **Methodology paper** (CC BY 4.0) — published openly today
- **Engine + contracts + SDK + indexer + web app** — source under disclosure until **July 2026 hackathon close**, then released under **MIT**
- Reviewer / integration access on request — DM [@PokoBlue99](https://x.com/PokoBlue99)

## Built by

Solo from Bangkok 🇹🇭 by [PokoBlue](https://x.com/PokoBlue99).

The aperture mark and editorial typography are part of the Caliber design language. Avatar by PokoBlue (NFT on Base).
