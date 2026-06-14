# Steward — Repo Assessment & Phase 1 Plan

> Section 10 deliverable of the Steward handover brief. Produced 2026-06-13, before feature code.
> Event: Lepton Agents Hackathon (Canteen × Circle × Arc), June 15–29 2026.
> Judging: 30% agentic sophistication · 30% in-window traction · 20% Circle tooling · 20% innovation. Judges drive the live product alone.

**Owner decisions (2026-06-13):**
- **Cannibalize the Lepton trio** (Caliber Metered + HireBot + Bonded Broker, coded June 11, mostly undeployed behind `NEXT_PUBLIC_LEPTON=1`). Steward is THE submission. Reuse the plumbing, adapt HireBot as the dogfood workload, shelve the `/lepton` `/metered` `/labs` marketing surfaces (keep code, don't feature).
- **Same repo** (github.com/huicom/caliber — already public). README repositioned to lead with Steward; Caliber reads as the rating engine inside.
- **LLM via OpenCode Zen** (OpenAI-compatible gateway; key provided by owner; enumerate `/models` at build start and pin fast + smart models in env).

---

## 1. Repo assessment (brief §5 components → reuse / adapt / build-new)

The brief's asset list was materially stale — the repo contains an undeployed June-11 Lepton build that shifts the reuse math strongly in Steward's favor.

| Steward component | What exists | Verdict |
|---|---|---|
| 1. Payment pipeline / x402 buyer | `packages/x402-client` — `CaliberPayer` wrapping Circle `@circle-fin/x402-batching/client` `GatewayClient.pay()`: full programmatic 402 flow (parse → EIP-3009 sign → retry). Currently aimed only at the Caliber attest endpoint. | **Adapt** — add `pay(url, init)` + `probe(url)` (~20 lines); wrap with `authorize()` in a new proxy service |
| 2. Policy engine | No precedent for compiled policy. Pure-rule evaluation template in `rating/engine/flags.ts` (named thresholds + details strings). | **Build-new** on the flags.ts pattern; mandate→policy compiler is LLM, build-new |
| 3. Treasurer brain (LLM) | `services/hirebot` (~270 lines) is a proto-treasurer: daily budget cap, cache TTL, free-triage-then-pay, decision log with rationale (`hirebot_decisions`). `services/broker/src/bond.ts` has `estimatePFail(score, flags)` + expected-loss decline rule. **No LLM code anywhere in the repo.** | **Adapt patterns + build-new LLM layer** |
| 4. Detectors | `rating/engine/flags.ts` is the exact structural template. No runtime payment detectors exist. | **Build-new** (flags.ts template) |
| 5. SDN screening | Nothing. | **Build-new** (small: one GET + 24h cache) |
| 6. Verification ladder (Phase 2) | EIP-712 machinery proven (`rating/src/sign-utils.ts`, `attest.ts`, `packages/sdk` `verifyAttestation()`). Bond lifecycle proven twice: `CaliberEscrow.sol` and `BrokerBond.sol` (deployed `0x9B8b1361B2e7D77c910195DFb9a67AF1Faf16f7F`, 18 green Foundry tests, live on-chain slash verified). | **Adapt** in Phase 2 (new typed structs, same ceremony) |
| 7. Evidence attestations → Caliber | Attestation signer + transition attestations + nonce management in `rating/src/`. | **Adapt** in Phase 2 |
| 8a. Web console | Next.js 15 + SSE pattern (`web/src/app/api/live/route.ts`: pg LISTEN/NOTIFY + heartbeat), recharts (`web/src/app/stats/_components/`), shadcn table, `aa-*` editorial design tokens, watchlist subscribe/dispatch-with-failure-tracking pattern, subdomain host-rewrite middleware (`broker.*` precedent). | **Reuse heavily** — new pages from existing blocks |
| 8b. Telegram | Nothing (no grammy/telegraf). Discord dispatch in `rating/scripts/snapshot-daily.ts` is the structural reference. | **Build-new** (thin, grammY long-polling) |
| 9. Red-team fixture | `rating/src/x402.ts` `meteredGate(opts)` — generalized seller middleware with **per-route price AND recipient** → overcharge and redirect modes are real, not simulated. | **Adapt** |
| 10. Demo workload | HireBot + its 10-min systemd timer + funded-wallet path. | **Adapt** — route its payments through Steward |
| 11. Wrapper SDK | `@caliber/sdk` is the thin-client precedent (viem-only peer dep). | **Build-new thin client** (`packages/steward-client`, ~60 lines) |
| Ledger / counters | `metered_payments` + `payer_class` external/demo/internal honest-traction classifier (`packages/db/src/known-wallets.ts`) + `/api/lepton/metrics` aggregation. | **Adapt** for Steward ledger + public counters |
| Infra | systemd service+timer patterns, `deploy/deploy.sh`, nginx, Cloudflare tunnel subdomains, feature flags, pg backups. `pnpm-workspace.yaml` already globs `services/*` + `packages/*`. | **Reuse as-is** |

## 2. Gap analysis, surprises, risks

**Surprises vs the brief:**
- The Lepton build exists and is far ahead of the brief's asset list — programmatic x402 buyer, budget-aware decision-logging agent, deployed bond contract, payments ledger with honest-traction split. Resolved: cannibalize.
- Stack is **TypeScript** (Express + Next.js 15 + Drizzle/Postgres + systemd), not FastAPI/Python. The brief's own "boring stack already in the repo" rule resolves this: all-TS.
- No Telegram, no LLM, no SDN code anywhere — genuinely build-new.
- Brief's numbers stale (~654 rated / ~28k jobs → ~900 rated under v2.0.1; 24.2k agents, 56.7k jobs, 27.9k completed as of 2026-05-28). Use live `/api/stats` in submission copy.

**Gaps (all of Phase 1's new code):** proxy service + `authorize()` pipeline, compiled-policy schema + evaluator, LLM client + mandate compiler + treasurer + incident narrator, 5 detectors + route-pause state + counterparty registry, SDN client, Telegram bot, console pages, red-team fixture, ~8 new DB tables.

**Design risk (highest):** `GatewayClient.pay()` is atomic (request→parse→sign→retry), so pre-payment inspection uses **probe-then-pay**: bare `fetch` → parse the 402 (`payTo`, amount) → run `authorize()` → only then `gateway.pay()`. TOCTOU window: a seller could answer the probe honestly and rogue on the paid retry. Phase 1 mitigation: post-settle verification (settled amount/recipient vs authorized → `settle_mismatch` incident + auto route-pause). Day-0 spike: read the SDK source for a pre-sign hook; if one exists, enforce pre-sign and drop the caveat.

**Other build-start risks:** Chainalysis key signup latency (fallback: daily-snapshotted local SDN list, labeled honestly); OpenCode Zen fast-model JSON reliability + latency (<~3s p95 — hot path of every payment); dogfood Gateway-balance burn vs testnet faucet limits over ~10 days; HireBot job supply (fixture's honest routes carry cadence if thin — recorded demo/internal, never inflating external counters); `meteredGate` imports `@arc-agents/db` (fixture shares the DB or strips the ledger hook).

## 3. Architecture (chosen)

**`authorize()` lives in a proxy service** — `services/steward` (Express, :3300). Agents POST a payment intent; Steward probes, authorizes, signs, pays, and ledgers. A zero-Circle-dep thin client (`packages/steward-client`) keeps integration at ~3 lines: `createSteward({baseUrl, apiKey}).pay(url, init)`.

Why proxy, not library: pre-sign inspection requires owning the 402 round-trip; freeze is one Postgres flag read by one process (instant, unbypassable); detector state (trailing medians, loop counters) is shared by construction; the Phase 2 SDK seam stays HTTP. Product-true: Steward holds the checkbook — the agent requests, the CFO signs.

**New workspaces:**
- `packages/steward-core` — pure logic: compiled-policy zod schema, detector functions, LLM client, SDN client
- `services/steward` — pipeline + embedded grammY long-poll bot + admin freeze/approvals
- `packages/steward-client` — the 3-line wrapper
- `services/redteam` — malicious x402 seller (:3400), modes `honest | overcharge | redirect | garbage | loopbait` via `/admin/mode`
- `web/src/app/steward/*` + `web/src/app/api/steward/*` — console + SSE on `steward_events`
- `deploy/steward.service`, `deploy/steward-redteam.service`

**Modified:** `packages/x402-client` (add `pay`/`probe`), `packages/db/src/schema.ts`, `services/hirebot` (pay through steward-client), `web/src/middleware.ts` + `deploy/cloudflared-config.yml` (`steward.poko.blue`), `deploy/deploy.sh`, root `README.md`.

**New tables (drizzle):** `steward_mandates` (raw text + compiled policy jsonb, versioned) · `steward_payments` (the ledger: decision allow/hold/deny, decision_stage, reasoning, detector_hits jsonb, sdn_source/checked_at/result, payment_ref, settle_status incl. `mismatch`) · `steward_incidents` (kind/severity/evidence/LLM narrative) · `steward_approvals` (pending Telegram approvals + expiry) · `steward_routes` (pause state) · `steward_counterparties` (registered payTo, trailing price-median cache, SDN cache) · `steward_state` (`frozen` flag) · `steward_integrations` (API keys → "teams integrated" counter). Every pipeline write also fires `pg_notify('steward_events', …)` for the live ledger.

**`authorize()` order** — invariant: **steps 1–5 are deterministic; the LLM adds judgment and prose, never permission.**
1. Freeze check → deny.
2. Route pause → hold.
3. Policy caps: per-tx / daily / per-counterparty / category allowlist / min Caliber rating (free read, surfaced only as "provider rated low — routed away") / approval threshold → deny/hold.
4. Detectors: redirect (probe `payTo` ≠ registered) → deny + incident; new counterparty → hold or sandbox-cap; runaway loop (≥N to same host+path in M min) → hold + auto-pause route; price spike (>3× trailing median) → hold + incident.
5. SDN screen: Chainalysis exact-match, 24h cache; hit → deny + incident; **API error → hold (fail-closed)**; labeled "OFAC SDN check", list source + timestamp logged per decision.
6. LLM treasurer (fast model): worth-it, cache-vs-rebuy, provider selection — **can only downgrade** allow→hold/deny; writes the one-line reasoning on every allow. LLM down → hold (fail-closed; off-by-default env autopilot escape below a policy cap).
7. Approval gate: holds + above-threshold → `steward_approvals` row + Telegram push (approve/deny/freeze inline buttons, deep link to the web incident); API returns `202 {status:'hold', approvalId}`.
8. Execute + post-checks: `gateway.pay()` → post-settle verification (mismatch → incident + route pause) + Tier-0 delivery conformance (schema/deadline/size/error-semantics/hash) → incident. Narratives written async by the smart model — never blocking.

**LLM client:** plain fetch, OpenAI-compatible. Env: `OPENCODE_BASE_URL`, `OPENCODE_API_KEY`, `STEWARD_MODEL_FAST`, `STEWARD_MODEL_SMART`. JSON-prompted + zod-validated + one retry + hard timeout (~4s fast / ~20s smart).

## 4. Phase 1 backlog (ordered; S ≤2h · M ≈ half-day · L ≈ 1–2 days)

**Exit gate:** a rogue payment blocked end-to-end on the live URL, freeze works, submission #1 filed.

**Day 0 (June 15) — external dependencies, all S, parallel:**
1. Chainalysis free API key signup.
2. BotFather: create bot, get token + owner chat_id.
3. `GET {OPENCODE_BASE_URL}/models` → pin fast/smart models.
4. Fund dogfood Gateway balance + create attacker wallet for fixture redirect mode.
5. Spike `@circle-fin/x402-batching/client` source: probe-then-pay viability / pre-sign hook (gates task 7).

**Spine (live by ~June 18):**

6. Drizzle migration: all steward tables. [M]
7. Generalize x402-client: `pay(url, init)` + `probe(url)`. [M, dep 5]
8. `services/steward` skeleton: `POST /v1/pay` = probe → freeze check → env per-tx cap → pay → ledger row + notify. [M, dep 6,7]
9. `services/redteam`: honest + redirect + overcharge modes via `meteredGate`. [M, dep 7]
10. Redirect detector + counterparty registry. [S, dep 8,9]
11. Console v0: `/steward/ledger` SSE + freeze button + freeze enforcement. [M, dep 8]
12. Deploy spine: systemd units, cloudflared `steward.poko.blue`, middleware rewrite. [M] → **exit-gate behavior demonstrable on the live URL by day 4.**

**Widen (June 19–24):**

13. Compiled-policy schema + deterministic evaluator. [M]
14. LLM client + mandate compiler + `/steward/mandate` editor. [M, dep 3,13]
15. Treasurer decision + reasoning line on every payment + fail-closed wiring. [M, dep 14]
16. Remaining detectors: price spike (trailing median), runaway loop + route pause, new-counterparty hold/sandbox. [L, dep 13]
17. Tier-0 conformance post-checks + post-settle verification. [M, dep 16]
18. SDN screening + counterparty cache + honest labels. [S, dep 1,10]
19. Incidents: rows from detector hits, async LLM narratives, `/steward/incidents/[id]`. [M, dep 16]
20. Telegram bot (grammY long-poll): approval pushes, approve/deny/freeze callbacks, deep links, expiry. [M, dep 19]
21. **HireBot through Steward** (swap payer for steward-client; add low-rate fixture-honest routes) — pull forward right after task 12 if possible; continuous dogfood traction starts. [M, dep 8]
22. Traction counters API + public counters on console. [S, dep 21]
23. Console polish: overview, statement page, incident list, `aa-*` tokens, recharts spend chart. [L, dep 19]

**Ship (June 25–29; ~2 days buffer):**

24. README repositioning: Steward-first, quickstart = 3-line client. [S]
25. Red-team demo runbook + `scripts/redteam-demo.ts` flipping fixture modes in sequence (overcharge→hold; redirect→block+incident; loopbait→auto-pause; garbage→conformance incident; SDN test address→deny), rehearsed on the live URL. Doubles as a "try an attack" console page if time allows. [M, dep 16–20]
26. Demo video (<3 min) against the live URL using 25. [M]
27. Submission #1 checklist: live URL judge-driveable cold · repo README · video · Circle-usage writeup (Gateway buyer+seller, x402 batching, Arc Testnet) · honest traction snapshot · freeze verified from both Telegram and web. [S]

**First scope cuts if needed:** statement page (fold into ledger) → new-counterparty sandbox mode (hold-only instead) → `steward_integrations` API keys (hardcode source labels).

## 5. Conflicts with the brief (flag + resolution)

| Brief says | Repo reality | Resolution |
|---|---|---|
| "FastAPI/Postgres service patterns" | TypeScript monorepo: Express, Next.js 15, Drizzle | All-TS, per the brief's own "boring stack already in the repo" rule. Decided. |
| Asset list: "an x402 buyer client" (singular, tentative) | Full Lepton build: buyer client, proto-treasurer, deployed bond contract, ledger + honest-traction metrics | Cannibalize (owner-confirmed). Lepton surfaces shelved, not deleted; `BrokerBond.sol` stays as Phase-2/3 evidence. |
| "Telegram bot patterns may exist in other repos" | None in this repo | Build-new (grammY long-poll — no inbound webhook URL needed). |
| ~654 rated agents, ~28k settled jobs | ~900 rated (v2.0.1); 56.7k jobs / 27.9k completed | Use live `/api/stats` numbers in all submission copy. |
| Pre-payment inspection before signing (implied trivial) | Circle `GatewayClient.pay()` is atomic | Probe-then-pay + post-settle verification (TOCTOU mitigation); day-0 spike for a pre-sign hook. Material design note, not a deviation. |
| LLM unspecified | No LLM in repo | OpenCode Zen gateway (owner-confirmed); model roles env-pinned after the day-0 `/models` check. |

## 6. Verification

- **Spine (task 12 exit):** from a clean shell, `POST steward.poko.blue/v1/pay` against the fixture in `redirect` mode → `deny`, ledger row `decision_stage='detector'`, incident on `/steward/incidents`, Telegram push received; toggle freeze in console → subsequent pay denies instantly.
- **Detector demos:** `scripts/redteam-demo.ts` end-to-end on the live URL — each of the 5 modes produces its expected verdict + incident + console artifact.
- **Fail-closed:** remove the LLM key → payments hold (never allow); break the Chainalysis key → holds with honest reason.
- **Dogfood:** hirebot timer running; `steward_payments` accruing reasoned rows; counters split external/demo/internal truthfully.
- **Static:** `pnpm typecheck`, `pnpm build:web`.
