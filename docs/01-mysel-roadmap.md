# Roadmap — Caliber

> *The trust primitive for AI agent commerce on Arc.*

Phase-based plan. Phases don't have fixed dates — they expand or compress with your availability. Each phase ends at a milestone tied to a real-world event so the calendar stays honest even when the work doesn't.

**Two anchoring decisions (locked):**
1. **Stay on Arc.** No Base, no multi-chain expansion during the hackathon window. Caliber's positioning is "the rating layer for the Circle chain" — multi-chain dilutes that message in front of Circle judges. Multi-chain returns only as a Phase 6+ "if real demand emerges" item.
2. **Marketplace stays as a passive demo surface.** Don't actively develop it. If time allows late in the cycle, use it as the live demo in the hackathon video. If not, the SDK self-integration is enough.

---

## Branding

**Caliber** is the rating ecosystem. It replaces "ArcRating" as the umbrella term everywhere the service is described publicly.

| Brand | Role |
|---|---|
| **Caliber** | The rating service, methodology, SDK, attestation format, on-chain verifier. The product. |
| **ArcAgents** | The explorer / showcase site (caliber.poko.blue). The marketing surface that hosts the live data and the demo marketplace. |
| **Caliber-AAA … Caliber-D** | The tier scale. **Locked** — supersedes Arc-AAA … Arc-D across the methodology paper, SDK types, RatingBadge, and all API responses. |

Tagline candidates (pick one during Phase 0):
- *"Caliber — the trust primitive for autonomous agent commerce on Arc."*
- *"Caliber — know which agents your contracts can trust."*
- *"Caliber rates AI agents on Arc. Marketplaces, contracts, and runtimes consume the rating in one call."*

---

## Positioning (what the research locked in)

Caliber is **not** another agent marketplace. The agent commerce stack is converging without us:

- **Identity** → ERC-8004
- **Messaging** → MCP + A2A
- **Payment** → x402 (on Base) and native USDC (on Arc)
- **Escrow** → ERC-8183
- **Trust / risk selection** → *nobody* owns this. Caliber does, starting on Arc.

Every commerce protocol on the field leaves the same question unanswered: *should I trust this agent enough to fund the escrow?* Caliber answers it with a signed, methodology-backed, contract-consumable rating — purpose-built for the Arc ecosystem first.

Lead with **"trust primitive for the Arc agent economy"** everywhere — website hero, methodology paper, grant pitch, hackathon submission.

---

## Phases overview

| Phase | Goal | Milestone (real-world tie) |
|---|---|---|
| **0** — Caliber brand + Arc-only repositioning | Apply "Caliber" everywhere, rename tier scale to Caliber-AAA, drop multi-chain claims from public surface | Site + methodology read as "Caliber, Arc-native" before Circle grant submits |
| **1** — Grant submission | Circle Developer Grant with the Caliber + Arc-native framing | **Circle Developer Grant deadline (2026-05-31)** |
| **2** — SDK v0.1 (TypeScript) | Make Caliber trivially integrable in <10 min on Arc | Builder docs page + working TS SDK; Python deferred to Phase 6 |
| **3** — Demo + Circle relationship | Lock in either a polished marketplace demo or an Arc/Circle team endorsement (or both) | Hackathon video has a credible "real usage" beat |
| **4** — Methodology v1.1 | Deepen the moat that makes Caliber an underwriting product, not a leaderboard | Caliber methodology v1.1 published with changelog |
| **5** — Hackathon submission | Submit Track 4 with the Arc-native trust-layer narrative | **Stablecoins Commerce Stack Track 4 deadline (2026-07-13)** |
| **6** — Post-hackathon distribution + v1.2 | Lock Caliber in as the de-facto rating layer on Arc; expand outward only if validated | 3+ named integrations live OR Caliber-rated phrase appears in third-party docs |

**Phases can run in parallel where dependencies allow.** Phase 4 (methodology) is independent of Phase 2 (SDK) and Phase 3 (demo/outreach). The only hard ordering: 0 → 1 (rebrand before grant); 2 → some self-integration in 3 (SDK before demo); at least one of 3's outcomes before 5 (something to point to in the submission).

---

## Phase 0 — Caliber brand + Arc-only repositioning

**Goal:** every public surface reads as "Caliber, the trust primitive for the Arc agent economy". Tier scale is uniformly Caliber-AAA … Caliber-D. Multi-chain language is stripped from public copy (Base support stays in the codebase but isn't marketed).

**Deliverables:**
- **Tier rename across all code + docs:** `Arc-AAA` → `Caliber-AAA`, etc. Touches:
  - Methodology paper (every tier mention in §3.1, Appendix C, examples, API response schema)
  - `rating/engine/types.ts` — `ArcRating` type → `CaliberTier`
  - `web/src/lib/api.ts` — `ArcTier` type → `CaliberTier`
  - `web/src/components/ui/RatingBadge.tsx` — tier name display + style map
  - `web/src/app/agents/page.tsx` — tier filter chips
  - `web/src/app/rating/[chain]/[id]/page.tsx` — tier ladder display
  - `rating/api/v1/agents/[chain]/[id]/attest/route.ts` — tier-name accept list in request body
  - All Foundry tests + Solidity comments
- **Methodology paper renamed** to "Caliber Rating Methodology" everywhere it currently says "ArcAgents Rating Methodology". Attribution string in §9.2 stays "ArcAgents by PokoBlue" (publisher; Caliber is the product).
- **Arc-only positioning:** strip "Arc + Base" from public copy in the methodology paper, marketplace plan, home page. Indexer code retains Base scaffolding (parked, not deleted).
- **Home page hero rewritten** to lead with Caliber + Arc-native trust-layer framing. Marketplace stays in nav but is clearly framed as a demo, not the product.
- **New `/integrate` page** (or section of the home page): 2 code snippets (HTTP API, Solidity verifier), 1 paragraph "what is this for", links to forthcoming SDK docs.
- Update `<meta>` descriptions, OG tags, Twitter card on every page.

**Out of scope:**
- Logo / visual identity — Claude Design iterates separately; ship copy first.
- `caliber.poko.blue` subdomain — too much DNS/cert/URL-rewrite work for the timing. `caliber-api.poko.blue` stays as the API endpoint.
- Renaming on-chain contracts — they keep `RatingVerifier` / `RatingGateway` (Moody's contracts wouldn't be called "Moody's"). Brand and contract names are decoupled.

**Done when:** a stranger landing on `caliber.poko.blue` understands within 10 seconds that Caliber is a *rating service for Arc agents*, and the methodology paper renders cleanly with Caliber-AAA throughout.

---

## Phase 1 — Grant submission

**Goal:** Circle Developer Grant submitted with the Caliber + Arc-native framing.

**Deliverables:**
- Grant submission draft using the trust-layer positioning. Lead message: *"Caliber is the missing trust primitive every Arc-native agent commerce flow needs. We rate agents with a published methodology and gate ERC-8183 escrow with signed attestations — purpose-built for Circle's chain."*
- Circle Product Feedback section emphasizes:
  - USDC predictability for the rating-gated escrow flow
  - Why Arc-first (vs. fragmenting across chains) is the right thesis
  - How Caliber complements (not competes with) other Arc-native products
- Working demo URL (caliber.poko.blue), live API endpoint (caliber-api.poko.blue/v1/agents/:chain/:id/rating), on-chain contracts (RatingVerifier `0x32d5…cdC6`, RatingGateway `0x3B7f…7682` on Arc Testnet).

**Milestone:** **Circle Developer Grant submitted before 2026-05-31 23:59 UTC.**

**Risk:** if you start Phase 2 before this, the grant suffers. Lock Phase 0 + 1 before opening any SDK code.

---

## Phase 2 — SDK v0.1 (TypeScript)

**Goal:** a builder integrating Caliber on Arc reads the docs once and ships in under 10 minutes.

**Deliverables:**
- `@caliber/sdk` (TypeScript) — wraps the gateway + attestation flow on Arc. Surface:
  - `getRating(agentId)` → `RatingResponse` (chain defaults to `'arc'`)
  - `requestAttestation(agentId, { minTier, minConfidence })` → `{ attestation, signature }`
  - `postGatedJob(...)` → `{ jobId, txHash }`
  - Types: `RatingAttestation`, `CaliberTier`, `Confidence`
- Solidity helper: `CaliberGated` mixin so any Arc-native contract can require min-rating with one inherited modifier (e.g. `function postJob() onlyCaliberRated(Tier.A, msg.sender)`)
- Docs at `caliber.poko.blue/integrate` with 4 copy-pasteable examples — read-only rating lookup, attestation request, gateway post-job, custom-contract integration via Solidity mixin.
- Smoke test: integrate the SDK into a toy LangGraph (or plain Node) agent that refuses to call any sub-agent below Caliber-A. Record the run.

**Python wrapper:** deferred to Phase 6. LangGraph / AutoGen integrations matter eventually but aren't critical for the Arc-first, hackathon-window play.

**Done when:** you can hand the docs URL to someone unfamiliar with the project and they ship a working integration in <10 min without asking you anything.

**Dependencies:** none — can start the moment Phase 1 ships.

---

## Phase 3 — Demo + Circle relationship (low-friction, high-leverage)

**Goal:** the hackathon submission has a credible "real usage" beat. This can come from any of three sources — pick whichever is easiest given your bandwidth.

**Three paths (any one is sufficient; do more if time allows):**

| Path | What it requires | What you get |
|---|---|---|
| **A) Self-integration demo** | The SDK from Phase 2 + a toy LangGraph or plain Node agent using it. The marketplace doubles as the on-chain demo. | A clean 60-second video segment showing Caliber gating real USDC. **Lowest friction — entirely under your control.** |
| **B) Marketplace polish** | A polish pass on `/post-job` UX (only if you have spare cycles). No new features — just clarify copy, smooth the 3-popup flow. | The existing marketplace becomes the live demo in the hackathon video. |
| **C) Circle / Arc team endorsement** | Professional outreach: email Arc dev rel, share a working demo, ask for a quote or a feature placement on Arc's ecosystem page. | A Circle-stamped endorsement in the submission. **Highest leverage if landed; uncertain timing.** |

**Default plan: Path A always ships.** Path B is a nice-to-have. Path C is a stretch — try it if Phases 0–2 land with time to spare.

**Done when:** the hackathon video has at least Path A. If Path B or C lands too, even better.

**Real-world tie:** must produce *something* demoable before Phase 5 (hackathon submission) since the video needs a "this is real" section.

---

## Phase 4 — Methodology v1.1

**Goal:** Caliber moves from "interesting score" to "auditable underwriting surface". This is the moat-deepening shipment.

**Deliverables (additive to v1.0):**
- **Confidence-tier ceiling** — cap max rating by confidence band: `low` confidence (5–14 interactions) → max Caliber-BBB; `medium` (15–49) → max Caliber-A; `high` (≥50) → unrestricted up to Caliber-AAA. Reason: in v1.0 an agent with 6 positive feedbacks and 0 completed jobs gets Caliber-AAA + "low" confidence (e.g., agent 2511 in production data). The "low" label is supposed to warn, but AAA next to it overrides intuition. Capping by confidence makes the warning structural, not visual. Updates methodology §3.1 + §3.2.
- **Migration matrices** — table of tier transitions over rolling 30/90-day windows. Shows agents drifting between tiers, which is what a real rating agency publishes.
- **Watchlists** — Watch Negative / Watch Positive based on deteriorating or improving signals. Already defined as rating actions in v1.0 §3.4; now actually emitted in the API response.
- **Validator-quality weighting** — downweight feedback from validators whose own historical reliability is low. Stops Sybil rings of low-quality mutual validations from inflating ratings.
- **Sybil-cluster concentration** — flag agents whose feedback comes from a small interconnected wallet cluster. Already listed in §4.5 anti-gaming controls; this is where the actual algorithm goes.
- **Evidence objects** — every rating response includes an `evidence` array: `[{ factor, contribution, signals_used, last_observed_at, source_tx_hashes }]`. This is the "why-rated" surface that makes the rating *defensible* in dispute, not just *informative*.
- Methodology paper updated to v1.1 with full changelog. v1.0 stays accessible at a versioned URL for the §8.1 governance promise (old + new in parallel during transition).

**Done when:** v1.1 paper is published and every rating API response carries the new evidence object.

**Dependencies:** none — can run fully in parallel with Phase 2 and Phase 3.

---

## Phase 5 — Hackathon submission

**Goal:** Submit to Stablecoins Commerce Stack Track 4 with a sharp Arc-native trust-layer narrative.

**Deliverables:**
- **3-minute demo video** structured as:
  1. (15s) "Agent economies on Arc are exploding. None of these agents trust each other by default."
  2. (60s) Show a builder integrating Caliber's SDK in ~30 lines of code — your LangGraph or Node agent refusing to call any sub-agent below Caliber-A.
  3. (60s) Show the on-chain enforcement: post a job through RatingGateway, the gate refuses one agent (insufficient confidence), accepts another (Caliber-AAA), USDC moves into escrow. (Can use the marketplace UI for this — that's its job.)
  4. (45s) Close on usage numbers and (if Phase 3-C landed) the Circle/Arc endorsement quote. *"15k+ Arc agents indexed, 860 rated, X attestations served, methodology v1.1 published."*
- README quickstart that mirrors the docs site.
- Architecture diagram showing Caliber as the layer between agent runtimes and ERC-8004/8183 contracts on Arc.
- Circle Product Feedback section: USDC predictability + Arc-first thesis.
- Submission form fields pre-filled per the marketplace plan §7.

**Milestone:** **Submitted to Stablecoins Commerce Stack Track 4 before 2026-07-13 23:59 UTC.**

**Critical:** submit early in the window (Mon Jul 7), not on the last day. Buys time for any technical fix.

---

## Phase 6 — Post-hackathon distribution + Methodology v1.2

**Goal:** Caliber becomes the de-facto rating layer for Arc-native agent commerce. Expand outward (Base, Python SDK, x402) only when Arc-side demand validates the thesis.

**Deliverables (in priority order, do as bandwidth allows):**
- **Arc-native distribution** — formal relationship with Arc/Circle team; appearances at any Arc-ecosystem events; co-marketing with any Arc-native commerce protocol that emerges (none confirmed yet — keep an eye on the ecosystem).
- **Methodology v1.2:**
  - **Initial backtest results** — fill §7.2 (currently empty). ROC-AUC, Gini, per-band calibration, sample size, default count. Publish results regardless of strength.
  - **Dispute-evidence schema** — standardized format for the evidence cataloged when a rating is contested.
  - **Statistical recalibration** — transition from scorecard weights to fitted logistic regression if data permits.
- **Python SDK** — only if a serious LangGraph / AutoGen integrator asks. Otherwise stays deferred.
- **Multi-chain expansion (Base)** — only if a named Base-native commerce protocol commits to integrating. Otherwise stays parked. The Base scaffolding in the codebase remains dormant but ready.
- **Cross-chain identity binding** — design proposal for linking agent IDs across chains. Only relevant if Base actually ships.

**Done when:** "Caliber-rated" or "Caliber-AAA" appears in third-party documentation, social posts, or product pages without you having to ask.

**Real-world tie:** ongoing, distribution-driven. No single deadline.

---

## Strategic decisions still open

1. **Tagline lock.** Three candidates in the Branding section above. Pick one before Phase 0 ships.
2. **Subdomain strategy.** `caliber.poko.blue` would be ideal long-term but breaks too many things to migrate now. Defer to Phase 6 — only revisit if Caliber lands 5+ integrations or partners specifically want it.
3. **Signer key rotation.** The current `RATING_SIGNER_PRIVATE_KEY` was exposed in conversation. For testnet + hackathon demo this is fine. Before any external integration partner signs a contract that trusts attestations, rotate — costs ~$0.025 USDC to redeploy the verifier with a fresh signer.
4. **Logo + visual identity.** Claude Design is iterating separately. Slot in whenever it doesn't compete with a phase milestone. Doesn't gate any phase.
5. **Phase 3 ambition.** You can choose to push Path C (Circle outreach) early in the cycle for max leverage, OR default to Path A (self-integration) and only attempt Path C as a stretch. Both are valid — depends on your bandwidth and appetite for BD work.

---

## What's parked (don't do these in the hackathon window)

| Parked thing | Why parked, when to revisit |
|---|---|
| **Base mainnet expansion** | Off-message for Circle hackathon. Codebase keeps Base scaffolding but no public marketing or new contract deploys. Revisit in Phase 6 if a named Base-native partner commits. |
| **x402 / Coinbase Builder Program** | x402 lives on Base. Pursuing forces multi-chain. Defer until Phase 6 + Arc-first validation. |
| **Python SDK** | Important for LangGraph / AutoGen long-term, not critical for Arc-first hackathon. Build when there's confirmed demand. |
| **Marketplace UX polish (negotiation, chat, iterative drafts)** | Marketplace is a demo, not the product. Don't invest in features. |
| **Mobile-first redesign** | Builders use desktops; agents have no screens. |
| **Thai-language toggle** | Nice for personal pride, irrelevant to judges/builders. |
| **BNB Chain or any other L1/L2 coverage** | Follow ERC-8004/8183 *actual* usage. Don't chase chain-count breadth. |
| **Cross-chain identity binding** | Belongs in methodology v1.2 (Phase 6) only if Base ships first. |
| **Custom messaging / human-style negotiation UX on `/post-job`** | Agent commerce isn't human chat. Don't simulate Upwork. |
| **Generic "AI + Web3" marketing** | Anti-positioning. Caliber is: rating layer, ERC-8004/8183-native, Arc-first, methodology-driven. Stay sharp. |

---

## Methodology cadence (the moat is here)

| Version | Status | Adds |
|---|---|---|
| **v1.0** | Published 2026-05-20 | PPD / LGD / EAD framework, Caliber-* scale (post-Phase-0 rename), anti-gaming controls (§4.5), rating actions (§3.4), data sources (§1.4), minimum data requirement (§1.5) |
| **v1.1** | Phase 4 deliverable | Migration matrices, watchlists emitted, validator-quality weighting, sybil concentration algorithm, "why-rated" evidence objects |
| **v1.2** | Phase 6 deliverable | Initial backtest results (§7.2), dispute-evidence schema, statistical recalibration if data permits |
| **v1.3** | Post-roadmap | Additional segments, model recalibration cadence, vendor-risk evolution; cross-chain identity binding if/when Base activates |

Each version bump gets the §8.1 governance treatment: 30-day notice, old + new running in parallel during transition. This cadence — visible, regular, methodologically rigorous — is what makes Caliber feel like a real rating agency rather than a side project.

---

## Distribution / partnership matrix (post-hackathon)

The research surfaced six high-leverage partners. **None are pursued during the hackathon window** because most are Base-native and contradict the Arc-first thesis. After Phase 5 ships, revisit in priority order:

| Partner | Their slice | Pitch | When to engage |
|---|---|---|---|
| **Arc / Circle developer team** | The chain itself | "Caliber is the rating layer for your ecosystem. Feature us, introduce us to Arc-native builders." | **Phase 3 Path C (stretch) or immediately Phase 6** |
| **arcagents.pro** | Arc-native explorer / leaderboard | "Co-marketing — your leaderboard + our rating = combined story. We're complementary, not competitive." | Phase 6, if relationship is friendly |
| **Any Arc-native ERC-8183 commerce protocol** | Direct integration target | "Rating-gate your job postings with one Solidity mixin." | Phase 6, as they emerge on Arc |
| Virtuals | Base, ERC-8183-shaped, 2k+ agents | Same pitch, requires Base support first | Phase 6+, only if Base activates |
| WorkProtocol | Base job marketplace | Same pitch, requires Base support first | Phase 6+, only if Base activates |
| Coinbase x402 | Base, pay-per-call | "Rating as 401-precheck for service providers." | Phase 6+, requires multi-chain |
| Nevermined | Multi-chain agent monetization | "Premium plans require Caliber-A or higher." | Phase 6+ |
| QuickNode | ERC-8004 explorer (multi-chain) | "Your data + our enforcement = best-in-class combo." | Phase 6+, friendly because complementary |

**Don't try for more than one during Phase 6.** Land one, ship it, get the announcement, then move to the next.

---

## Open questions worth answering as phases progress

1. **Will Arc go mainnet during this window?** Currently testnet. If Arc mainnet launches before Phase 5, the hackathon submission gets significantly stronger.
2. **How active is the Arc ecosystem of agent commerce protocols today?** Reconnaissance during Phase 0 — if there's a real protocol shipping on Arc, that's a closer Phase 3 partner than Circle dev rel.
3. **Does the Caliber name conflict with anything in the AI/crypto space?** Quick check before Phase 0 commits the rename publicly. If it does, the brand decision reopens.
4. **Should the methodology paper move to its own domain** (caliber-methodology.org or similar) so it can be co-cited independently of caliber.poko.blue? Defer; not load-bearing until Caliber has 3+ integrations citing it.
5. **Pricing model.** Caliber is free in v1 (open methodology, open API). At what scale does a paid tier make sense? Not a Phase 0–6 question; revisit when API is doing >100 attestations/hour.

---

*Document version 1.1 (Arc-only, Caliber-AAA tier locked, marketplace as demo only). Maintained by PokoBlue. Updated when phase definitions, milestones, or strategic decisions change.*
