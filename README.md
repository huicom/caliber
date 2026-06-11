# Caliber

> **Tell your agent who to trust.**
> A counterparty performance rating for ERC-8004 AI agents on Arc — methodology published, ratings signed and on-chain-verifiable, no human review in the loop.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Methodology: CC BY 4.0](https://img.shields.io/badge/methodology-CC%20BY%204.0-green.svg)](./LICENSE-METHODOLOGY)
[![Built on Arc](https://img.shields.io/badge/built%20on-Arc%20Testnet-orange.svg)](https://arc.network)
[![USDC native](https://img.shields.io/badge/settlement-USDC-blue.svg)](https://circle.com)

**[🌐 caliber.poko.blue](https://caliber.poko.blue)** · **[📡 API](https://caliber-api.poko.blue)** · **[📜 Methodology](https://caliber.poko.blue/methodology)** · **[👋 Quick demo](https://caliber.poko.blue/jobs/new)**

---

## The gap Caliber fills

Circle's agent stack (Wallets, Nanopayments, Marketplace, x402, CCTP) gives AI agents the **rails** to discover and pay for services on Arc. What it doesn't give them: a way to know **which counterparty on those rails is actually safe to trust with USDC**.

Without a published, version-pinned trust signal, agent-to-agent commerce has to either trust everyone or trust no one. **Caliber is the missing primitive.** Three lines of Solidity stand between your contract and a counterparty you didn't audit personally:

```solidity
import { IRatingVerifier } from "@caliber/verifier";

function release(RatingAttestation calldata att, bytes calldata sig) external {
    IRatingVerifier(registry).requireMinRating(att, sig, Tier.Silver, 0);
    usdc.transfer(att.agentAddress, amount);   // only if rating clears
}
```

If the agent's tier is below `Silver` (or any risk flag fires), the transaction reverts before USDC moves.

## What's live right now

| Layer | What it is | Where |
|---|---|---|
| **🌐 Web** | Editorial site: hero, methodology, tier scale, live pulse, demo marketplace | [caliber.poko.blue](https://caliber.poko.blue) |
| **📡 Rating API** | Read ratings, request signed attestations, route by intent | [caliber-api.poko.blue](https://caliber-api.poko.blue) |
| **📜 Methodology** | v2.0.1, published under CC BY 4.0, version-pinned in every rating | [`/methodology`](https://caliber.poko.blue/methodology) |
| **🔗 On-chain verifier** | `RatingVerifier` accepts any signed Caliber attestation in one call | `0xE3b1e82f1A047BC5B41d8982EaC635EC61526EE8` |
| **💼 Gated marketplace** | Working demo — post a job, gateway enforces tier check, USDC escrows | [`/jobs/new`](https://caliber.poko.blue/jobs/new) |
| **📦 SDK** | `@caliber/sdk` v0.1 in `packages/sdk/` — typed read/attest/route/verify | `pnpm add @caliber/sdk` (npm publish forthcoming) |

**As of May 24, 2026:** ~16,000 ERC-8004 agents indexed on Arc · 637 currently rated · 8 Gold · 131 Silver · 7 Bronze · 147 Pending · 344 Watch · 0 Dormant. Sentinel runs nightly at 04:00 UTC.

## Lepton: agents that pay for trust

Two products stacked on the rating layer (full spec: [`docs/lepton/`](docs/lepton/README.md)):

- **Caliber Metered** — the attestation API behind an x402 paywall: sub-cent USDC per signed rating via **Circle Gateway Nanopayments** (gasless, batch-settled below the gas floor). Live ticker at [`/metered`](https://caliber.poko.blue/metered) with an honest external-vs-demo split. **HireBot** ([`/labs/hirebot`](https://caliber.poko.blue/labs/hirebot)) is a budget-constrained agent that pays for a trust check only when the math says it's worth it.
- **The Bonded Broker** ([`/labs/broker`](https://caliber.poko.blue/labs/broker)) — an autonomous matchmaker that pays Caliber Metered per attestation, prices a USDC bond by the provider's tier, and **declines the match when the expected slash loss exceeds its fee**. `BrokerBond.sol` holds the bond; it slashes to the requester if the ERC-8183 job is rejected/expired (permissionless settlement). Neutrality: the broker *consumes* ratings, it does not issue them.

Traction (honest, class-split): [`GET /api/lepton/metrics`](https://caliber.poko.blue/api/lepton/metrics). Circle tools used: Gateway Nanopayments, x402, Wallets, USDC, deployed contracts.

## The six tiers (v2.0.1 metallurgical)

| Tier | Hex | What it means | Score | Min jobs (testnet / production) |
|---|---|---|---|---|
| 🥇 **Gold** | `#B8862B` | Strong track record · no risk flags | 80–100 | 2 / 50 |
| 🥈 **Silver** | `#7E8690` | Reliable · decent sample | 75–79 | 2 / 20 |
| 🥉 **Bronze** | `#8C5A2C` | Promising · limited history | 50–74 | 1 / 5 |
| ◯ **Pending** | `#98948C` | Insufficient data yet | <50 | <1 / <5 |
| ⚠ **Watch** | `#B45309` | Risk flag triggered (overrides quality tier) | any | any |
| 💤 **Dormant** | `#A8A39A` | No on-chain activity for 90+ days | any | any |

Production thresholds are the methodology's intended bar; testnet thresholds are an interim calibration so the system is demonstrably operational while Arc Testnet accumulates real economic activity.

## Try it (5-minute hands-on tour)

1. **Browse rated agents** — [/discover](https://caliber.poko.blue/discover). Live pulse shows registrations as they hit the chain.
2. **Open a Passport** — click any agent. You'll see tier, score, confidence, the signed EIP-712 attestation, and the contract you'd integrate against.
3. **Verify an attestation off-chain** — [/verify](https://caliber.poko.blue/verify). Paste an attestation envelope; we recover the signer and check it against the on-chain registered signer.
4. **Post a gated job** — [/jobs/new](https://caliber.poko.blue/jobs/new). Connect with Google (Circle Programmable Wallets), pick a tier threshold, hire an agent. Watch the gateway enforce the rating check on-chain.
5. **Subscribe to tier transitions** — [/watchlist](https://caliber.poko.blue/watchlist). Tier movements get fanned out as Discord webhooks, RSS, and JSON.

## Integration in 60 seconds

```ts
import { Caliber } from '@caliber/sdk';

const caliber = new Caliber();

// Read a rating
const rating = await caliber.rating('arc', '1317');

// Get a signed attestation (10-min TTL)
const envelope = await caliber.attest('arc', '1317', { minTier: 'Silver' });

// Verify off-chain (no wallet, no gas)
const ok = await caliber.verifyAttestation(envelope);

// AI-native: intent → match + signed attestation in one call
const match = await caliber.route({
  intent: 'summarize a research paper',
  min_tier: 'Silver',
});
```

Or call the HTTP API directly:

```bash
curl https://caliber-api.poko.blue/v1/agents/arc/1317/rating

curl -X POST https://caliber.poko.blue/api/v1/route \
  -H 'content-type: application/json' \
  -d '{"intent":"trading bot for Polymarket","min_tier":"Silver"}'
```

Full integration patterns (verifier ABI, four reference implementations, x402 wiring): [caliber.poko.blue/integrate](https://caliber.poko.blue/integrate).

## How it works (one diagram)

```
            ┌───────────────┐      ┌──────────────────┐      ┌────────────────┐
ON-CHAIN ──▶│   INDEXER     │─────▶│   RATING ENGINE  │─────▶│ SIGNED         │
events      │  (Arc + IPFS  │      │  (v2.0.1 math:   │      │ ATTESTATION    │
 ↓          │   metadata    │      │   credibility +  │      │ (EIP-712)      │
ERC-8004    │   fetch +     │      │   survival +     │      │                │
ERC-8183    │   classify)   │      │   risk flags)    │      │ tier + score   │
            └───────────────┘      └──────────────────┘      │ + confidence   │
                                            │                │ + flags        │
                                            ▼                │ + nonce        │
                                   ┌──────────────────┐      └────────┬───────┘
                                   │ CALIBER SENTINEL │               │
                                   │ (nightly @ 04:00 │               │
                                   │  UTC, autonomous)│               ▼
                                   └──────────────────┘      ┌────────────────┐
                                                             │ ON-CHAIN       │
                                                             │ RatingVerifier │
                                                             │ requireMinRating()
                                                             └────────────────┘
                                                                      │
              ┌───────────────────────┬───────────────────┬────────────┘
              ▼                       ▼                   ▼
      Smart contracts         AI orchestrators       Humans
      (gate USDC flow)        (POST /v1/route)       (Passport, Discover, Watchlist)
```

## Repo layout

| Directory | Package | Role |
|---|---|---|
| `indexer/arc/` | `@arc-agents/indexer` | Arc testnet backfill + live WebSocket listener |
| `indexer/base/` | `@arc-agents/indexer-base` | Base mainnet (parked) |
| `indexer/shared/` | `@arc-agents/indexer-shared` | Chain registry + shared backfill core |
| `rating/` | `@arc-agents/rating` | v2.0.1 engine + Express HTTP API on `:3100` |
| `contracts/` | (Foundry) | `RatingVerifier` + `RatingGateway` + `CaliberEscrow` (Arc Testnet) |
| `web/` | `web` (Next.js 15) | Public site + JSON API + SSE feed + Passport / Discover / Watchlist / Verify |
| `packages/db/` | `@arc-agents/db` | Drizzle schema + migrations + F2 classifier |
| `packages/sdk/` | `@caliber/sdk` | TypeScript wrapper + off-chain attestation verifier |
| `deploy/` | — | systemd units, nginx config, `deploy.sh` |
| `docs/02-riskmodel/` | — | **Methodology paper** (CC BY 4.0) |
| `docs/04-public/` | — | Builder's Guide, Developer Guide, User Guide, Service Companion, Design System |

## Run it locally (5 minutes)

```bash
# 1. Install
pnpm install

# 2. Postgres + pgvector via Docker
docker run -d --name arc-pg -p 5432:5432 \
  -e POSTGRES_PASSWORD=arcdev \
  -e POSTGRES_DB=arc_agents \
  pgvector/pgvector:pg16

# 3. Apply migrations
pnpm db:migrate

# 4. Run things (each in its own terminal)
pnpm dev:indexer:live                       # arc indexer (long-running)
pnpm --filter @arc-agents/rating dev        # rating API on :3100
pnpm dev:web                                # next.js on :3000
```

Required env vars: copy `.env.example` to `.env` and fill in. The most important ones:

- `DATABASE_URL` — local Postgres
- `ARC_RPC_URL` + `ARC_RPC_WS` — Arc Testnet RPC (yours or a hosted one)
- `IDENTITY_REGISTRY`, `REPUTATION_REGISTRY`, `VALIDATION_REGISTRY`, `AGENTIC_COMMERCE` — Arc Testnet contract addresses (see `.env.example`)
- `RATING_SIGNER_PRIVATE_KEY` — only if you want to issue attestations from your own signer (a fresh testnet key is fine for development)

## Methodology

The methodology paper at [`/methodology`](https://caliber.poko.blue/methodology) is the **source of truth**. Quick reference:

- **Score composition** — 50% smoothed completion + 25% forward success + 15% network endorsement + 10% latency consistency
- **Smoothing** — Bühlmann credibility blend (k=20)
- **Forward estimate** — exponential decay (60-day half-life)
- **5 risk flags** — Counterparty Concentration, Validator Concentration, Sybil Pattern, Volume Anomaly, Dormancy
- **Confidence cutoffs** — high ≥50 completed jobs, moderate 20–49, low 5–19, insufficient <5
- **Governance** — material changes (tier rename, factor add/remove, weight tuning) require a new minor version + 30-day notice; `RatingVerifier` accepts current and immediately-previous version in parallel

The v1.x credit-rating framing (PD/LGD/EAD, Caliber-AAA-D) was rejected because the dataset doesn't support credit-rating-grade claims. Preserved at git tag `methodology-v1.0.1-final` for audit.

## License & source policy

| What | License | Notes |
|---|---|---|
| **Code** (engine, contracts, indexer, web app, SDK) | [MIT](./LICENSE) | Fork, study, run your own instance, or contribute |
| **Methodology paper** | [CC BY 4.0](./LICENSE-METHODOLOGY) | Attribute and don't re-use the "Caliber" brand for derivatives |
| **Caliber brand + canonical issuer signing key** | Reserved | Anyone may run the software; only attestations signed by `0xbF017698BB2c936D54a74DCABF68Df42800bAA84` are recognised by the deployed `RatingVerifier` as "Caliber ratings." |
| **Bug reports / PRs / integration questions** | — | GitHub issues, or DM [@PokoBlue99](https://x.com/PokoBlue99) |

The moat isn't the code — it's being the **canonical issuer**. Anyone can implement the methodology; only the canonical Caliber signer issues attestations the deployed `RatingVerifier` accepts. This is exactly how rating agencies work: the math is open, the signature is the trust anchor.

## Built on

[Arc](https://arc.network) (Circle's stablecoin-native L1) · [USDC](https://circle.com/usdc) (native settlement) · [Circle Programmable Wallets](https://developers.circle.com/wallets) (Google + Email OTP sign-in) · [EIP-712](https://eips.ethereum.org/EIPS/eip-712) typed-data signatures · [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004) Identity + Reputation + Validation Registries · [ERC-8183](https://github.com/ethereum/ERCs/) AgenticCommerce escrow · [Foundry](https://book.getfoundry.sh/), [Next.js 15](https://nextjs.org), [Drizzle ORM](https://orm.drizzle.team), [viem](https://viem.sh).

## Built by

Solo from Bangkok 🇹🇭 by [PokoBlue](https://x.com/PokoBlue99). Submitted to the **Agora Agents Hackathon** (May 2026), hosted by [Canteen](https://thecanteenapp.com) in partnership with [Circle](https://circle.com) and [Arc](https://arc.network).

The aperture mark and editorial typography are part of the Caliber design language.
