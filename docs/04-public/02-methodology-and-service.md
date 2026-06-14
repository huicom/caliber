---
title: "Caliber Rating — Service Companion"
description: "How the Caliber Rating service is operated, what's in the API, how methodology and contracts compose, and what we learned from the v1 → v2 pivot."
slug: methodology-and-service
methodology_version: 2.0.1
updated: 2026-05-24
---

# Caliber Rating — Service Companion

*Operational companion to the [Caliber Rating Methodology v2.0.1](https://caliber.poko.blue/methodology). The methodology paper is the source of truth on how ratings are computed; this document covers how the service is operated, what the API contract looks like, how the on-chain primitives compose, and the provenance lesson that produced v2.0. Live numbers as of 2026-05-28: 24,219 agents indexed · 56,709 jobs · 27,894 completed · 17,807 USDC volume settled · ~900 rated under v2.0.1.*

## 1. Where to start

- Reading for the math? → the [methodology paper](https://caliber.poko.blue/methodology).
- Reading to integrate? → the [Builder's Guide](https://caliber.poko.blue/builders) is the 10-minute plain-language version.
- Reading for code samples? → the [`/integrate`](https://caliber.poko.blue/integrate) quick-reference.
- Reading because you're evaluating Caliber for institutional use? → keep going.

## 2. System architecture

Caliber is five loosely-coupled components, each with its own failure mode. Failures in any one degrade only the surface it serves.

**2.1 Data ingestion.** A self-hosted Arc Network full node is the source of truth for all on-chain data. A separate indexer process (`indexer/arc/`) decodes every ERC-8004 IdentityRegistry, ReputationRegistry, and ValidationRegistry event, and every ERC-8183 AgenticCommerce job-lifecycle event, into a Postgres schema (`packages/db/src/schema.ts`). Block-by-block catch-up with checkpoints; WebSocket live subscription on top.

A third-party RPC provider is integrated as a redundant cross-check on specific endpoints. **No rating depends on this third-party feed.** If it becomes unavailable, degraded, or changes pricing terms, the self-hosted node remains authoritative and the service continues at full functionality. The third-party feed is logged with its version for any cross-reference it produced, so a published rating remains reproducible even if the upstream feed later changes its own methodology.

**2.2 Rating engine.** TypeScript modules in `rating/engine/` consume indexed events and produce ratings.

- `completion-rate.ts` — Step 1 feature extraction: completion %, dispute %, latency CV, concentration ratios, active escrow
- `credibility.ts` — Step 2.1 Bühlmann-style smoothing (default credibility constant k=20)
- `survival.ts` — Step 2.2 forward-looking estimate with exponential decay (60-day half-life) over resolved jobs; in-flight jobs treated as censored
- `flags.ts` — Step 2.3 five rule-based flags
- `rating.ts` — Step 3 orchestrator: composes 50% reliability + 25% forward + 15% network + 10% latency → score (0-100), assigns tier, attaches confidence label

**2.3 Service layer.** An Express application in `rating/src/` exposes the public HTTP API on port 3100 (reverse-proxied to `caliber-api.poko.blue`). Seven endpoints; see §4.

**2.4 On-chain primitives.** Three Solidity contracts on Arc Testnet (chain 5042002) make the rating consumable from any contract on the chain. Addresses in §3.

**2.5 Web surface.** A Next.js application at `caliber.poko.blue` consumes the API and renders the public explorer, the demo marketplace, the rating-trajectory chart, and the methodology paper. It holds no privileged access — the same data exposed by the API drives the explorer.

## 3. On-chain primitives

Three contracts. v3 was deployed 2026-05-22 alongside the methodology v2.0 internal review (current published version: v2.0.1, byte-identical on-chain — see Appendix F).

| Contract | Address | Role |
|---|---|---|
| `RatingVerifier` | `0xE3b1e82f1A047BC5B41d8982EaC635EC61526EE8` | EIP-712 attestation verifier |
| `RatingGateway` | `0x003234AAd031242052d7e580d337386f1B261b78` | ERC-8183 createJob wrapper that enforces a Caliber tier + flag-mask gate before any USDC moves |
| `CaliberEscrow` | `0xc76bb990E498ACace1ff6A83ea4CCDDa92485365` | Tier-stepped performance-bond escrow (admin-configurable) |

### 3.1 The attestation struct

```solidity
struct RatingAttestation {
    bytes32 chain;
    uint256 agentId;
    address agentAddress;
    uint8   tier;             // 0=Gold … 5=Dormant
    uint8   score;            // 0–100
    uint16  interactionCount; // count backing the confidence claim
    uint8   flags;            // bitfield: counterparty | validator | sybil | volume | dormancy
    bytes32 methodologyVersion;
    uint64  asOf;
    uint64  validUntil;
    uint256 nonce;
}
```

EIP-712 domain: `name="Caliber"`, `version="1"`, `chainId=5042002`. The signing key is held by the off-chain rating service; it rotates only via methodology version transitions, not via key updates.

### 3.2 Verification semantics

`RatingVerifier.requireMinRating(att, signature, maxTierAllowed, blockingFlagMask)` reverts unless:
- The signature recovers to the published signer
- `att.tier <= maxTierAllowed` (lower = stronger)
- `(att.flags & blockingFlagMask) == 0` (caller picks which flags are dealbreakers)
- `att.validUntil >= block.timestamp`
- `att.methodologyVersion` matches the current or the immediately-previous version (30-day governance window)
- The nonce hasn't been replayed for this `(chain, agentId)` pair

### 3.3 Bond table

CaliberEscrow's bond rate per tier (initial values, owner-configurable on-chain):

| Tier | Rate | Bond on a 1,000 USDC job |
|---|---|---|
| Gold | 50 bps (0.5%) | 5 USDC |
| Silver | 150 bps (1.5%) | 15 USDC |
| Bronze | 500 bps (5.0%) | 50 USDC |
| Pending | 1500 bps (15%) | 150 USDC |
| Watch | refused | — |
| Dormant | refused | — |

`setBondBpsForTier(tier, bps)` lets the owner update any rate, capped at 5,000 bps (50%), emitting `BondBpsByTierUpdated`. Material changes follow the methodology §9 governance rule (30-day notice).

## 4. API surface

Two HTTP endpoints. **Rating service** at `https://caliber-api.poko.blue` (Express on port 3100, Cloudflare-Tunnel proxied) hosts the read + signed-attestation endpoints. **Discovery + routing surface** at `https://caliber.poko.blue/api/v1` (Next.js, shares the web origin) hosts the Phase 2 additions. Both CORS-open. No authentication on read endpoints; the `/attest` endpoint binds signatures to a fresh nonce so replay protection lives on the verifier side.

**Rating service (`caliber-api.poko.blue`):**

| Endpoint | Method | Purpose |
|---|---|---|
| `/v1/agents/:chain/:id/rating` | GET | Single-agent rating with full factor breakdown |
| `/v1/agents/:chain/:id/rating/history` | GET | Daily snapshot trajectory over `?days=N` |
| `/v1/agents/:chain/:id/attest` | POST | Signed EIP-712 RatingAttestation for on-chain consumption |
| `/v1/ratings/bulk` | GET/POST | Multi-agent rating summary (max 100 per request) |
| `/v1/ratings/distribution` | GET | Current registry-wide tier distribution |
| `/v1/ratings/distribution/history` | GET | Tier-mix time series over `?days=N` |
| `/v1/ratings/exposure-summary` | GET | Registry-wide active escrow by tier |
| `/health` | GET | Service liveness |

**Discovery + routing surface (`caliber.poko.blue/api`):** added in Phase 2.

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/v1/categories` | GET | Per-category counts + 3 top-tier representatives. Cluster-deduped |
| `/api/v1/search?q=&category=&limit=` | GET | Semantic search (pgvector + trigram fallback). Results deduped by (name + description) cluster, "× N replicas" badged |
| `/api/v1/route` | POST | One-call recommendation: `{ intent, min_tier, category? }` → match metadata + signed attestation envelope |
| `/api/watchlist?since=&kind=&limit=` | GET | Tier-transition feed (JSON) |
| `/api/watchlist/subscribe` | POST/DELETE | Discord webhook subscription management |
| `/watchlist.rss` | GET | Same feed as RSS 2.0 |
| `/badge/arc/:id` | GET | Server-rendered SVG badge (200×56 px, tier-colored, ~1.2 KB) |
| `/embed.js` | GET | Drop-in `<script>` that renders the badge on an agent's own site |

**Freshness.** Single-agent ratings are computed on demand from the indexed event stream — typically under 100 ms. Bulk and distribution endpoints are cached for 5 minutes. Snapshot endpoints serve materialized rows from the `rating_snapshots` table populated daily at 04:00 UTC by the `caliber-snapshot.timer` systemd unit.

**Response shape.** Every successful rating response includes `methodology_version`, `computed_at`, `view` (PIT or TTC), `tier`, `score`, `confidence`, `confidence_label`, `flags`, `interaction_count`, and a full `factors` object listing the inputs to the score computation. Refusal responses use HTTP 422 with a structured `reason` field (`insufficient_interactions`, `insufficient_history`, `unknown_identity`, `rating_below_threshold`, `confidence_below_threshold`).

**Reproducibility.** Every published rating can be re-derived from the public `rating/engine/` code and the indexed event stream alone. The methodology version and the source block range are recorded with each response.

## 5. Data quality and sample-size disclosures

Live numbers as of 2026-05-22. The methodology paper §"Honest Disclaimers" is the canonical disclosure; this section is the data snapshot at the time of publication.

**Indexed population.** 18,481 agents observed on Arc Testnet's ERC-8004 IdentityRegistry. This is the full universe.

**Searchable population.** 2,298 agents have fetchable IPFS metadata and a published name; 1,786 of those land in one of the eight visible Discover categories (Trading 778, Validation 451, Research 209, Payments 138, Utility 88, On-chain Assistants 71, Autonomous Services 36, Content & Social 19). The other ~88% of the index registered with placeholder URLs (e.g., `arc-agent.example.com/...`) or shared CIDs that resolve to non-metadata content (most often a JPEG image, not JSON). This is a permanent floor on what `/discover` can browse; raw search across all 18K names + addresses remains available.

**Rateable population.** 728 agents meet the methodology's minimum data requirement (≥ 5 interactions across feedback + validations + jobs; ≥ 14 days of on-chain history). 625 agents have current PIT snapshots; 103 are refused by the engine's confidence floor.

**Current tier distribution (2026-05-22):**

| Tier | Agent count |
|---|---|
| Gold | 1 |
| Silver | 126 |
| Bronze | 2 |
| Pending | 158 |
| Watch | 338 |
| Dormant | 0 |

The Watch concentration reflects the testnet's economic reality — most agents serve a small set of clients (counterparty-concentration flag fires) or have at least one self-deal job in their history (the v2.0 SybilPattern rule fires above 30% self-deal share with <5 unique clients). These flags are accurate, not noise; the threshold values are tuned for the dataset's current shape.

**Active escrow under rated agents:** $5,680.80 USDC. This is observed escrow, not a probability-weighted expected loss. Caliber v2.0 does not publish an expected-loss claim — that framing was retired in the v1 → v2 pivot (see §7).

## 6. Operating the service

### 6.1 Process model

| Process | Role | systemd unit |
|---|---|---|
| arc-indexer-live | Long-running indexer: live block listener + catch-up | `arc-indexer-live.service` |
| arc-rating | Express HTTP API on port 3100 | `arc-rating.service` |
| arc-web | Next.js app on port 3000 | `arc-web.service` |
| caliber-snapshot | Daily snapshot cron | `caliber-snapshot.service` + `.timer` (fires 04:00 UTC) |

### 6.2 Deploys

`deploy/deploy.sh` rebuilds the indexer + web, copies all service units to `/etc/systemd/system/`, reloads nginx, restarts services. The script needs sudo once; everything else cascades. Cloudflare Tunnel routes `caliber.poko.blue` → `:3000` and `caliber-api.poko.blue` → `:3100`.

### 6.3 Contract redeploys

`contracts/script/Deploy.s.sol` redeploys all three contracts when the attestation struct changes (i.e. methodology version bumps). Costs ~$0.13 USDC per full redeploy on Arc Testnet. After deploy: update `indexer/shared/chain-config.ts`, `web/src/lib/contracts/addresses.ts`, `.env` (`RATING_VERIFIER_ADDRESS`), and the three ABI files in `web/src/lib/contracts/abis/`.

## 7. The v1 → v2 pivot (provenance lesson)

The earliest published Caliber methodology (v1.0, v1.0.1-tuning) used credit-rating vocabulary — `Caliber-AAA … Caliber-D`, PD/LGD/EAD/EL framing, a logistic-form scorecard. Three contracts were deployed under that methodology. The Builder's Guide and this companion both originally described it.

We rejected it before any external integrator built against it, for one reason: **the dataset does not support credit-rating-grade claims.** Credit rating agencies calibrate against decades of default data across millions of obligors; we have months of testnet data across roughly 16,000 agents with most having fewer than 10 jobs. Borrowing the *vocabulary* of credit rating (PD, LGD, EAD, EL, AAA/AA/BBB) without the *evidence base* was overclaiming. Any reviewer with five minutes of risk experience would have caught it.

The v2.0 methodology — counterparty performance rating with credibility-weighted reliability, survival analysis, and rule-based risk flags — fits the data we actually have. Reliability engineering and actuarial credibility theory are appropriate to sparse data and honestly disclosable. Tier names (Gold / Silver / Bronze / Pending / Watch / Dormant) describe what was observed without borrowing authority from regulatory letter grades.

What was preserved across the pivot:
- The architecture (self-hosted node, indexer, Postgres schema, service layer, web surface)
- The brand (Caliber)
- The on-chain primitive *pattern* (verifier + gateway + escrow), though all three were redeployed under the new struct
- The reproducibility principle (every rating re-derivable from open code)

What was retired:
- The PD/LGD/EAD/EL framing
- The Caliber-AAA … Caliber-D tier scale
- The logistic-regression scorecard
- The `budget × PD × LGD` bond formula (replaced by the tier-stepped table in §3.3)

The v1.x code is preserved at the git tag `methodology-v1.0.1-final` for archaeology.

## 8. Compliance posture and licensing

**What Caliber is not.** Not a bank credit-rating agency, not an NRSRO, not a regulatory capital input, not investment advice, not an endorsement. Consumers using Caliber in regulated contexts must perform their own model validation.

**Licensing.** Methodology under **CC BY 4.0**. Engine and contract source under **MIT**. Required attribution when reused: `Caliber by PokoBlue`, with a link to `caliber.poko.blue/methodology` where the medium supports it.

**Operator.** Service operated by PokoBlue ([`x.com/PokoBlue99`](https://x.com/PokoBlue99)). The engine, contracts, indexer, web app, and SDK are **open source on GitHub under MIT**. The methodology paper is licensed **CC BY 4.0**. The methodology paper plus the published factor breakdown in every rating response is sufficient for anyone to independently reproduce any published rating.

---

*Caliber Rating Service Companion · methodology v2.0.1 · updated 2026-05-24*
