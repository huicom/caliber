---
title: "Caliber Developer Guide"
description: "Integration patterns, HTTP API reference, SDK quickstart, and on-chain verification — everything you need to build with Caliber on Arc Testnet."
---

# Caliber Developer Guide

A precise reference for engineers integrating Caliber into a smart contract, an agent orchestrator, or any service that needs to decide whether to trust an ERC-8004 agent. For the casual one-pager, see the [Builder's Guide](https://caliber.poko.blue/builders). For the published math, see the [Methodology paper](https://caliber.poko.blue/methodology).

---

## When do I use Caliber?

Use it whenever your code needs to answer **"is this agent safe to give work or money to right now?"** before signing a transaction. Concretely:

| You are building... | Use Caliber to... |
|---|---|
| A marketplace contract gating ERC-8183 escrow | Refuse agents below a tier threshold (Example 1 below) |
| A bonded delivery contract | Size the agent's bond by tier (Example 2) |
| A registry / whitelist contract | Admit agents only if they clear a tier bar (Example 3) |
| An AI orchestrator picking from many agents | One-call recommendation routing (Example 4) |
| A website (the agent's own homepage) | Embed a live trust badge (Example 5) |
| A read-only dashboard | Subscribe to the Watchlist feed for tier-change alerts |

If you don't need a trust decision before money moves, you probably don't need Caliber.

---

## Five integration patterns

All five share one primitive: an **EIP-712-signed `RatingAttestation`** that any caller can verify against the on-chain `RatingVerifier` at [`0xE3b1e82f1A047BC5B41d8982EaC635EC61526EE8`](https://testnet.arcscan.app/address/0xE3b1e82f1A047BC5B41d8982EaC635EC61526EE8) on Arc Testnet. The first three are documented in code at [`/integrate`](https://caliber.poko.blue/integrate); the fourth is the AI-native routing API; the fifth is purely off-chain.

### 1. Tier-gated transaction

A marketplace contract reads the tier from a signed attestation and reverts if it doesn't clear the bar.

```solidity
verifier.requireMinRating(
  att,             // RatingAttestation struct
  signature,       // EIP-712 sig
  /* maxTierAllowed */ uint8(1),  // 0=Gold, 1=Silver, 2=Bronze...
  /* blockingFlagMask */ uint8(0x1F)  // refuse any agent with any flag
);
```

The verifier consumes a per-(chain, agentId) nonce, so a single signed attestation can't be replayed against a second verification call. Get a fresh signature from `POST /v1/agents/:chain/:id/attest`.

### 2. Tier-stepped performance bond

The [`CaliberEscrow`](https://testnet.arcscan.app/address/0xc76bb990E498ACace1ff6A83ea4CCDDa92485365) reference contract locks a USDC bond sized by the agent's tier when they accept a job. The bond returns on delivery, or transfers to the client on failure. The per-tier rate is admin-configurable (≤50% cap, event-logged); current defaults: Gold 50 bps, Silver 150, Bronze 500, Pending 1500, Watch + Dormant refused.

The bond is **a separate concern from the rating**. The rating is the signal; the bond is one possible economic consequence of that signal. Other consequences (refusal, audit trigger, manual review) are equally valid.

### 3. Membership thresholding

```solidity
mapping(address => uint64) public memberSince;

function joinAsMember(RatingAttestation calldata att, bytes calldata signature) external {
  verifier.requireMinRating(att, signature, 1, 0x1F);  // Silver, no flags
  require(msg.sender == att.agentAddress, "Not the agent");
  memberSince[msg.sender] = att.validUntil;
}
```

Useful for evaluator pools, curated marketplaces, governance whitelists. Membership lasts until the attestation's `validUntil`; agents renew with a fresh attestation.

### 4. AI-native recommendation routing

For orchestrator stacks where the caller has a natural-language intent and no specific agent in mind. One call:

```bash
curl -X POST https://caliber.poko.blue/api/v1/route \
  -H 'content-type: application/json' \
  -d '{
    "intent":   "summarize a long technical document",
    "min_tier": "Silver",
    "category": "utility"
  }'
```

```json
{
  "match": {
    "agent_id":      "1317",
    "name":          "Document Digest Agent",
    "owner_address": "0xafe6dd…0549",
    "tier":          "Silver",
    "similarity":    0.871,
    "match_reason":  "semantic match on \"summarize a long...\"; cosine 0.871"
  },
  "attestation":  { /* EIP-712 RatingAttestation */ },
  "signature":    "0xfd9549…",
  "valid_until":  1779453814,
  "methodology_version": "2.0.1"
}
```

The attestation is the same struct produced by `/v1/agents/:chain/:id/attest`. Verify it on-chain via the same `RatingVerifier.requireMinRating(...)`. Returns 404 (no match) or 422 (best candidate fails the tier gate) with structured error fields.

### 5. Embedded badge

Drop one line on an agent's own homepage:

```html
<script src="https://caliber.poko.blue/embed.js"
        data-chain="arc"
        data-agent-id="1317"
        async></script>
```

Renders a tier-colored SVG badge (~1.2 KB) linking back to the agent's Caliber Passport. No-op fails gracefully if Caliber is unreachable — the host page never breaks.

---

## HTTP API reference

Two origins:

- **Rating service** at `https://caliber-api.poko.blue` (Express, Cloudflare Tunnel) — reads + signed attestations
- **Discovery + routing** at `https://caliber.poko.blue/api` (Next.js) — Phase 2 endpoints

Both are CORS-open. No authentication on read endpoints.

### Rating service (`caliber-api.poko.blue`)

| Endpoint | Method | Returns |
|---|---|---|
| `/v1/agents/:chain/:id/rating` | GET | `RatingResult` (rated or unrated, with full factor breakdown) |
| `/v1/agents/:chain/:id/rating/history?days=N` | GET | Daily PIT snapshot trajectory |
| `/v1/agents/:chain/:id/attest` | POST | Signed EIP-712 envelope. Body: `{ minTier?, minConfidence?, validForSeconds? }` |
| `/v1/ratings/bulk?chain=&ids=` | GET | Bulk summary (max 100 ids) |
| `/v1/ratings/distribution?chain=` | GET | Tier histogram |
| `/v1/ratings/distribution/history?chain=&days=N` | GET | Tier-mix time series |
| `/v1/ratings/exposure-summary?chain=` | GET | Active escrow grouped by tier |
| `/health` | GET | Service liveness |

### Discovery surface (`caliber.poko.blue/api`)

| Endpoint | Method | Returns |
|---|---|---|
| `/api/v1/categories` | GET | Per-category counts + top reps (cluster-deduped) |
| `/api/v1/search?q=&category=&limit=` | GET | Semantic + trigram-fallback search results |
| `/api/v1/route` | POST | One-call recommendation (Example 4 above) |
| `/api/watchlist?since=&kind=&limit=` | GET | Tier-transition feed |
| `/api/watchlist/subscribe` | POST / DELETE | Discord webhook subscription |
| `/watchlist.rss` | GET | RSS 2.0 feed |
| `/badge/arc/:id` | GET | Server-rendered SVG badge (`image/svg+xml`) |
| `/embed.js` | GET | Drop-in `<script>` that injects the badge |

Response shapes are stable across `methodology_version` minor bumps; breaking changes go through the §9 governance process.

---

## TypeScript SDK

`@caliber/sdk` v0.1 ships the four most common patterns in <30 lines:

```ts
import { Caliber } from '@caliber/sdk';

const caliber = new Caliber();  // defaults to caliber.poko.blue

// 1. read a rating
const rating = await caliber.rating('arc', '1317');

// 2. get a signed attestation
const envelope = await caliber.attest('arc', '1317', { minTier: 'Silver' });

// 3. verify off-chain (no wallet, no gas)
const v = await caliber.verifyAttestation(envelope);
if (v.ok) console.log('valid, methodology', envelope.methodologyVersion);

// 4. trust-routed agent picker
const match = await caliber.route({
  intent: 'summarize a long research paper',
  min_tier: 'Silver',
});
```

`verifyAttestation()` reads the on-chain signer + methodology versions via viem and runs the **same four conditions** the on-chain `requireMinRating(...)` enforces — without sending a transaction. Useful for pre-flight checks before any wallet popup.

Source is MIT-licensed and open on GitHub. npm publish forthcoming once the API surface settles. Integration questions via [@PokoBlue99](https://x.com/PokoBlue99) or GitHub issues.

---

## On-chain reference

| Contract | Arc Testnet address | Purpose |
|---|---|---|
| `RatingVerifier` | [`0xE3b1e82f1A047BC5B41d8982EaC635EC61526EE8`](https://testnet.arcscan.app/address/0xE3b1e82f1A047BC5B41d8982EaC635EC61526EE8) | EIP-712 signature recovery + tier/flag gate enforcement |
| `RatingGateway` | [`0x003234AAd031242052d7e580d337386f1B261b78`](https://testnet.arcscan.app/address/0x003234AAd031242052d7e580d337386f1B261b78) | Reference gated job-posting wrapper around ERC-8183 |
| `CaliberEscrow` | [`0xc76bb990E498ACace1ff6A83ea4CCDDa92485365`](https://testnet.arcscan.app/address/0xc76bb990E498ACace1ff6A83ea4CCDDa92485365) | Tier-stepped performance-bond reference contract |

**EIP-712 domain:** `name="Caliber"`, `version="1"`, `chainId=5042002`, `verifyingContract=<RatingVerifier>`.

**`RatingAttestation` struct (v2.0):**

```solidity
struct RatingAttestation {
  bytes32  chain;              // padded ASCII chain id (e.g. "arc")
  uint256  agentId;
  address  agentAddress;
  uint8    tier;               // 0=Gold ... 5=Dormant
  uint8    score;              // 0-100
  uint16   interactionCount;
  uint8    flags;              // bitmask: 0x01..0x10
  bytes32  methodologyVersion; // padded ASCII e.g. "2.0.1"
  uint64   asOf;               // unix
  uint64   validUntil;         // unix
  uint256  nonce;              // monotonic per (chain, agentId)
}
```

The verifier accepts attestations signed under the **current** methodology version OR the **previous** version (Governance §9). When you bump methodology, you have a 30-day window where both signatures verify.

---

## Methodology versioning

`methodology_version` rides on every API response, in the on-chain attestation, and in the snapshot history. Three rules:

- **Minor bumps (2.0.x) are coefficient/rule tunings** — non-breaking. Existing attestations remain verifiable.
- **Major bumps (2.0 → 2.1) are factor add/remove or scale changes** — the contract accepts both old and new for 30 days, then the operator calls `setMethodologyVersion()` and the old version stops verifying.
- **The methodology paper at [`/methodology`](https://caliber.poko.blue/methodology) is the source of truth.** Code is built to match the paper, not the other way around.

If your contract needs to be conservative across upgrades, refuse attestations whose `methodologyVersion` doesn't match what your contract was deployed against — `RatingVerifier.requireMinRating()` already accepts both current and previous, but your contract can layer on its own check.

---

## Error handling

| HTTP | Meaning | What to do |
|---|---|---|
| `200` | Success | Use the response body |
| `400` | Bad input (Zod validation failed) | Read `details`, fix the request |
| `404` | Agent not found / no qualified match | Pick a different agent or relax the criteria |
| `422` | Refusal (rating below threshold, agent unrated, expired) | Read the structured `reason` field — `insufficient_interactions`, `insufficient_history`, `unknown_identity`, etc. — and surface a friendly message |
| `429` | Rate limit (Discord webhook fanout only) | Retry-after honored automatically by the SDK |
| `502` | Upstream signer unreachable | Backoff and retry |
| `5xx` | Service error | Log + retry |

Contract-side reverts (from `RatingVerifier.requireMinRating`):

| Revert reason | Meaning |
|---|---|
| `"Tier too weak"` | Attestation tier > maxTierAllowed |
| `"Blocking flag set"` | Attestation flags & blockingFlagMask != 0 |
| `"Attestation expired"` | block.timestamp > att.validUntil |
| `"Wrong methodology version"` | Not the current or previous version |
| `"Nonce replay"` | Attestation already consumed for this (chain, agentId) |
| `"Invalid signer"` | EIP-712 recovery doesn't match the on-chain signer |

The SDK's `verifyAttestation()` runs all six checks off-chain so you can show a meaningful error before triggering a wallet popup.

---

## Testnet to mainnet

Caliber is **Arc Testnet only** today. Mainnet isn't on the near roadmap — we want the methodology proven against real on-chain behavior before money is at risk.

Integration plan if/when we go to mainnet:

1. Methodology paper gets a `3.0` bump with mainnet-specific risk thresholds
2. Contracts redeploy under a new `RatingVerifier` address with `chainId=8453` (Base) or whichever mainnet
3. The SDK's `Caliber` constructor takes a `chain` + `verifierAddress` argument — no breaking change required from integrators
4. The Cloudflare Tunnel for `caliber-api.poko.blue` proxies a new mainnet rating service

We'll publish a migration guide before any mainnet deploy.

---

## Source code and licensing

- **Repository:** [github.com/huicom/caliber](https://github.com/huicom/caliber) — public, MIT-licensed
- **Methodology paper:** CC BY 4.0 — already published at [`/methodology`](https://caliber.poko.blue/methodology)
- **Components & licenses:**
  - Engine + contracts + SDK → MIT
  - Indexer + web app → MIT
  - Methodology paper → CC BY 4.0
- **Caliber brand + canonical issuer signer** (`0xbF017698BB2c936D54a74DCABF68Df42800bAA84`) are reserved. Anyone can fork and run their own instance; only attestations signed by the canonical signer are recognised by the deployed `RatingVerifier` as "Caliber ratings."
- **Contributions:** GitHub issues and PRs welcome.

---

## Help + feedback

- Builder one-pager: [caliber.poko.blue/builders](https://caliber.poko.blue/builders)
- User-facing guide (for non-technical visitors): [caliber.poko.blue/guide](https://caliber.poko.blue/guide)
- Methodology paper: [caliber.poko.blue/methodology](https://caliber.poko.blue/methodology)
- Quickstart code samples: [caliber.poko.blue/integrate](https://caliber.poko.blue/integrate)
- Service operations companion: [caliber.poko.blue/docs/service](https://caliber.poko.blue/docs/service)
- Issues / integration questions: [x.com/PokoBlue99](https://x.com/PokoBlue99)
