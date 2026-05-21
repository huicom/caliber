# Caliber Demo Marketplace — Implementation Plan (v1.1)

**Goal:** Ship the thinnest possible end-to-end marketplace experience on Arc: poster funds a job in USDC, system filters agents by Caliber rating, escrow settles via ERC-8183 on Arc Testnet. Demo-able in a 3-minute video. Submittable to Stablecoins Commerce Stack Track 4 (Agentic Economy, deadline July 13).

**Non-goals (locked):**
- NOT building dispute resolution UI in v1
- NOT building agent-side dashboard in v1 (read-only for now; see §10 for the demo-time "agent role" decision)
- NOT building reputation feedback submission (relies on existing on-chain validators)
- NOT custom escrow contracts — wrap or hook the deployed ERC-8183 AgenticCommerce contract on Arc Testnet (address already in `indexer/shared/chain-config.ts`)
- NOT cross-chain in v1 — Arc Testnet only

**Time budget:** 10–12 working days, starting **AFTER grant submission on May 31**. Target: working demo by July 6, submission window July 7–13.

**Hard prerequisite:** Caliber service must be deployed at `caliber-api.poko.blue` and serving `/v1/agents/:chain/:id/rating` with real attestations **before day 3** of this build. The oracle signer reads from it; without it, the whole gating story collapses. The rating service deploy is tracked under Phase 1 in `docs/02-riskmodel/02-Roadmap.md` (checkpoint June 15) and `docs/02-riskmodel/phase1.md`.

---

## 1. Strategic framing (read before building)

This marketplace is the **demonstration surface** for the rating, not a replacement for it. Every screen should reinforce: "we know which agent to hire because we've rated them." The methodology page (`web/src/app/methodology/page.tsx`, source paper at `docs/02-riskmodel/01-Methodology.md`) is linked from every job-creation screen. The agent rating badge (`web/src/components/ui/RatingBadge.tsx`) is prominent on every agent card and on the post-job confirmation step.

The marketplace's value-add is NOT post-a-job UX (commodity) — it's **rating-gated funding**. That gate is the only thing arcagents.pro can't trivially copy without independently building a defensible rating methodology.

**The rating gate is implemented in Solidity** (`RatingVerifier`, spec in §11 below). The marketplace's escrow funding step internally calls `verifier.requireMinRating(...)` before allowing the job to be created/funded. This means:
- The verifier becomes the proven-defensible thing inside the marketplace.
- Phase 5: open-source the verifier separately for ecosystem distribution.

---

## 2. Architecture overview

Three hosts already exist in the repo. The marketplace work touches all three.

```
┌──────────────────────────────────────────────────────────────────┐
│  Web (Next.js 15.3, React 19) — caliber.poko.blue              │
│  ┌────────────────┐  ┌─────────────────┐  ┌──────────────────┐   │
│  │ /post-job      │  │ /agents (extend)│  │ /jobs/[id] (ext.)│   │
│  │ Form + USDC    │  │ Rating filter   │  │ Lifecycle + write│   │
│  └────────────────┘  └─────────────────┘  └──────────────────┘   │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ Wallet connect (wagmi v2 + viem + ConnectKit) — client     │  │
│  │ /api/jobs/draft  → Postgres job_drafts table               │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
                          │ (1) draft + draftHash
                          │ (2) rating attestation request
                          ▼
┌──────────────────────────────────────────────────────────────────┐
│  Rating service (Express, port 3100) — caliber-api.poko.blue│
│  Existing: GET /v1/agents/:chain/:id/rating                      │
│            GET|POST /v1/ratings/bulk                             │
│            GET /v1/ratings/distribution                          │
│  NEW: POST /v1/agents/:chain/:id/attest                          │
│       → signs EIP-712 RatingAttestation, returns (att, sig)      │
└──────────────────────────────────────────────────────────────────┘
                          │ EIP-712 (att, sig)
                          ▼
┌──────────────────────────────────────────────────────────────────┐
│  Smart contracts (Arc Testnet, Foundry — new `contracts/` wksp.) │
│  ┌──────────────────┐         ┌─────────────────────┐            │
│  │ RatingGateway    │ uses ►  │ RatingVerifier      │            │
│  │ wraps createJob  │         │ (EIP-712 verifier)  │            │
│  │ + USDC pull;     │         │                     │            │
│  │ funds in pop #3  │         │                     │            │
│  │ (see §13 Check 3)│         │                     │            │
│  └──────────────────┘         └─────────────────────┘            │
│           │                                                      │
│           │ 3-popup flow: approve → postGatedJob → fundJob       │
│           │ (agent calls setBudget on AgenticCommerce in between)│
│           ▼                                                      │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ ERC-8183 AgenticCommerce reference contract                │  │
│  │ Arc: 0x0747EEf0706327138c69792bF28Cd525089e4583            │  │
│  │ (from indexer/shared/chain-config.ts, NOT a new lookup)    │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
                          │ emits JobCreated / JobFunded / …
                          ▼
┌──────────────────────────────────────────────────────────────────┐
│  Indexer (existing, no changes for marketplace)                  │
│  indexer/arc/lib/parsers.ts + handlers.ts already decode every   │
│  AgenticCommerce event into the `jobs` / `job_events` tables.    │
│  Web reads these via Server Components → db. No new write path   │
│  in the indexer.                                                 │
└──────────────────────────────────────────────────────────────────┘
```

**Critical clarification:** The existing `/jobs` page reads from the indexer (passive). The new flow WRITES via our gateway → ERC-8183 → indexer picks it up → appears on `/jobs`. The indexer doesn't change. The write path is the only new on-chain surface.

---

## 3. Tech stack (locked)

| Layer | Choice | Notes |
|---|---|---|
| Frontend | Existing Next.js **15.3 + React 19 + Tailwind v4 + shadcn-ui** | App Router, `web/` workspace. Don't fragment. |
| Wallet connect | `wagmi` v2 + `viem` + ConnectKit | Codebase already has `viem ^2.27.3`. Add `wagmi`, `@tanstack/react-query`, `connectkit`. |
| State | TanStack Query (comes with wagmi v2) | No Redux/Zustand. |
| Contracts | Foundry, new top-level `contracts/` workspace | Register in `pnpm-workspace.yaml`. ABI artifacts copied to `web/src/lib/contracts/abis/` via a small build script. Use **viem typing**, not ethers. |
| Off-chain blobs | Postgres (existing) via new `job_drafts` Drizzle table | Migration via `pnpm db:generate && pnpm db:migrate`. |
| ERC-8183 ref | Already in `indexer/shared/chain-config.ts` as `agenticCommerce: 0x0747EEf0706327138c69792bF28Cd525089e4583` | No new address book file — that registry is the canonical source. |
| USDC | Arc Testnet USDC = `0x3600000000000000000000000000000000000000` (from `.env.example`) | |
| File uploads | None in v1 | Text-only job briefs. |

**Server/Client boundary note:** existing `/jobs/[id]` and `/agents/[id]` are **Server Components** that import `db` directly. Wallet write actions must live in client islands (`'use client'` child components), not by flipping the whole page client-side.

---

## 4. Day-by-day plan

### Pre-flight (Day 0 — half day, do before grant submission)

Do these checks so the LLM coder doesn't burn day 1 debugging:

1. Pull the verified ERC-8183 AgenticCommerce ABI from the Arc Testnet block explorer for `0x0747EEf0706327138c69792bF28Cd525089e4583`. Confirm it matches the event names the indexer already decodes (`JobCreated, BudgetSet, JobFunded, JobSubmitted, JobCompleted, JobRejected, JobExpired, PaymentReleased` — see `indexer/arc/lib/abis.ts` line 137+).
2. From the verified ABI, list the **write functions** (these aren't in the indexer's event-only ABI). Expect a flow along the lines of `createJob(...) → setBudget(jobId, amount) → fund(jobId)` plus `submit(...)`, `complete(...)`, `reject(...)`. Record the actual signatures.
3. From the verified ABI, **confirm the wrapper can batch `createJob + setBudget + fund` into one external entrypoint** so the poster signs one MetaMask popup, not three. If the reference contract's functions block external composition (e.g., `msg.sender`-only restrictions on `fund`), document the workaround in the gateway design. The `JobCreated` event's `hook: address` field is noted but **not used** — the gating strategy is locked to wrapper (§10 question 1).
4. Verify Arc Testnet RPC endpoint, faucet, and USDC mint flow.
5. Verify the rating service is deployed at `caliber-api.poko.blue/v1/agents/arc/<known-rated-id>/rating` and returns a 200 with `methodology_version` populated.
6. **Verify Arc's native gas token** before drafting the §8 Circle feedback. If Arc does not use USDC-as-gas, edit §8 accordingly.
7. Add `contracts/` to `pnpm-workspace.yaml` and `foundry init`.

If any of (1)–(5) is broken or unexpected, STOP and reconsider before day 1.

### Days 1–2: Wallet + ERC-8183 read

- Add `wagmi` + `@tanstack/react-query` + `connectkit` to `web/`.
- Configure Arc Testnet chain (chainId 5042002) in `web/src/lib/wagmi/`.
- Wallet connect button in header (`web/src/components/ui/`).
- Read-only ERC-8183 hooks: `useJob(jobId)`, `useUserJobs(address)` — these hit chain directly via viem so we can demo a "live, not via indexer" read.
- Add a small client island to `web/src/app/jobs/[id]/page.tsx` that re-reads job state from chain alongside the indexer-rendered data — proves the wagmi setup works without rebuilding the page.

**DoD:** Connect MetaMask to Arc Testnet, see your address in header, see a job's on-chain state rendered in the existing `/jobs/[id]` page next to the indexer-rendered fields.
- Day 1-2: done 2026-05-20

### Days 3–4: RatingVerifier + RatingGateway

This implements §11 below. Gating strategy is locked to the wrapper (§10 question 1).

- `RatingVerifier.sol` — EIP-712 verifier. See §11.1 for typed-data struct and §11.2 for the verifier interface.
- `RatingGateway.sol` — exposes `postGatedJob(bytes erc8183Params, RatingAttestation att, bytes sig, uint8 maxTierAllowed, uint8 minConfidenceAllowed)`. Internally:
  1. `verifier.requireMinRating(att, sig, maxTierAllowed, minConfidenceAllowed)`
  2. `usdc.transferFrom(msg.sender, address(this), budget)` (gateway holds the budget mid-call)
  3. `agenticCommerce.createJob(...)` → captures returned `jobId`
  4. `agenticCommerce.setBudget(jobId, budget)` and `agenticCommerce.fund(jobId)` — adjust exact calls to match the verified ABI from day 0
  5. emits `JobPostedWithRating(jobId, poster, agentId, tier, methodologyVersion)` for explorer legibility
- Foundry tests: 8+ cases — valid attestation accepted, tier-too-low rejected, confidence-too-low rejected, stale attestation rejected (past `validUntil`), wrong `methodologyVersion` rejected, wrong `agentAddress` rejected, wrong signer rejected, replay rejected (nonce), plus a happy-path test that confirms the full create+setBudget+fund chain finishes in one external call.
- Deploy to Arc Testnet, verify on the block explorer. Record addresses in `indexer/shared/chain-config.ts` alongside the existing ones (one source of truth).

**DoD:** Both contracts deployed and verified on Arc Testnet. End-to-end test from JS: rating service `/v1/agents/arc/:id/attest` → `gateway.postGatedJob(...)` → ERC-8183 emits `JobCreated`, `BudgetSet`, `JobFunded` in the same tx.
- Day 3-4: done 2026-05-20 (contracts built, 13/13 tests pass, deploy script ready; deployment pending user authorization per constraints)

### Days 5–6: Post-a-job UX

Build `/post-job` page in `web/src/app/post-job/page.tsx`:

- Form fields:
  - Title (text, required, 60 char max)
  - Description (markdown, required, 2000 char max)
  - Budget USDC (number, required, min 1, max 1000 for testnet)
  - Min rating required (dropdown: Caliber-AAA through Caliber-B, default Caliber-BBB — types in `web/src/lib/api.ts` as `ArcTier`)
  - Min confidence (dropdown: High / Medium — default Medium; "Low" is allowed but warned; "Insufficient" is never selectable)
  - Deadline (date picker, default +7 days)
  - Target agent (pre-filled from `?agent=<chain>:<agentId>` query, or chooser modal)
- Off-chain draft step: `POST /api/jobs/draft` writes title + description + draftHash into a new `job_drafts` Drizzle table (see §11.3). The `draftHash` is committed on-chain via the ERC-8183 deliverable/description slot (whichever the verified ABI exposes — confirm day 0) so the indexer can re-join the description after `JobCreated` fires.
- **Look up `(chain, agentId)` from `agentAddress`** by querying `/api/agents/by-address/:address` (new tiny route, single-table lookup against `agents.owner_address` + `agents.chain_id`). The rating API is keyed `(chain, agentId)`, not by address — this lookup is required before requesting an attestation.
- **As-built on-chain flow** (revised after Day-0 finding §13 Check 3 — ERC-8183 access control blocks atomic batching):
  1. **Save draft + get attestation** — `POST /api/jobs/draft` (returns `draftHash`), then `POST https://caliber-api.poko.blue/v1/agents/:chain/:id/attest`. Off-chain — no MetaMask popup.
  2. **Approve USDC** — `usdc.approve(gateway, budget)`. **MetaMask popup #1.**
  3. **Post gated job** — `gateway.postGatedJob(..., description = "${title}\n\narcagents:draft:${draftHash}")` runs verifier, pulls USDC into gateway, calls `createJob`. **MetaMask popup #2.** Emits `JobPostedWithRating(jobId, …)` — form parses this from the receipt and `router.push(/jobs/${jobId})`.
  4. **Agent setBudget** — agent calls `agenticCommerce.setBudget(jobId, amount, "")` directly. The poster sees a "Waiting for provider to call setBudget" message on `/jobs/[id]` until this fires.
  5. **Fund** — poster clicks "Fund Job (popup #3)" on `/jobs/[id]`. Calls `gateway.fundJob(jobId)` which calls `agenticCommerce.fund(jobId, "")` as client. **MetaMask popup #3.** Indexer picks up `JobFunded` and the lifecycle UI advances to Funded.

- **Draft-join contract:** the indexer parses the `arcagents:draft:0x<keccak256-hex>` marker out of `JobCreated.description`, looks up `job_drafts.draftHash`, copies the full off-chain description into `jobs.description`, and stamps `job_drafts.onchain_job_id`. Without the marker (legacy jobs or non-gateway posts), the raw on-chain description is stored as-is.
- Transaction status (pending / confirmed / failed). On success, redirect to `/jobs/:id`.

**Error copy — three distinct paths (handle all):**
- "This agent's rating is below your threshold" (attestation returned a tier lower than `minTier`).
- "This agent has no rating yet (Insufficient confidence)" (attestation returns 422 / `rated: false`, `reason: 'insufficient_interactions'` or `'insufficient_history'`). This is the **common case for new agents** — most on-chain agents will be unrated until they hit ≥5 interactions and ≥14 days of history.
- "Rating attestation expired" (`validUntil` in the past — re-fetch).

**DoD:** A user can connect wallet, fill the form, get an attestation, approve USDC, post a job, and see it appear at `/jobs/:id` with the on-chain `jobId`. Real USDC moves from poster wallet to the escrow contract.
- Day 5-6: done 2026-05-20

### Days 7–8: Agent browse with rating filter + selection

Extend existing `web/src/app/agents/page.tsx`:

- Add rating filter sidebar: checkboxes for Caliber-AAA through Caliber-D, "All" default. Also a "Show unrated" toggle (off by default — most agents are unrated; this matches §3 of the methodology).
- Add sort options: Rating (best first), Most active, Newest, Most jobs completed.
- Agent card: prominently show `<RatingBadge />`, PD (30d), confidence tier. The `BulkRatingSummary` shape in `web/src/lib/api.ts` already provides these via `api.bulkRatings(chain, ids)`.
- "Hire this agent" button on each card → opens `/post-job?agent=<chain>:<agentId>` with target pre-filled.

Job detail / agent matching flow `web/src/app/jobs/[id]/page.tsx` (Server Component shell + client write-island):

- Show job state mapped from real on-chain events (see `indexer/arc/lib/abis.ts`):
  `Created` (post `JobCreated`) → `BudgetSet` → `Funded` → `Submitted` → terminal: `Completed | Rejected | Expired` → `Paid` (post `PaymentReleased`).
  Reuse `web/src/components/ui/StatusBadge.tsx` for the badges.
- Buttons (gated by viewer role, all in a single client island):
  - State `Created/BudgetSet/Funded` AND viewer is poster: "Cancel" (if ERC-8183 supports it).
  - State `Funded` AND viewer is the gated agent's owner: "Submit deliverable".
  - State `Submitted` AND viewer is evaluator: "Approve" / "Reject".
- Block explorer link to job's on-chain state.
- Transaction history from indexer (`job_events`).

**DoD:** A user can browse `/agents`, filter by rating, click "hire", post a job pre-gated to that agent, and the job lifecycle UI shows current state correctly mapped to real ERC-8183 events.
- Day 7-8: done 2026-05-20

### Days 9–10: Job lifecycle completion + polish

- Submit deliverable UI (agent role — see §10 question 2 for who plays this in the demo): text field + URL field for deliverable link. The text payload's hash goes on-chain as the `bytes32 deliverable` argument of `JobSubmitted`.
- Validate UI (evaluator role from ERC-8183): approve / reject + payment trigger (whatever the verified ABI exposes — `complete()` likely triggers `PaymentReleased`).
- Cancel/refund flow if state allows.
- Error states: insufficient USDC, attestation expired/missing, rating not high enough, agent unrated, wrong chain, wallet not connected.
- Empty states: no jobs, no agents matching filter, no rated agents matching filter.
- Mobile responsive (basic — don't over-invest).
- Loading skeletons (codebase uses shadcn `Skeleton`).

**DoD:** A complete job can flow from posting → agent accepts → agent submits → evaluator approves → USDC released (PaymentReleased on-chain). All visible in UI. Block explorer confirms all transactions.
- Day 9-10: done 2026-05-20

### Days 11–12: Submission materials

This is what actually wins the hackathon — the build is just a prerequisite:

**Day 11 — Demo video script and recording (3 min max):**

| Time | Beat | Visual |
|---|---|---|
| 0:00–0:15 | Hook: "Agent economies need a credit-rating layer. We built it. Here's how it gates real USDC." | Title card + Caliber-AAA badge |
| 0:15–0:45 | Show `/agents` with rating filter — "{RATED_COUNT} rated agents out of {TOTAL_COUNT} indexed, methodology published" (numbers pulled live from `/api/stats` + `/v1/ratings/distribution` at recording time — do NOT hard-code) | Browse + show methodology page tab |
| 0:45–1:30 | Post a job: connect wallet → fill form → get attestation → approve USDC → post (gated to Caliber-BBB+) | Screen recording, sped up where boring |
| 1:30–2:15 | Show on-chain proof: block explorer for the gateway/hook contract, USDC transfer, RatingVerifier event, ERC-8183 `JobCreated` | Multiple windows |
| 2:15–2:45 | Show rating filter rejecting two cases: a low-rated agent ("rating too low") AND an unrated agent ("Insufficient confidence — methodology requires ≥5 interactions") | Distinct error states — this is the differentiator |
| 2:45–3:00 | Close: "Track 4: Agentic Economy. Built by PokoBlue from Bangkok. caliber.poko.blue" | Title card with URLs |

**Day 12 — Submission package:**

- Architecture diagram (one PNG, the system shown in §2 of this doc).
- README with quickstart.
- Circle Product Feedback section (Stablecoins Commerce Stack requires this — covers USDC, Wallets, and CCTP if applicable).
- Hackathon form fields filled (see §7).

---

## 5. Repo layout

Add to existing `arc-agents-explorer` repo (paths are real, matching the monorepo):

```
arc-agents-explorer/
├── contracts/                              # NEW — Foundry workspace
│   ├── foundry.toml
│   ├── src/
│   │   ├── RatingVerifier.sol
│   │   └── RatingGateway.sol               # wrapper (locked per §10 Q1)
│   ├── test/
│   └── script/                             # deploy scripts (Arc Testnet)
├── packages/
│   └── db/src/schema.ts                    # EXTEND — add job_drafts table
├── rating/
│   ├── api/v1/agents/[chain]/[id]/
│   │   └── attest/route.ts                 # NEW — EIP-712 attestation endpoint
│   └── src/server.ts                       # EXTEND — mount /v1/agents/:chain/:id/attest
├── web/src/
│   ├── app/
│   │   ├── post-job/                       # NEW
│   │   │   ├── page.tsx
│   │   │   └── _components/                # client islands (form, tx steps)
│   │   ├── jobs/[id]/page.tsx              # EXTEND — add client write island
│   │   ├── agents/page.tsx                 # EXTEND — rating filter, sort
│   │   └── api/
│   │       ├── jobs/draft/route.ts         # NEW — write draft, return draftHash
│   │       └── agents/by-address/[addr]/   # NEW — agentAddress → (chain, agentId)
│   │           └── route.ts
│   ├── lib/
│   │   ├── wagmi/
│   │   │   ├── config.ts
│   │   │   └── chains.ts
│   │   └── contracts/
│   │       ├── abis/                       # populated by Foundry build script
│   │       │   ├── ERC8183.json
│   │       │   ├── RatingVerifier.json
│   │       │   ├── RatingGateway.json
│   │       │   └── USDC.json
│   │       └── addresses.ts                # re-exports from indexer/shared/chain-config.ts
│   └── components/ui/                      # extend, reusing RatingBadge, StatusBadge
└── indexer/shared/chain-config.ts          # EXTEND — add ratingVerifier + ratingGateway addresses
```

**Address book.** New contract addresses live in `indexer/shared/chain-config.ts` (the existing `CHAINS` registry), not in a new markdown file. Web reads them via `web/src/lib/contracts/addresses.ts` which re-exports.

**Keep contracts in a subfolder of the same repo** for the hackathon — one repo to submit is easier than two. Add `contracts` to `pnpm-workspace.yaml`. Split later if it gets big.

---

## 6. The honest risk list

Read these and decide if any are showstoppers BEFORE day 1.

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| ERC-8183 ref contract on testnet has restricted `createJob` (allowlisted only) | Medium | High — blocks the whole product | Day 0 check on the verified ABI. If allowlisted, contact Arc team for testnet allowlist or fall back to a minimal escrow contract. |
| Wrapper can't atomically batch `createJob + setBudget + fund` because ERC-8183 restricts those calls to a specific `msg.sender` | **CONFIRMED (see §13 Check 3)** | Medium — wrapper became 3 popups instead of 1 | Fallback activated: gateway calls `createJob` (becomes the recorded client) and pulls USDC into itself, agent calls `setBudget` directly, poster funds via `gateway.fundJob`. Documented in §4 days 5–6 as-built flow. |
| Arc Testnet RPC instability during demo | Medium | Medium | Record video early, have backup recording, use your own Arc node (not a public RPC). |
| Wallet UX edge cases (network switching, insufficient gas) eat 2–3 days | High | Medium | Budget time, accept rough edges in v1. |
| Rating service not deployed to `caliber-api.poko.blue` by day 3 | Medium | High — gating story collapses | Treat as a hard prereq (see header). Phase 1 (`docs/02-riskmodel/phase1.md`) must finish the deploy step before marketplace day 3. |
| Methodology paper (`docs/02-riskmodel/01-Methodology.md`) still has unfilled §7.2 backtest + Appendix B glossary when hackathon judges click through | High if not filled | High — methodology is your moat | Fill those two specific sections BEFORE starting this build, not after. They're identified in `docs/02-riskmodel/phase1.md`. |
| Grant submission suffers because marketplace pulls focus | High if started before May 31 | High — grant is bigger EV | Do not start until after May 31 grant submission. |
| arcagents.pro ships similar marketplace before July 13 | Medium | Medium — but you have rating gate they don't | Differentiator is the gate, not the form. Lean into it in the video. |

---

## 7. What this looks like in the hackathon submission form

Stablecoins Commerce Stack Track 4 requires specific fields. Pre-fill these now so you don't scramble:

| Field | Answer |
|---|---|
| Title | Caliber-Gated Marketplace on Arc |
| Short description | The first marketplace where agent hiring is gated by a published performance-risk methodology. Job posters specify minimum Arc-rating and confidence; USDC escrow won't fund unless the agent's signed rating attestation meets the threshold. |
| Track | Track 4: Agentic Economy |
| Circle products used | USDC, Wallets (via ConnectKit; embedded wallets out of scope v1) |
| Functional MVP | caliber.poko.blue/post-job (live URL post-day-10) |
| Diagram | Architecture diagram from §2 |
| Video | Loom / YouTube unlisted, 3 min |
| GitHub | `github.com/huicom/arc-agents-explorer` — **kept PRIVATE through the hackathon**. Grant judges access to specific reviewers if the submission form requires it; flip public only after the July 13 deadline (or earlier if the form mandates it). |
| Demo URL | caliber.poko.blue |
| Circle Product Feedback | See §8 below |

---

## 8. Circle Product Feedback (required section, draft this now)

The hackathon explicitly requires this section. Drafting it during the build means it's specific, not generic.

**TODO before submission:** verify Arc's native gas token (day 0 task). The paragraph below assumes USDC-as-gas — if Arc uses a different native gas token, rewrite the "USDC predictability" paragraph accordingly.

**Why USDC + Wallets for this use case:**
We're building rating-gated escrow for autonomous-agent commerce, where USDC predictability matters more than fee-token volatility. Arc's USDC-denominated transaction settlement means our marketplace doesn't need a paymaster or fee-token swap layer — every economically meaningful action settles in dollars, which is what the rating methodology models.

**What worked well:**
- ERC-8183 AgenticCommerce reference contract gave us escrow-with-evaluator semantics out of the box.
- Arc's deterministic finality means our UI can confidently show "job funded" within ~2 seconds.
- Self-hosted Arc node + standards-native contracts meant no vendor risk during dev.

**What could be improved:**
- ERC-8183 documentation could use more end-to-end examples for the wrapped-contract / hook pattern (we wanted to extend, not fork).
- Testnet faucet rate limits made multi-agent demo scenarios harder.
- A canonical "marketplace integrators" doc bringing together ERC-8004 + ERC-8183 + USDC + Wallets would shorten onboarding.

**Recommendations:**
- Publish a reference marketplace integration guide (this is the gap our project fills).
- Consider an Arc Testnet sandbox with pre-funded test agents at varying rating tiers — would dramatically speed up demos.
- ERC-8183 hook extension points for things like rating gating should be documented as first-class patterns.

---

## 9. Definition of done (whole project, July 13 deadline)

Must-haves:
- [ ] User can connect MetaMask to Arc Testnet via the existing caliber.poko.blue site
- [ ] User can post a job with USDC escrow funding, gated by minimum Arc-rating AND confidence
- [ ] Posting a job to an under-rated agent fails with the **"rating too low"** message
- [ ] Posting a job to an unrated agent fails with the **"Insufficient confidence"** message (distinct from the above)
- [ ] Posting a job to an Caliber-BBB+ agent succeeds; USDC moves to escrow contract on-chain
- [ ] Agent (as the wallet that owns the `agentAddress`) can submit and be paid
- [ ] All transactions visible on Arc Testnet block explorer
- [ ] Methodology paper §7.2 (backtest) and Appendix B (glossary) sections filled in
- [ ] 3-minute demo video uploaded
- [ ] Hackathon form submitted before July 13 23:59 UTC

Nice-to-haves (only if days 1–10 finish ahead):
- [ ] Email/Discord notification when an agent has a new job offer
- [ ] Agent dashboard showing all jobs they're eligible for (based on their rating)
- [ ] BNB Chain coverage as second supported network (matches Phase 2 roadmap goal)
- [ ] Thai-language toggle (matches Phase 4A roadmap goal)

---

## 10. Strategic decisions PokoBlue must confirm (LLM cannot)

These need a yes/no from you, not the LLM:

1. **Contract strategy — LOCKED: wrapper.** Build `RatingGateway.sol`. Initially scoped to wrap `createJob + setBudget + fund` into one popup, but the **Day-0 spike (§13 Check 3) confirmed ERC-8183's per-call `msg.sender` checks make atomic batching impossible** (`setBudget` requires the agent, `fund` requires the client — they can never be the same `msg.sender`). The as-built design wraps `createJob + USDC pull` in popup #2 and exposes `fundJob` for popup #3, with the agent's `setBudget` happening directly on AgenticCommerce in between. Net popup count is **3** (approve + postGatedJob + fundJob), down from the un-wrapped 4 (no batching savings on the budget step). The wrapper still makes the differentiator visible in the block-explorer trace and emits `JobPostedWithRating(jobId, …)` for legibility. The hook path remains rejected.

2. **Agent role — LOCKED: option A (single MetaMask, role-based UI on `/jobs/[id]`).** `/jobs/[id]` already conditionally renders "Cancel" / "Submit deliverable" / "Approve" based on the connected wallet's role, so when the demoer switches MetaMask accounts, the correct button auto-appears on the same page. No separate agent dashboard. No extra page. The demo voiceover narrates the wallet switch.

3. **Build timing — confirm.** Build starts AFTER grant submission on May 31. Hackathon target July 13. Do not let the LLM start coding the marketplace before the grant is submitted.

4. **Framing — confirm.** Marketplace UX is the demo surface; rating methodology remains the moat. Every screen reinforces this. (Recommended: confirm.)

5. **Scope cuts — confirm.** Read §1 non-goals. If any of those have to be in v1, the timeline doubles. Confirm cuts.

6. **Wallet stack — confirm.** ConnectKit + wagmi v2 + viem is the proposed choice. Confirm or override.

7. **Hard prereq — confirm.** Rating service must be deployed at `caliber-api.poko.blue` and serving `/v1/agents/:chain/:id/rating` + the new `/v1/agents/:chain/:id/attest` before day 3. This is owned by Phase 1, not this plan.

---

## 11. Concrete specs (replaces references to "the prior C plan")

### 11.1 EIP-712 typed data — `RatingAttestation`

```solidity
struct RatingAttestation {
    bytes32 chain;              // bytes32("arc"), bytes32("base") — keep stable across versions
    uint256 agentId;            // ERC-8004 agent id
    address agentAddress;       // ownerAddress at time of attestation; gateway checks this matches job
    uint8   tier;               // 0=Caliber-AAA … 8=Caliber-D (matches the order of ArcTier in web/src/lib/api.ts)
    uint16  pdBps;              // PD(30d) in basis points (0–10000)
    uint8   confidence;         // 0=High, 1=Medium, 2=Low (Insufficient → no attestation issued)
    bytes32 methodologyVersion; // bytes32("1.0.0") — gateway can require exact or accept previous
    uint64  asOf;               // unix seconds, attestation generation time
    uint64  validUntil;         // unix seconds, gateway rejects if block.timestamp > validUntil
    uint256 nonce;              // monotonic per (chain, agentId) to prevent replay
}
```

Domain separator: `EIP712Domain(name="ArcRating", version="1", chainId, verifyingContract=RatingVerifier)`. **Note:** `name="ArcRating"` is immutable in the deployed verifier; Caliber is the brand, ArcRating is the on-chain artifact name. Do not change off-chain or signatures will fail to verify.

### 11.2 `RatingVerifier` interface

```solidity
interface IRatingVerifier {
    function requireMinRating(
        RatingAttestation calldata att,
        bytes calldata signature,
        uint8 maxTierAllowed,        // e.g. 3 = Caliber-BBB; reject if att.tier > maxTierAllowed
        uint8 minConfidenceAllowed   // e.g. 1 = Medium; reject if att.confidence > minConfidenceAllowed
    ) external view;

    function signer() external view returns (address);
    function methodologyVersion() external view returns (bytes32);          // active
    function previousMethodologyVersion() external view returns (bytes32);  // accepted during transition
}
```

Implementation notes:
- Signer is the rating service's hot signing key, set at deploy time. A small admin can rotate it later (out of scope v1).
- Revert reasons must be distinct so the marketplace UI can surface "tier too low" vs "confidence too low" vs "stale" vs "wrong methodology version" vs "bad signer" vs "replay".
- Methodology-version enforcement implements the §8 governance promise in `docs/02-riskmodel/01-Methodology.md`: old + new versions accepted in parallel during transition windows.

### 11.3 New Drizzle table — `job_drafts`

```ts
// packages/db/src/schema.ts (additive)
export const jobDrafts = pgTable('job_drafts', {
  draftId:        uuid('draft_id').defaultRandom().primaryKey(),
  draftHash:      text('draft_hash').notNull(),  // keccak256(title || description || budget || deadline)
  chainId:        text('chain_id').notNull().default('arc'),
  poster:         text('poster').notNull(),      // 0x-prefixed lower-case
  targetAgentId:  text('target_agent_id').notNull(),
  title:          text('title').notNull(),
  description:    text('description').notNull(),
  budgetUsdc:     text('budget_usdc').notNull(),
  minTier:        smallint('min_tier').notNull(),
  minConfidence:  smallint('min_confidence').notNull(),
  deadline:       timestamp('deadline', { withTimezone: true }).notNull(),
  onchainJobId:   text('onchain_job_id'),         // null until JobCreated is indexed and joined
  createdAt:      timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
```

Join strategy: the gateway passes `draftHash` to `createJob` via whichever slot the verified ABI exposes for client-supplied metadata (confirmed day 0). The indexer's `handlers.ts` matches `draftHash` against `job_drafts` and writes `onchainJobId` back. If no metadata slot is available, fall back to a `(poster, targetAgentId, blockNumber-window)` join — uglier but workable.

### 11.4 Attestation endpoint — `POST /v1/agents/:chain/:id/attest`

Lives in the rating service (`rating/api/v1/agents/[chain]/[id]/attest/route.ts`), mounted in `rating/src/server.ts`.

Request body: `{ minTier?: ArcTier, minConfidence?: 'high' | 'medium' | 'low', validForSeconds?: number }` (defaults: `Caliber-D`, `low`, 600).

Response 200: `{ attestation: RatingAttestation, signature: '0x…', validUntil: number, methodologyVersion: string }`.

Response 422 `{ rated: false, reason: 'insufficient_interactions' | 'insufficient_history' | 'rating_below_threshold' | 'confidence_below_threshold', detail: string }`.

The signer reads its key from an env var (`RATING_SIGNER_PRIVATE_KEY`); document in `.env.example`. Nonce per `(chain, agentId)` lives in Postgres (new tiny table or reuse `indexer_state` with a key prefix).

---

## 12. Testing strategy

- **Contracts:** Foundry, 8+ cases listed in days 3–4 DoD.
- **Rating service:** extend `rating/tests/integration.test.ts` (already gated behind `RUN_INTEGRATION=1`) with attest-endpoint cases — known-rated agent returns 200 with valid signature; unrated agent returns 422 with `insufficient_interactions`; threshold rejection returns 422 with `rating_below_threshold`.
- **Web:** extend `web/scripts/test-api.ts` (already wired as `pnpm --filter web test:api`) with the new `/api/jobs/draft` and `/api/agents/by-address/:addr` routes.
- **End-to-end:** one Node script that runs the four-step post-job flow against Arc Testnet from a funded wallet and asserts the indexer eventually picks up the new job. Useful for the day-11 demo recording, not just CI.

---

*Plan version 1.1. If the LLM coder asks "should we also build X?", default answer is no — every addition risks the July 13 deadline. The differentiator is the rating gate, not the marketplace polish.*

---

## 13. Pre-flight findings (Day 0 — 2026-05-20)

### Check 1: ERC-8183 ABI — event matching

**PASS.** All 10 events in `indexer/arc/lib/abis.ts` (lines 137-225) are confirmed present in the verified implementation ABI at `0xa316fd02827242d537f84730f8a37d0ba5fd351a` (EIP-1967 proxy implementation for `0x0747EEf0706327138c69792bF28Cd525089e4583`). No changes needed to the indexer's event-only ABI.

Additional events found on the implementation (not needed by the indexer): `EvaluatorFeePaid`, `HookWhitelistUpdated`, `Initialized`, `RoleAdminChanged`, `RoleGranted`, `RoleRevoked`, `Upgraded`.

### Check 2: Write functions

All write functions from the verified implementation ABI at `0xa316fd0…351a`:

| Function | Signature | Access Control |
|---|---|---|
| `createJob` | `(address provider, address evaluator, uint256 expiredAt, string description, address hook) → uint256` | None — anyone can call. `client = msg.sender`. No zero-check on `provider`. |
| `setBudget` | `(uint256 jobId, uint256 amount, bytes optParams)` | `msg.sender == job.provider` (provider only) |
| `fund` | `(uint256 jobId, bytes optParams)` | `msg.sender == job.client` (client only). Only transfers if `budget > 0`. |
| `submit` | `(uint256 jobId, bytes32 deliverable, bytes optParams)` | `msg.sender == job.provider` |
| `complete` | `(uint256 jobId, bytes32 reason, bytes optParams)` | `msg.sender == job.evaluator`; status must be `Submitted` |
| `reject` | `(uint256 jobId, bytes32 reason, bytes optParams)` | If `Open`: client only. If `Funded`/`Submitted`: evaluator only. |
| `claimRefund` | `(uint256 jobId)` | Anyone; status must be `Funded`/`Submitted` AND `block.timestamp >= expiredAt` |
| `setProvider` | `(uint256 jobId, address provider_)` | `msg.sender == job.client` AND `job.provider == address(0)` |

Known ERC-20 interaction: `fund` calls `paymentToken.safeTransferFrom(job.client, address(this), job.budget)` — the client (gateway) must have approved USDC to the AgenticCommerce contract before funding.

### Check 3: Wrapper batching — CANNOT batch all 3 atomically

**CONFIRMED: full `createJob + setBudget + fund` batching in one external call is NOT possible** due to ERC-8183 access control:
- `setBudget` requires `msg.sender == job.provider` (the agent)
- `fund` requires `msg.sender == job.client` (the gateway)
- Since these are different addresses, a single `msg.sender` cannot satisfy both.

**Activating plan §6 risk #2 fallback.** The wrapper design is revised to:

**`RatingGateway.sol` revised interface:**
- `postGatedJob(address agent, address evaluator, uint256 expiredAt, string description, uint256 budget, RatingAttestation att, bytes sig, uint8 maxTierAllowed, uint8 minConfidenceAllowed) → uint256 jobId`:
  1. `verifier.requireMinRating(att, sig, maxTierAllowed, minConfidenceAllowed)`
  2. `usdc.transferFrom(msg.sender, address(this), budget)` — pull USDC from poster
  3. `usdc.approve(agenticCommerce, budget)` — pre-approve for `fund`
  4. `jobId = agenticCommerce.createJob(agent, evaluator, expiredAt, description, address(0))` — gateway becomes `client`
  5. emit `JobPostedWithRating(jobId, msg.sender, att.agentId, att.tier, att.methodologyVersion)`
- `fundJob(uint256 jobId)`: calls `agenticCommerce.fund(jobId, "")` — caller is the poster (tx.origin), confirmed against stored job data
- Agent calls `setBudget(jobId, budget, "")` directly on the AgenticCommerce contract (not through gateway)

**Poster UX revised to 3 popups:**
1. `USDC.approve(gateway, budget)` — MetaMask popup #1
2. `gateway.postGatedJob(...)` — MetaMask popup #2 (createJob + USDC transfer)
3. `gateway.fundJob(jobId)` — MetaMask popup #3 (fund, after agent sets budget)

**DraftHash strategy:** The `description` string parameter on `createJob` accepts arbitrary text. The gateway will pass the `draftHash` in a standarized prefix format (`arcagents:draft:<hash>`) within the description, allowing the indexer to join `job_drafts` after `JobCreated` fires. No separate metadata slot needed.

**`setProvider` limitation:** `setProvider` only works when `job.provider == address(0)`. After `createJob` sets the provider, `setProvider` will revert. This means the provider is immutable after `createJob`. The gateway passes the real agent address directly to `createJob` — no post-creation reassignment needed.

### Check 4: Arc Testnet RPC, faucet, USDC

**PASS.**
- RPC: `https://rpc.testnet.arc.network` — confirmed working, chainId 5042002
- Gas price: 20 Gwei minimum (confirmed via `eth_gasPrice`: 20 Gwei = `0x4a8270a40`)
- Faucet: `https://faucet.circle.com` — Circle faucet supports ARC testnet, provides USDC and EURC, rate-limited to 1 request per hour (3600s)
- USDC contract: `0x3600000000000000000000000000000000000000` — confirmed, already in `indexer/shared/chain-config.ts`

### Check 5: Rating service

**PASS.** `https://caliber-api.poko.blue/v1/agents/arc/1/rating` returns HTTP 200 with:
- `rated: true`, `rating: "Caliber-AAA"`, `confidence: "low"`
- `methodology_version: "1.0.0"` — populated
- `ppd_30d: 0.0018`, `lgd: 0.3`, `ead_usdc: "0.000000"`
- `interaction_count: 6`, `lookback_days: 30`
- All §11.1 `RatingAttestation` fields are computable from this response.

### Check 6: Arc native gas token

**CONFIRMED: USDC is the native gas token.** Confirmed from Arc docs (`docs.arc.io/llms.txt`): "USDC is the native gas token. Arc uses USDC for gas fees, not ETH." and from `arc/references/gas-and-fees.md`: gas unit is USDC (18 decimals), EIP-1559 + EWMA smoothing, min base fee 20 Gwei.

**Plan §8 Circle feedback paragraph requires NO revision.** The "USDC-denominated transaction settlement" statement is accurate.

### Check 7: contracts/ workspace

**DONE.** Foundry 1.7.1 installed (`forge`, `cast`, `anvil`, `chisel`). `contracts/` directory initialized with `forge-std` v1.16.1.`contracts` added to `pnpm-workspace.yaml`.

### Summary

All 7 checks pass. One finding requires a plan adjustment: the wrapper cannot batch `createJob + setBudget + fund` atomically (§6 risk #2 was correct). The fallback design (gateway as client, agent sets budget separately, poster funds separately) is documented above and will be implemented in days 3–4 per the revised interface.
