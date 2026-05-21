> **[HISTORICAL — superseded by `docs/01-mysel-roadmap.md` + Caliber rebrand 2026-05-21]**

# ArcRating — Phase 1 Daily Execution Plan

> **Companion to:** `phase1.md` (the high-level day shape) and `01-Methodology.md` (the risk model spec).
> **Format:** Each day has **Part A** (LLM-coding prompt — copy-paste into a fresh Claude Code session) and **Part B** (human-only tasks: posts, Discord, accounts, decisions).
> **Codebase root for LLM:** `/home/huicom/arc-agents-explorer/` (the plural-name repo; the singular-name dir holds only docs).
> **Working calendar:** Tue May 19 → Mon May 25, 2026, Bangkok GMT+7.

---

## Global LLM Coding Conventions

These apply to **every** Part A prompt this week. Paste this block at the top of any session if the LLM hasn't seen it:

```
You are working on ArcRating, the rating-service portion of the arc-agents-explorer monorepo.

Repo root:   /home/huicom/arc-agents-explorer
Methodology: /home/huicom/arc-agent-explorer/docs/02-riskmodel/01-Methodology.md
Phase plan:  /home/huicom/arc-agent-explorer/docs/02-riskmodel/phase1.md
Existing layout:
  packages/db/src/schema.ts        — Drizzle schema (chain_id already on agents/feedback/validations/jobs/job_events)
  indexer/arc/                     — Arc indexer (backfill + live)
  indexer/base/                    — Base indexer scaffold (backfill.ts, client.ts, contracts.ts)
  indexer/shared/chain-config.ts   — Chain registry (Arc filled, Base TODO)
  rating/engine/{pd,lgd,ead,rating}.ts — Stubs with TODOs
  rating/api/v1/agents             — Empty; API to be added
  web/pages/                       — Next.js pages

Rules:
- Read 01-Methodology.md before writing math; numeric thresholds must match §3.1, §4, §5, §6.
- TypeScript strict. No `any` without comment. No backwards-compat shims unless asked.
- Idempotent indexer writes (ON CONFLICT DO NOTHING).
- Never invent contract addresses or block numbers. If a value is unknown, fail loudly with a clear error and ask.
- Run `pnpm typecheck` from repo root before declaring done.
- Before saying "done", restate each acceptance criterion and how you verified it.
```

---

## 🟢 Tuesday May 19 — Foundation Cleanup + Positioning Launch

### Goal
The build for today is already marked `[done]` in `phase1.md`. The remaining LLM work is a small repo hygiene pass so the Saturday public reveal lands on a tidy tree. The day's real deliverable is the **Twitter thread** (you).

### Part A — LLM Coding Prompt

```
Context: Phase 1 Day 1 of the ArcRating build. The rating/ scaffold and indexer/base/ scaffold exist but stubbed. Goal today is a clean baseline before tomorrow's Base spike.

Tasks:
1. Run `pnpm install` then `pnpm typecheck` from repo root. Report any errors verbatim. Fix only true breakages — do NOT add features.
2. In rating/README.md, replace placeholder content with a 6–10 line description of the service: what it rates (ERC-8004 agents), the headline output (Arc-AAA → Arc-D + PD/LGD/EAD), the methodology reference, and a "not yet live" line. Use lowercase-friendly tone. No emojis.
3. Verify rating/engine/{pd,lgd,ead,rating}.ts each contain a placeholder export so future imports resolve. If a file only has comments, add `export {};` to make it a module. Do not implement logic — that is Friday.
4. Read 01-Methodology.md §3.1 (Rating Scale). In rating/engine/rating.ts, replace the outdated tier comment block (which currently says Arc-AAA..Arc-D with PD/LGD pairs that do NOT match the methodology) with the canonical 9-tier PD bands from §3.1 as a comment only. Tiers are: AAA, AA, A, BBB, BB, B, CCC, CC, D. Still no logic.
5. Add a top-of-repo `.env.example` at /home/huicom/arc-agents-explorer/.env.example with placeholder keys: DATABASE_URL, ARC_RPC_URL, ARC_RPC_WS, BASE_RPC_URL, BASE_RPC_WS, DEPLOYMENT_BLOCK_ARC, DEPLOYMENT_BLOCK_BASE. If the file already exists, only add missing keys.

Acceptance criteria (verify each before reporting done):
[ ] `pnpm typecheck` exits 0
[ ] rating/engine/rating.ts comment shows all 9 tiers (AAA, AA, A, BBB, BB, B, CCC, CC, D) with PD bands matching §3.1 exactly (< 0.5%, 0.5–1.5%, 1.5–3.0%, 3.0–6.0%, 6.0–12.0%, 12.0–20.0%, 20.0–35.0%, 35.0–60.0%, >60%)
[ ] rating/engine/{pd,lgd,ead,rating}.ts each export at least one symbol (or `export {};`)
[ ] rating/README.md is non-empty, references methodology, sets expectations
[ ] .env.example contains all 7 listed keys

Self-check: re-read the methodology §3.1 table and confirm Arc-CC (35–60%) is present — the previous stub omitted it. Show me the diff for rating.ts before completing.

Out of scope today: any PD/LGD/EAD math, any indexer changes, any Base config, any API routes.
```

### Part B — Your Manual Tasks
- [ ] Twitter thread (5–6 tweets), topic "agent reputation is performance-bond risk, not credit risk", tags `@arc @samconnerone`, post 8–10pm Bangkok.
- [ ] Confirm community.arc.network Architect Tier registration is submitted (you marked it `started`).
- [ ] Decision: which Base RPC are you starting with tomorrow's spike — Alchemy free tier, public Base RPC, or QuickNode? Note it in your daily notes; the LLM needs it Wednesday.

---

## 🟡 Wednesday May 20 — Spike (Base Viability + PD Sanity)

### Goal
Prove three things end-to-end on real data, then publish a screenshot. (1) Base RPC choice works for our query pattern. (2) The published Base ERC-8004 contracts return events. (3) A naive empirical PD against 50 Arc agents already produces a sensible distribution.

### Part A — LLM Coding Prompt

```
Context: Phase 1 Day 2. Today is a SPIKE — read-only investigation + one quick script. Do not modify schema or write a real backfill yet; that is Thursday. We want answers, not infrastructure.

Decisions you must surface (do not silently pick):
- Which Base RPC URL to use this week. The user will tell you (Alchemy free, public Base, or QuickNode). If they did not, STOP and ask.

Inputs to verify against the methodology:
- 01-Methodology.md §4.2 empirical_default_rate = defaulted_jobs / total_completed_jobs
- 01-Methodology.md §4.1 defines what counts as a default (canceled/refunded/disputed job OR failing validation OR feedback below threshold OR 90-day inactivity)

Tasks:
1. Update indexer/shared/chain-config.ts to add a `base` entry alongside `arc`. Use these canonical Base ERC-8004 contracts from phase1.md: identityRegistry `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`, reputationRegistry `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63`. For validationRegistry and agenticCommerce on Base: read indexer/base/contracts.ts (already scaffolded) — use what's there. If those addresses are missing, leave them as the empty-string sentinel and console.warn at config load. Do NOT invent addresses. chainId for Base mainnet = 8453. usdcContract on Base = `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`.
2. Create a one-shot script rating/scripts/base-spike.ts that:
   - Connects to BASE_RPC_URL from env (require it; throw if missing)
   - Calls `getBlockNumber()` and `eth_getLogs` for the IdentityRegistry Transfer event over the last 50,000 blocks
   - Prints: connected block, latest block, count of Transfer events, time elapsed
   - Exits non-zero on RPC error
3. Create a one-shot script rating/scripts/pd-sanity.ts that:
   - Reads 50 random Arc agents from the local Postgres (use packages/db client)
   - For each, computes empirical_default_rate per methodology §4.2 — defaulted = jobs whose status in ('cancelled','refunded','disputed') OR validations with status='failed' OR (deprecated) feedback below threshold; total_completed = jobs with status='completed' + defaulted
   - Bands each agent into a tier using the §3.1 PD ranges (treat empirical rate as PD for sanity only — this is NOT the final model)
   - Prints a tier histogram (AAA..D) and a CSV table to stdout
   - Skips agents with fewer than 5 total observations (§3.2 Confidence-Insufficient)
4. Add an npm script in rating/package.json: `"spike:base": "tsx scripts/base-spike.ts"` and `"spike:pd": "tsx scripts/pd-sanity.ts"`. Add tsx as a devDependency if missing.

Acceptance criteria:
[ ] `pnpm typecheck` exits 0
[ ] `pnpm --filter @arc-agents/rating run spike:base` prints a non-zero log count from Base (or fails loudly with the specific RPC error — both outcomes are acceptable; report which)
[ ] `pnpm --filter @arc-agents/rating run spike:pd` prints a tier histogram across 50 agents; non-empty buckets in at least 3 tiers OR a clearly documented "insufficient data" outcome
[ ] No new tables, no new migrations, no new dependencies beyond `tsx` and `viem` (already in repo via indexer)
[ ] Script paths exactly: rating/scripts/base-spike.ts and rating/scripts/pd-sanity.ts
[ ] Base chain entry in chain-config.ts uses chainId 8453 and the two confirmed contract addresses; unverified addresses left blank with a warn, not faked

Self-check before reporting done:
- Show the tier histogram output verbatim
- Show the Base spike output verbatim
- State which Base RPC URL was used and whether it rate-limited
- Confirm you did NOT mutate packages/db/src/schema.ts (schema migration is Thursday)
```

### Part B — Your Manual Tasks
- [ ] Tell the LLM which Base RPC URL to use (and put it in `.env`).
- [ ] If Alchemy free tier hits rate limits, decide: upgrade tier, switch provider, or accept slower spike. Note for Thursday.
- [ ] Take screenshot of the tier histogram → tweet single-image with caption per phase1.md Wed copy.
- [ ] Final pass on `docs/02-riskmodel/01-Methodology.md` for Saturday publish — fill `[TO BE FILLED]` publication date, glossary at Appendix B if you have 20 min. LLM can draft these too if you'd rather (see optional task below).

**Optional Part-A extension** (if you want LLM to draft methodology blanks):
```
Optional task: in /home/huicom/arc-agent-explorer/docs/02-riskmodel/01-Methodology.md
- Fill Appendix B Glossary with terms: ERC-8004, ERC-8183, IdentityRegistry, ReputationRegistry, ValidationRegistry, escrow, surety bond, PIT vs TTC, Gini, ROC-AUC, lookback window. Plain English, 1–2 sentences each. Do not editorialize.
- Leave the "Published" date placeholder; the user fills it Saturday.
```

---

## 🟡 Thursday May 21 — Multichain Build

### Goal
Make `chain_id` first-class everywhere it isn't already, get a real Base backfill running for 30 days of history, and prove the same query code returns sensible counts for Arc and Base.

### Part A — LLM Coding Prompt

```
Context: Phase 1 Day 3. Yesterday's spike confirmed Base RPC viability. Today we make Base a real indexed chain. The schema already has chain_id on agents, feedback_events, validations, jobs, job_events (verify by reading packages/db/src/schema.ts). The work is plumbing, not schema redesign.

Tasks:
1. Audit packages/db/src/schema.ts — confirm chain_id exists on all 5 event tables with default 'arc' and is NOT NULL. If any table is missing chain_id, generate a Drizzle migration that adds it with default 'arc' and backfills existing rows. Do NOT change primary keys (agentId, jobId) yet; multi-chain key uniqueness is a v2 concern — document this in a comment near the agents table. (Read 01-Methodology.md §9.3 — v1 covers Arc and Base.)
2. Refactor indexer/arc/backfill.ts and indexer/arc/live.ts to read chain identity from indexer/shared/chain-config.ts instead of hardcoded 'arc' strings. Verify with grep that 'arc' string literal is now only present in chain-config keys.
3. Implement indexer/base/backfill.ts as a thin caller of a shared backfill function. Extract shared logic into indexer/shared/backfill-core.ts so indexer/arc/backfill.ts and indexer/base/backfill.ts both call it with a ChainConfig argument. Function signature should be: `runBackfill(chain: ChainConfig, fromBlock: bigint, toBlock: bigint | 'latest'): Promise<{ inserted: number; lastBlock: bigint }>`. Reuse the existing Arc parsers — do not duplicate them.
4. Add a npm script at repo root: `"backfill:base": "node --import tsx indexer/base/backfill.ts"`. Configure it to start from BASE_DEPLOYMENT_BLOCK env or (current_block - 30*24*60*60/2) as fallback for "last 30 days" on Base's 2s block time. Document the fallback in a comment.
5. Run the Base backfill against the local Postgres. Report inserted row counts per table. If RPC rate-limits, use 5000-block batches with 200ms sleep between batches (matches Phase 2 pattern in docs/02_PHASE_2_BACKFILL.md if it exists; otherwise default to that).
6. After backfill, run two SQL sanity queries and report results:
   - `SELECT chain_id, COUNT(*) FROM agents GROUP BY chain_id;`
   - `SELECT chain_id, COUNT(*) FROM jobs GROUP BY chain_id;`

Acceptance criteria:
[ ] `pnpm typecheck` exits 0
[ ] All 5 event tables have non-null chain_id column (confirm with `\d agents`, `\d jobs`, etc. or by reading schema.ts)
[ ] indexer/shared/backfill-core.ts exists and is imported by BOTH indexer/arc/backfill.ts and indexer/base/backfill.ts (grep proof)
[ ] `pnpm backfill:base` completes without unhandled errors and prints inserted-rows-per-table
[ ] Both SQL queries return at least one row for chain_id='arc' AND chain_id='base' (or 'base' is empty but with explanation of why — e.g., no Identity events on Base in the 30-day window)
[ ] No duplicate parser code between Arc and Base backfills — diff between the two top-level files should be ~10 lines (config plumbing only)

Self-check before reporting done:
- Paste the SQL counts verbatim
- Paste the diff between indexer/arc/backfill.ts and indexer/base/backfill.ts to prove no parser duplication
- Confirm migration applied cleanly (if any was needed) or that no migration was needed
- Note any Base events that did NOT decode and why (Base may use slightly different ABI versions)
```

### Part B — Your Manual Tasks
- [ ] Make sure `DATABASE_URL` points to a Postgres you don't mind populating; backup if it has Arc data you care about.
- [ ] Twitter thread (4–5 tweets) "indexing ERC-8004 across multiple chains — what's actually hard", tags `@arc @DavideCrapis`, evening Bangkok. The LLM's "events that did NOT decode" note from self-check is a good thread input.
- [ ] If Base backfill returns near-empty results, decide whether the methodology paper should soften the multichain claim ("Arc-native, Base coverage rolling out") — easier to ship truthful than rebuild.

---

## 🟡 Friday May 22 — Risk Engine + Live API

### Goal
The methodology becomes executable. PD, LGD, EAD, tier assignment, and a live HTTP endpoint that returns a full rating for an agent. This is the highest-substance technical day of the week.

### Part A — LLM Coding Prompt

```
Context: Phase 1 Day 4. Indexer is multichain. Today we implement the rating engine per 01-Methodology.md §4, §5, §6, §3 and expose it via HTTP. v1 simplifications are explicitly called out below — do not over-engineer beyond v1 scope.

v1 simplifications (locked):
- PD model: v1 uses empirical_default_rate as base PD plus a small set of additive/multiplicative adjustments (§4.3 directional factors). FULL logistic-regression β-calibration (§4.4) is deferred — leave a TODO and a stub. Reason: we have insufficient labeled defaults for regression fit this week; the methodology says v1 is acceptable as a "calibrated empirical estimate with documented factor adjustments" — keep that wording.
- LGD: implement segmentation (§5.3) with the 4 segment buckets. If recovered_USDC data isn't yet tracked, return a segment-default LGD from a const map keyed by agent_type, with a clear "data-thin estimate" flag in the response. Document this in a comment referencing §5.
- EAD: §6.2 — funded-only, sum of in-flight (status not in terminal set) job budgets. No CCF.
- Confidence: §3.2 tiers based on interaction count. Implement exact thresholds.

Tasks:
1. Implement rating/engine/pd.ts:
   - export `computePD(agentId: bigint, chainId: string, lookbackDays = 180): Promise<{ pd: number; baseRate: number; adjustments: Record<string, number>; sampleSize: number }>`
   - Compute empirical_default_rate per §4.2
   - Apply at least these factor adjustments from §4.3 (additive in log-odds space, then sigmoid back, OR multiplicative on the rate — pick one and comment why):
     * agent_age_days (younger → higher PD)
     * validator_diversity (concentrated → higher PD) — count of distinct validators in feedback/validations
     * recent_feedback_trend (declining → higher PD) — slope of last 14d vs prior 14d feedback scores
   - Clamp PD to [0, 1]. Return component breakdown for explainability.
2. Implement rating/engine/lgd.ts:
   - export `computeLGD(agentId: bigint, chainId: string): Promise<{ lgd: number; segment: string; basis: 'empirical' | 'segment-default' }>`
   - Determine segment from agent.agent_type (map "trading" → trading, "payment" → payment_relay, "validator" → validator, anything else → service)
   - If agent has ≥3 observed defaults with recovery data, compute empirically per §5.2. Otherwise return segment_default value from this map (document as v1 estimate): trading=0.65, service=0.40, payment_relay=0.15, validator=0.20.
3. Implement rating/engine/ead.ts:
   - export `computeEAD(agentId: bigint, chainId: string): Promise<{ ead: number; jobCount: number }>`
   - Sum budget_usdc for jobs where provider_address = agent.owner_address AND status NOT IN ('completed', 'cancelled', 'refunded', 'disputed', 'expired')
   - Return USDC as a number (decimal precision matters — use the DB numeric value, not float).
4. Implement rating/engine/rating.ts:
   - export `assignTier(pd: number): { tier: 'Arc-AAA' | 'Arc-AA' | 'Arc-A' | 'Arc-BBB' | 'Arc-BB' | 'Arc-B' | 'Arc-CCC' | 'Arc-CC' | 'Arc-D'; band: string }`
   - Use EXACTLY the bands in §3.1
   - export `assignConfidence(sampleSize: number): 'High' | 'Medium' | 'Low' | 'Insufficient'` using §3.2 cutoffs
   - export `computeRating(agentId: bigint, chainId: string)` that orchestrates PD + LGD + EAD, computes EL = PD × LGD × EAD, returns a structured object including `methodology_version: '1.0'`.
5. Create rating/api/v1/agents/[chain]/[id]/rating route. Use whatever HTTP framework matches the repo's existing web/ Next.js setup — if Next.js is the host, this is a Next.js API route. If a standalone Express/Fastify server is preferred, create rating/api/server.ts on port 4000. Pick the simpler option, document choice.
   - Endpoint: GET /v1/agents/:chain/:id/rating
   - Validate :chain ∈ {arc, base}, :id is a positive bigint
   - Return JSON: { agent_id, chain_id, tier, pd, lgd, ead, expected_loss, confidence, sample_size, pd_components, methodology_version, computed_at }
   - 404 if agent not found
   - 422 if confidence === 'Insufficient' (with explanation field, no tier returned)
6. Add rating/tests/engine.test.ts — vitest. Test cases (all use mock DB or fixture data, no live RPC):
   - Tier boundaries: pd=0.004 → AAA, pd=0.005 → AA, pd=0.015 → AA boundary, pd=0.6 boundary → CC vs D
   - Insufficient confidence at sampleSize=4
   - EL = PD × LGD × EAD arithmetic
   - LGD segment defaults match the map
7. Add npm scripts: `"test": "vitest run"` in rating/package.json. Install vitest as devDependency.

Acceptance criteria:
[ ] `pnpm typecheck` exits 0
[ ] `pnpm --filter @arc-agents/rating run test` passes all tier-boundary tests
[ ] Curl against a real local agent: `curl localhost:<port>/v1/agents/arc/<some-known-agent-id>/rating | jq .` returns a complete JSON object with all listed fields populated
[ ] `tier` value is one of the 9 strings; `pd` is in [0,1]; `lgd` is in [0,1]; `ead` ≥ 0
[ ] `methodology_version` field present and = '1.0'
[ ] Run against an agent with <5 interactions: returns HTTP 422 + Insufficient message (not a tier)
[ ] No TODO left in rating/engine/*.ts that would block Saturday's launch — only TODOs for explicit v2 work (logistic regression calibration, empirical LGD)

Self-check before reporting done:
- Paste a real rating JSON response for an agent that has data
- Paste a 422 response for an Insufficient agent
- Pull the rating distribution: rate all agents with ≥ 5 interactions, group by tier, show counts. This is Friday's tweet image. Save as rating/scripts/tier-distribution.ts.
- Confirm 4.4 logistic regression β-calibration is explicitly marked v2 in a code comment AND in the response field `pd_components.notes` (so anyone reading the JSON sees the model maturity)

Out of scope today: methodology page rendering, public web UI, methodology PDF, repo cleanup. All Saturday.
```

### Part B — Your Manual Tasks
- [ ] Run `tier-distribution.ts` → screenshot. Pair with a JSON response screenshot. Tweet per phase1.md Fri copy, tags `@arc @samconnerone`, Friday evening Bangkok.
- [ ] Eyeball the tier distribution: does the shape feel reasonable for what you know about Arc agents? If 95% are AAA or 95% are D, ask the LLM to recheck the empirical-rate denominator (likely a count-completed-jobs bug).
- [ ] Decide port + hostname plan for Saturday's deploy: subdomain `rating-arcagents.poko.blue` — set Cloudflare DNS now so it propagates by Saturday.

---

## 🟡 Saturday May 23 — Methodology Launch (THE Centerpiece)

### Goal
Public surfaces: methodology page renders on the web, individual agent rating pages render, repo cleaned for public viewing, README accurate. Then post the launch thread and Discord.

### Part A — LLM Coding Prompt

```
Context: Phase 1 Day 5 — public reveal day. Today is mostly web rendering, content polish, and repo hygiene. The risk engine and API from Friday are working. Today they get a front door.

Tasks:
1. web/pages/methodology.tsx — render docs/02-riskmodel/01-Methodology.md as a styled page.
   - Use whatever markdown renderer already exists in web/ (check package.json); if none, add `react-markdown` + `remark-gfm`.
   - Apply prose styling consistent with the rest of the site (Tailwind `prose` class is fine if Typography plugin is configured; otherwise plain readable defaults).
   - Render tables properly; render code blocks with a monospace font.
   - Add a "Version 1.0 · Published [today's date]" header just below the H1.
   - Make sure the URL is reachable at /methodology.
2. web/pages/agent/[chain]/[id].tsx — server-rendered agent rating page.
   - Fetch from the rating API (same origin or env-configured URL)
   - Render:
     * Agent ID, owner address (monospace), agent name if available
     * Big tier badge (Arc-BB, etc.) — visually prominent, color-coded
     * PD, LGD, EAD, EL as labeled cards with units
     * Confidence tier
     * pd_components breakdown as a small table for transparency
     * "Methodology v1.0 — read full doc" link to /methodology
   - Handle 404 (agent not found) and 422 (insufficient confidence) with clear messages, not crashes
   - Dark-mode default per CLAUDE.md design principles
3. Add /api/agents/:chain/:id/rating as a Next.js API route inside web/ that proxies the rating engine (so the public domain rating-arcagents.poko.blue serves both methodology and ratings from one app). If the Friday work used a standalone server, this route just fetches it server-side. Keep it simple.
4. Update top-level README.md: project name, one-line summary, link to methodology, link to live URL (placeholder OK), repo structure, status="v1 launching May 23 2026". Keep under 80 lines. Lowercase-friendly. No emojis.
5. Repo hygiene pass:
   - Remove any stray .env files (NOT .env.example)
   - `pnpm typecheck` clean at root
   - No `console.log` left in rating/engine/*.ts (move to a debug flag)
   - Delete the obsolete pre-methodology tier comment block if still anywhere (it should already be gone from Tuesday, but double-check)
6. Add a /robots.txt (allow all) and basic <meta> tags (title, description, og:image placeholder) to web/.
7. Create one fixture agent rating snapshot in rating/tests/fixtures/example-rating.json so anyone reading the repo sees a concrete example of the output shape. Source it from a real Friday API call against an Arc-BB or Arc-BBB agent — anonymize nothing, the chain is public.

Acceptance criteria:
[ ] `pnpm typecheck` exits 0
[ ] `pnpm dev:web` (or whatever the web dev command is — check package.json scripts) starts and:
    - /methodology renders the full methodology page, all 9 tiers visible in §3.1 table
    - /agent/arc/<known-id> renders a rating page with all the expected sections
    - /agent/arc/<insufficient-id> renders a clear "insufficient data" page
[ ] README.md updated; methodology link works
[ ] No .env file in the repo (only .env.example)
[ ] rating/tests/fixtures/example-rating.json exists with a real (non-mocked) response shape
[ ] All 9 tier strings appear somewhere in the rendered methodology page

Self-check before reporting done:
- Open localhost:<port>/methodology in a real browser and screenshot the §3 rating table — paste the file path
- Open localhost:<port>/agent/arc/<a-real-agent-id> — screenshot the rating card
- Confirm tap targets and font sizes are readable on a mobile viewport (devtools 375px width)
- Confirm no client-side error in console
- Confirm dark mode is the default render (per CLAUDE.md design principles)

Out of scope today: deploy to rating-arcagents.poko.blue, SSL, nginx, systemd — that is later. Today the local-render and repo-public-ready bar is what matters; the user handles DNS/deploy separately.
```

### Part B — Your Manual Tasks
- [ ] Deploy: push to whatever hosting target rating-arcagents.poko.blue points at (Vercel, your VPS via nginx/systemd, or `pnpm build:web && pnpm start:web` behind nginx — see `docs/06_PHASE_6_DEPLOY.md` if it exists). The plan says public URL exists by Saturday; the LLM cannot do the DNS/SSL bits.
- [ ] Verify rating-arcagents.poko.blue/methodology and /agent/arc/<id> render on the live domain.
- [ ] Twitter thread (6–8 tweets) per phase1.md Sat copy. Tags `@arc @samconnerone @DavideCrapis @marco_derossi`. Saturday afternoon Bangkok = Saturday morning US.
- [ ] Discord post in **#user-made-things** (NOT #general-chat). Lowercase, 3–4 sentences, URL allowed.
- [ ] Fill `[TO BE FILLED]` publication date in the live methodology markdown to today's date.
- [ ] Update repo description on GitHub to point at rating-arcagents.poko.blue.

---

## 🟢 Sunday May 24 — Rest

### Goal
Recovery. Don't ship. Don't post.

### Part A — LLM Coding Prompt
**None.** No new code today.

If energy is high and you want to use 1h max: a tiny polish prompt is fine —

```
Optional: open web/pages/agent/[chain]/[id].tsx in a mobile viewport (375px). Identify the top 2 readability issues (font size, tap target, line length). Fix only those 2. Do nothing else. Report what you fixed.
```

### Part B — Your Manual Tasks
- [ ] Rest. Family. Lens business if you want. No posts.
- [ ] Quick passive check Saturday evening (Bangkok): did anyone reply to the methodology thread? Note for Monday recap, don't engage tonight unless someone tagged.

---

## 🔴 Monday May 25 — Recap + Audit

### Goal
Narrative close on the week. Twitter recap. Private Phase 1 audit. Phase 2 entry-gate decision.

### Part A — LLM Coding Prompt

```
Context: Phase 1 Day 7. No new feature work. Only the things below — small, additive, audit-friendly.

Tasks:
1. Generate a "Week 1 metrics" summary script at rating/scripts/week1-metrics.ts that prints, as a single Markdown block to stdout:
   - Total agents in DB grouped by chain_id
   - Total agents with rating issued (sampleSize >= 5) grouped by tier
   - Total agents Insufficient (sampleSize < 5)
   - Total ratings API requests served if access logs exist (skip if no log file; document why)
   - Methodology page rendering: render-only smoke check (HTTP 200 against /methodology on localhost)
2. Run it and paste the Markdown block in the final report. This is the source-of-truth for the user's recap tweet.
3. If `pnpm typecheck` regresses since Saturday, fix only the regression. Do not refactor.
4. Verify the public surfaces still work — same checks as Saturday's self-check. If anything broke between Saturday and Monday (very common after a Sunday off), fix it.

Acceptance criteria:
[ ] week1-metrics.ts exists and runs successfully
[ ] Markdown block is pasted in your final reply, ready to be copied into Twitter
[ ] /methodology and /agent/arc/<id> still render (confirm with curl or screenshot)
[ ] `pnpm typecheck` exits 0

Self-check:
- Re-read the methodology §3.1 — does the live page still match exactly? Any band drift = ship a fix.
- Look at the tier histogram: if Friday's looked different from today's, explain why (more data, fixed denominator bug, etc.)
- Confirm no half-finished branches lying around that would confuse a public repo viewer
```

### Part B — Your Manual Tasks
- [ ] Twitter recap thread (5–6 tweets) per phase1.md Mon copy, tags `@arc @samconnerone`, Monday evening Bangkok = Monday morning US (strong window).
- [ ] Phase 1 audit (private, 30 min) using the template in `phase1.md` §"Phase 1 Audit Template". Score signals: strong / medium / none.
- [ ] Phase 2 entry gate decision: energy ≥ 6/10 AND family ≤ yellow AND bank ≤ yellow → proceed full into Grant prep. Any red flag → scale Phase 2 to maintenance.
- [ ] Ask me (this assistant) to do an **end-of-Phase-1 overall recheck** — I'll re-audit the methodology adherence, the repo, and the public surface against the original three docs and flag any drift.

---

## End-of-Phase-1 Overall Recheck (you trigger this)

When you say "recheck phase 1", I will:

1. Re-read all three source docs (`01-Methodology.md`, `02-Roadmap.md`, `phase1.md`).
2. Walk the repo: rating engine, schema, indexer, web pages.
3. Confirm methodology adherence on the 9 tiers, PD formula, LGD segmentation, EAD funded-only, confidence cutoffs, v1 simplifications correctly labelled.
4. Confirm Phase 1 Outcomes from Roadmap §"Phase 1 — Foundation": live service URL, Arc + Base coverage, v1 engine producing ratings, methodology paper published, 6+ posts (you confirm), Architect Tier 1 progress (you confirm).
5. List anything that drifted, mis-shipped, or got deferred — and what carries into Phase 2 backlog.
6. Suggest the Phase 2 day-1 prompt shape based on Roadmap §"Phase 2".

---

## How to Use Each Day's Prompt

1. Open a fresh Claude Code session in `/home/huicom/arc-agents-explorer/`.
2. Paste the "Global LLM Coding Conventions" block first.
3. Paste the day's Part A prompt.
4. When the agent reports "done", verify each `[ ]` acceptance criterion yourself with one quick spot-check (don't re-run everything — trust the agent's verification commands but spot-check the headline output).
5. Then do your Part B human tasks.
6. End-of-day: note effort hours, sleep, energy in your daily journal for Monday's audit.

---

_Phase 1 daily plan v1 · Drafted Tuesday May 19, 2026 Bangkok · Companion to phase1.md_
