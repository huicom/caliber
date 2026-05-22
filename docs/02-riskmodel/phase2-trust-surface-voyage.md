# Phase 2 — Trust Surface Voyage (Passport · Watchlist · Discover)

> **Status:** Planned 2026-05-22. Approved by user same day. Start gated on user's "go"; voyage launches when prior work wraps.
>
> **Branch:** `feat/passport-watchlist-discover`
>
> **Owner:** Solo build with Claude
>
> **Window:** ~3 weeks. Phase A (gatekeeper demo) ships before Circle Grant deadline 2026-05-31; Phase B (AI-native primitives) ships before Phase 1 checkpoint 2026-06-15.

---

## 1. Frame

Caliber's long-term audience is AI consumers — orchestrators, agent-of-agent stacks, smart contracts that route work. But the *current gatekeepers* are humans: investors, grant judges, partners, builders. The product must serve both:

- **Human surface** (gatekeeper layer): Passport, Watchlist, Discover. These are demoable, shareable, mobile-friendly, and translate the methodology into something a non-crypto tester can react to in 60 seconds.
- **Machine surface** (AI-native layer): pgvector semantic search, `POST /v1/route` recommendation API, `/integrate` reference implementation #3. These prove the primitive composes and that Caliber is the trust router for the agent economy.

Build the human surface first as the demo artifact; ship the AI-native primitives second as the proof underneath. Ordering is deliberate — gatekeepers convert on what they can see and click, not on machine-readable JSON.

**Pain point being solved:** "Which agent is good?" — not "how do I execute the hire." Hiring/escrow surface (`/post-job`) stays as-is. No marketplace framing anywhere.

---

## 2. Tracks

### Track 1 — Caliber Passport *(~3 days)*

Every rated agent gets a public, evergreen, embeddable proof page they actively want to share. Caliber becomes the issuer-of-record.

| Deliverable | What |
|---|---|
| `/passport/arc/[id]` | Reframed `/agents/[id]` page: hero with tier+score+confidence, methodology link, "what this means" explainer for non-crypto visitors, history sparkline, share-card OG image |
| `/badge/arc/[id].svg` | Server-rendered SVG badge with tier color + score. Cache 5 min. Versioned URL so embeds bust correctly |
| `/embed.js` | Lightweight script (≤2 KB) agents drop on their site; renders the badge as an `<a>` linking back to their Passport |
| Download attestation | Button on Passport: fetches `/v1/agents/arc/:id/attest`, saves as `caliber-attestation-{id}.json` (EIP-712 envelope, signed) |
| `/verify` | Page where anyone pastes an attestation JSON, hits a `viem.readContract` call to `RatingVerifier.verify()`, sees ✓/✗ and the decoded fields |
| Per-agent OG image | Tier-colored share card. Solves the "looks great in tweets" problem |

**Demo story (60s):** open agent profile → "this is their Caliber Passport, anyone can embed it" → show the badge embedded on a fake demo site → click → land back at Passport → "and here's the cryptographic proof, anyone can verify it on-chain."

---

### Track 3 — Watchlist Feed *(~3 days)*

Turn the daily snapshot cron (`caliber-snapshot.timer`) into a live signal anyone can subscribe to.

| Deliverable | What |
|---|---|
| `tier_transitions` table | New table populated by snapshot diff: agent crosses up/down, enters Watch/Inactive, first flag firing |
| `/watchlist` | Public chronological feed: date filter, tier-change filter, flag filter. Each entry links to that agent's Passport |
| `/api/v1/watchlist` | JSON endpoint, `?since=<date>&kind=down,flag,watch`. Cache 60 s |
| `/watchlist.rss` | RSS feed. Cheap to add, opens us to feed-readers |
| (stretch) Discord webhook | Form-based opt-in: paste webhook URL + filter → we POST tier transitions to it |

**Honest caveat:** at current index size + Arc Testnet volume, tier transitions are infrequent (single-digit/day). Mitigation: seed the feed with the last 14 days of *historical* transitions reconstructed from snapshot history. If still quiet, lower the threshold (any tier-letter change qualifies, not just multi-step moves).

**Demo story:** "subscribe to the feed → tomorrow morning an agent you cared about is on it."

---

### Track 4 — Discover *(~5–7 days, with semantic search)*

Human-first front door. Someone who's never seen an agent before lands here, picks a category or types what they need, gets 3–5 plausible candidates, clicks one, lands at that agent's Passport.

| Deliverable | What |
|---|---|
| `/discover` | Mobile-first landing. Hero: "Find rated agents for your task." Two visible paths: browse categories, search by description |
| `/discover/category/[slug]` | One page per F2 category. Sorted by tier (Established first), then by recent activity. Pagination |
| `/api/v1/search` | **pgvector semantic** + trigram fallback on name + description, weighted by tier. Returns top 25 with `match_reason` field |
| `/api/v1/categories` | Counts + top-3-by-tier per category |
| Agent card (consumer view) | Avatar (deterministic from address if no IPFS image), display name, tier badge, one-line "what it does" (description first 80 chars), "last active 3 days ago", `[View profile]` button → Passport |
| Filter rail | Category, tier (Established/Proven/Emerging/Provisional/Watch), activity (7d/30d/all-time), has-completed-jobs. URL-synced |
| Empty / loading / error states | Skeleton loaders. Empty search suggests 3 related queries. Errors in human language |

**Hard rules:**
- No raw 0x addresses on cards (only on Passport behind a "copy address" button)
- No contract names, no gas, no "registry" words
- Categories rendered ONLY for categories with ≥10 agents
- Page header says "browse rated agents on Arc Testnet" not "hire agents"

**Demo story:** open `/discover` on a phone → "I need a trading agent" → tap Trading category → see 8 cards sorted by trust signal → tap one → land on Passport.

---

### Track 5 — AI-native machine surface *(~3 days)*

The proof underneath the human demos.

| Deliverable | What |
|---|---|
| `POST /v1/route` | Machine endpoint: `{intent, min_tier, chain}` → `{agent_id, address, attestation_signed}`. The attestation is verifiable against deployed `RatingVerifier` |
| `/integrate` reference #3 | New code sample showing routing-API consumer pattern alongside existing two (gating + tier-stepped escrow) |
| Routing-API doc page | One-pager explaining the call shape, the trust contract, and the verification step |

This is the "Caliber is the trust router for the agent economy" pitch made concrete. Each `POST /route` call is one attestation consumed by something that isn't a human.

---

## 3. Foundations (shared, do once)

### F1 — Description backfill push *(~half day)*

Of 18,454 agents, 11% have a meaningful description. 92% have a `metadata_uri` pointer that was never fetched. Rerun `backfillMissingMetadata()` with:

- Multiple IPFS gateways (cf-ipfs + ipfs.io + dweb.link, race the requests)
- Longer timeout (15 s per gateway)
- Retry with exponential backoff (3 attempts)
- Resumable progress (re-runnable, idempotent)

Honest target: 30–40% description coverage. Won't fix agents whose IPFS content is genuinely gone — that's a permanent floor.

### F2 — Category taxonomy *(~1 day)*

Cluster the described-agents corpus into 6–8 categories. Approach: extract keyword vectors from name + description + capabilities, k-means or rule-based bucketing, store result as a new `category` column on `agents` (nullable). Surface the proposed categories back to the user as a markdown table **before** any UI work, with sample agents in each.

---

## 4. Ship calendar

| Date | Track | Notes |
|---|---|---|
| Day 1 | F1 description backfill | Highest-leverage prerequisite |
| Day 2 | F2 taxonomy proposal → user review | Blocks Discover UI |
| Day 3-5 | **Track 1: Passport** | Smallest, highest-impact unit |
| Day 6-7 | **Track 3: Watchlist** | Reuses snapshot cron |
| 2026-05-30 | Circle Grant submission | Passport + Watchlist + existing site |
| Day 9-11 | pgvector + embeddings backfill | Powers Discover semantic search + routing API |
| Day 12-14 | **Track 4: Discover** | The big one |
| Day 15-17 | **Track 5: Routing API + /integrate update** | AI-native proof |
| Day 18-20 | Polish, mobile QA, friend-test | The 60-second non-crypto test |
| Day 21 | Buffer | Slips happen |
| 2026-06-15 | Phase 1 checkpoint review | All three live; data on usage |

3 weeks total from voyage start. Day 1 = whenever user says "go."

---

## 5. Out of scope (explicitly)

- Marketplace framing anywhere — Caliber is **not** a marketplace
- Hiring/execution surface (`/post-job` demo stays as-is)
- Wallet extension / pre-flight check (rejected idea from 2026-05-22 brainstorm)
- Auth, accounts, agent self-onboarding
- Multi-language
- Mainnet anything

---

## 6. Risks

1. **Description coverage caps Discover's quality.** Even after F1, ~60% of agents will still lack descriptions. Mitigation: Discover hides unlabeled agents from category browse; raw search across all 18K names + addresses remains for power users. Discover footer is honest: "browsing 6,000 agents with published descriptions; ~12,000 agents on Arc Testnet have no published metadata."

2. **Watchlist might look quiet.** Mitigation: backfill 14 days of historical transitions on first load. Fallback: lower transition threshold to any tier-letter change.

3. **pgvector adds ops surface.** New extension + embedding cron + freshness. Mitigation: only embed the ~2K agents with content; refresh weekly, not real-time. If extension proves flaky, fall back to trigram for v1 of Discover.

4. **Branch hygiene.** Restructure branch is already open. Single feature branch (`feat/passport-watchlist-discover`) with logical commit chunks lets us revert in pieces if Phase 1 checkpoint pushes back.

5. **Timeline slip.** 3-week voyage is tight. If something slips, drop Track 5 (routing API) before Track 4 (Discover) — the human surface is the demo artifact; the machine surface can ship as a follow-up PR within Phase 1 window.

---

## 7. User-confirmed decisions (2026-05-22)

- ✅ Order F1 → F2 → Passport → Watchlist → Grant → Embeddings → Discover → Routing API
- ✅ Single branch `feat/passport-watchlist-discover`, one draft PR reviewed in chunks
- ✅ Taxonomy reviewed before any UI code
- ✅ Keep pgvector + on-chain routing API in scope (originally proposed to drop; user reinstated as "the core")
- ✅ Discover surface replaces the marketplace brief from earlier 2026-05-22 — same goal, different framing
- ✅ Voyage starts when user says "go," not on a calendar trigger
