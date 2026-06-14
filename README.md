# Steward

> **Steward stops your agent from draining its wallet.**
> A treasurer + risk officer that stands between an autonomous agent and every
> USDC charge it tries to make on Arc.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Built on Arc](https://img.shields.io/badge/built%20on-Arc%20Testnet-orange.svg)](https://arc.network)
[![USDC native](https://img.shields.io/badge/settlement-USDC-blue.svg)](https://circle.com)
[![Circle Gateway](https://img.shields.io/badge/x402-Circle%20Gateway-7849F2.svg)](https://developers.circle.com)

**[🌐 steward.poko.blue](https://steward.poko.blue)** (console) · **[📡 steward-api.poko.blue](https://steward-api.poko.blue)** (API) — *live during the event window*

---

Your agent has a wallet and a job. It discovers a service, gets a `402 Payment
Required`, signs, and pays — over and over, autonomously. One overpriced quote, one
swapped recipient address, one retry loop, and the wallet is empty before you wake
up. **Steward holds the checkbook.** The agent asks Steward to pay; Steward inspects
the seller's x402 quote against your mandate, runs a stack of risk detectors,
screens the recipient, and only *then* signs and settles — or holds it for your
approval, or refuses outright. Every decision is one row in a ledger you can watch
live, and one switch freezes the whole treasury.

## The 3-line integration

Your agent never holds a key or signs a payment. It asks Steward to.

```ts
import { createSteward } from '@caliber/steward-client';

const steward = createSteward({ baseUrl: 'https://steward-api.poko.blue', apiKey: process.env.STEWARD_API_KEY! });

const res = await steward.pay('https://seller.example/api/research', { method: 'POST' });
// res.decision === 'allow' → paid; res.txRef is the settlement ref.
// A refused payment throws StewardRefusal { decision, stage, reasoning } — nothing was signed.
```

That's the whole surface. Steward owns the 402 round-trip, so it inspects the quote
*before* anything is signed. (`packages/steward-client` — zero runtime deps, just `fetch`.)

## What it catches

Each row is a real detector or policy in the `authorize()` pipeline, with the
red-team fixture mode that triggers it live (`pnpm demo:redteam`, see
[the runbook](docs/steward/DEMO_RUNBOOK.md)).

| Guard | What it stops | Live demo trigger | Verdict |
|---|---|---|---|
| **Freeze** | Everything, instantly — the kill switch | freeze toggle in the console | `423` deny @ `frozen` |
| **Mandate caps** | Per-tx / daily / per-counterparty overspend | `overcharge` (10× price) | deny @ `policy` |
| **Redirect detector** | Seller swaps `payTo` to a wallet you've never paid | `redirect` (attacker recipient) | deny @ `detector` + incident |
| **Runaway-loop detector** | A "retry now" response draining the wallet in a tight loop | `loopbait` (rapid fire) | hold + **route paused** |
| **Price-spike detector** | A quote far above the trailing median for that seller | (price history) | hold @ `detector` + incident |
| **Trust-on-first-use** | First payment to a brand-new counterparty | new seller | hold for approval |
| **Tier-0 conformance** | Seller takes the money, delivers junk | `garbage` (malformed body) | allow, but conformance incident |

A hold lands in an **approvals queue** — approve it from the console and the exact
held request re-executes; deny it and nothing moves. Provider scoring (see *the
rating engine* below) feeds the mandate's minimum-quality rule, surfaced as plain
UX: *"provider rated low — routed away."*

**Shipping during the event window:** an LLM treasurer that writes a plain-English
rationale on every payment (and can only *downgrade* a decision, never grant one), a
plain-English **mandate compiler** (write your spending rules in a sentence), **OFAC
SDN exact-match screening** of recipients (exact-match, fail-closed — a screening
check, not a compliance claim), and a **Telegram** approve / deny / freeze bot.

## How it works

```
                          ┌──────────── Steward authorize() ────────────┐
  agent ── pay(url) ──▶   │  freeze → route-pause → runaway-loop →       │
  (@caliber/steward-      │  mandate caps → redirect → price-spike →     │
   client, no keys)       │  trust-on-first-use → SDN screen* → treasurer*│
                          └──────────────────┬──────────────────────────┘
                                             │  allow
                                             ▼
                          sign EIP-3009 + settle via Circle Gateway x402
                          (batched nanopayments · USDC · Arc Testnet)
                                             │
                          ┌──────────────────┼───────────────────┐
                          ▼                  ▼                   ▼
                    ledger (SSE)        incidents          approvals
                    /steward/ledger   /steward/incidents   (web · Telegram*)
```

The deterministic stages (freeze through trust-on-first-use + conformance) are
live; the `*` stages — SDN screen, LLM treasurer, Telegram — ship during the event
window. A refusal short-circuits before any signature, so nothing is paid; the LLM
treasurer can only *downgrade* an allow, never grant one.

## Circle tooling

- **Circle Gateway x402** — the batched-settlement SDK on **both sides**: Steward
  is the buyer (`gateway.pay()` → EIP-3009 signature → half-cent nanopayment queued
  in the seller batch); the red-team fixture is the seller (`createGatewayMiddleware`
  emitting the 402 and settling).
- **USDC on Arc Testnet** — the settlement currency end to end (quotes, payments, the ledger).
- **Circle Wallets** — the funded dogfood path (Programmable + Modular Wallets) for
  the agent that pays through Steward.

## Monorepo map

pnpm workspaces (`pnpm-workspace.yaml`: `services/*`, `packages/*`, `indexer/*`, `rating`, `web`).

| Path | Package | Role |
|---|---|---|
| `services/steward/` | `@caliber/steward` | The CFO proxy (`:3300`): `authorize()` pipeline, holds + approvals, ledger + SSE, freeze |
| `services/redteam/` | `@caliber/redteam` | Malicious x402 seller fixture (`:3400`): 5 attack modes via `/admin/mode` |
| `packages/steward-client/` | `@caliber/steward-client` | The 3-line wrapper — zero deps |
| `packages/steward-core/` | `@caliber/steward-core` | Pure logic: compiled-policy schema, detectors, conformance, SDN/LLM clients |
| `packages/x402-client/` | `@caliber/x402-client` | Programmatic x402 buyer over the Circle Gateway batching SDK |
| `web/` | `web` (Next.js 15) | Console at `/steward`, `/steward/ledger` (live SSE + freeze), `/steward/incidents` |
| `packages/db/` | `@arc-agents/db` | Drizzle schema + migrations (`steward_payments`, `steward_incidents`, `steward_approvals`, …) |
| `rating/`, `indexer/`, `contracts/` | `@arc-agents/*` | **The rating engine that powers provider scoring inside Steward** — see below |

`scripts/redteam-demo.ts` (`pnpm demo:redteam`) drives the full attack sequence
against a running pair and prints a narrated transcript. Runbook:
[`docs/steward/DEMO_RUNBOOK.md`](docs/steward/DEMO_RUNBOOK.md).

## Honest numbers

The console counters split traffic by `source`: **demo** (the red-team script and
dogfood runs) and **external** (real integrators). They are reported separately and
**never conflated** — every counter traces to a row in `steward_payments` you can
query yourself.

## Run it locally

```bash
pnpm install
docker run -d --name arc-pg -p 5432:5432 -e POSTGRES_PASSWORD=arcdev -e POSTGRES_DB=arc_agents pgvector/pgvector:pg16
pnpm db:migrate

# two terminals:
cd services/steward && pnpm start     # :3300 — the CFO proxy
cd services/redteam && pnpm start     # :3400 — the attack fixture

pnpm demo:redteam                     # drive the full attack demo (narrated transcript)
pnpm dev:web                          # console on :3000  → /steward/ledger
```

Required env (copy `.env.example` → `.env`): `DATABASE_URL`, `STEWARD_API_KEY`,
`STEWARD_PRIVATE_KEY` (funded Arc Testnet buyer wallet), `REDTEAM_SELLER_ADDRESS`,
`REDTEAM_ATTACKER_ADDRESS`, `REDTEAM_ADMIN_TOKEN`, plus the Arc RPC + contract vars.

## The rating engine (Caliber)

The provider scoring Steward routes against is **Caliber** — a counterparty
performance rating for ERC-8004 agents on Arc, methodology published openly and
live at **[caliber.poko.blue](https://caliber.poko.blue)** ([API](https://caliber-api.poko.blue) ·
[methodology v2.0.1](https://caliber.poko.blue/methodology)). It indexes Arc
Testnet, rates agents (tier + score + confidence + risk flags) with a versioned,
signed methodology, and exposes EIP-712 attestations any contract can verify. Inside
Steward it's an internal signal: a low rating means *routed away*, surfaced as UX, not
infrastructure jargon. The engine (`rating/`), indexer (`indexer/`), on-chain verifier
(`contracts/`), and public site (`web/`) are the same codebase; the methodology paper
lives at [`docs/02-riskmodel/01-Methodology.md`](docs/02-riskmodel/01-Methodology.md).

## License

Code is [MIT](./LICENSE). The Caliber methodology paper is
[CC BY 4.0](./LICENSE-METHODOLOGY). Bug reports / PRs / questions: GitHub issues or
DM [@PokoBlue99](https://x.com/PokoBlue99).

## Built by

Solo from Bangkok 🇹🇭 by [PokoBlue](https://x.com/PokoBlue99), for the **Lepton Agents
Hackathon** (Canteen × Circle × Arc, June 2026).
