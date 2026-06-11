# Caliber × Lepton — Build Notes

Working notes for the Lepton Agents Hackathon (Canteen × Circle on Arc).
The authoritative execution spec lives in the vault:
`~/obsidian-vault/01 - Projects/15 - Caliber/docs/lepton-implementation-plan.md`.

## What we're shipping

Two stacked products, two submissions of the same repo:

1. **Caliber Metered** — the Caliber attestation API behind an x402 paywall
   (sub-cent USDC per rating query via Circle Gateway Nanopayments), plus
   **HireBot**, a budget-constrained demo agent that autonomously decides when
   paying for a trust check is worth it.
2. **The Bonded Broker** — an autonomous matchmaker that pays Caliber Metered
   per attestation, picks a provider, charges a fee, and posts a USDC bond
   sized by the provider's Caliber tier. Bond slashes to the requester if the
   ERC-8183 job resolves rejected/expired.

The broker is a *consumer* of Caliber, not part of the rating layer
(neutrality — Guardrail 3).

## State (kept current as we build)

- **Rail:** seller-side x402 is live in prod (`rating/src/x402.ts` gating
  `POST /v1/agents/:chain/:id/attest`). Price `X402_PRICE_USDC=$0.001` (D2).
- **Buyer client:** `packages/x402-client` — thin wrapper over
  `@circle-fin/x402-batching` `GatewayClient`. Shared by HireBot, broker, try-it.
- **Ledger:** `metered_payments` table + `packages/db/src/known-wallets.ts`
  payer-class allowlist (honest traction, Guardrail 4).
- **Feature flag:** new public pages behind `NEXT_PUBLIC_LEPTON=1` (Guardrail 7).

## Milestones (progress is by milestone, not date)

| Milestone | Gate | Status |
|---|---|---|
| M0 — rail verified | Phase 0 acceptance all green | ✅ 2026-06-11 — paid attestation settled live (agent 1446, ref 628a675e…) |
| M1 — Caliber Metered live | Phase 1 done, v1 submitted | 🟡 code-complete + locally verified — needs deploy + submit |
| M2 — Bonded Broker live | Phase 2 done, resubmitted | not started |
| M3 — final submission | Phase 3 done, final form in | not started |

Only fixed date: event close **Jun 29, 13:00 GMT+7**.

## Deploying Phase 1 (M1)

Nothing below has been deployed yet — the live site is unchanged (new pages stay
404 until `NEXT_PUBLIC_LEPTON` is built in, per Guardrail 7). Run in a window:

1. **DB** — already migrated locally: `metered_payments`, `metered_refund_queue`,
   `hirebot_decisions` exist. On any other host: `pnpm db:migrate` with the root
   `DATABASE_URL` (see [[drizzle_migration_gotchas]]).
2. **Rating service (A1)** — runs via tsx, no build: `sudo systemctl restart arc-rating`.
   Picks up the instrumented `x402.ts` + the `payment` block. Env already has
   `LEPTON_DEMO_WALLETS` (incl. funder) so the ledger classifies correctly.
3. **Web (A3/A4 dashboards + jobs sort fix + flag)** — `NEXT_PUBLIC_LEPTON=1` is in
   `web/.env`, so `deploy.sh`'s `pnpm --filter web build` inlines it. Run
   `deploy.sh` (or `pnpm build:web && sudo systemctl restart arc-web`). This also
   installs + enables `caliber-hirebot.timer` (every 10 min).
4. **HireBot** — funded EOA `0xCef4…6e33` has 20 USDC in Gateway. The timer runs it;
   manual pass: `pnpm --filter @caliber/hirebot run-once`.

Verified locally (against the same prod DB + Circle facilitator): 402 gating,
paid attestation + ledger row + replay reject + bypass=internal/0, `/metered`
ticker+feed+try-it (real $0.001 settle), `/labs/hirebot` decision log.

## Deploying Phase 2 (M2 — Bonded Broker)

1. **Deploy `BrokerBond.sol`** (18 Foundry tests green):
   ```bash
   cd contracts
   forge script script/DeployBrokerBond.s.sol --rpc-url "$ARC_RPC_URL" --broadcast
   ```
   Put the printed address in `.env` as `BROKERBOND_ADDRESS` (also `docs/lepton/DEPLOYMENTS.md`).
   Owner defaults to the Broker wallet (can only pause new bonds, never seize funds).
2. **Broker service** — `deploy.sh` installs + starts `caliber-broker.service` (:3200, long-running, with the keeper loop). The keeper auto-settles bonded matches once `BROKERBOND_ADDRESS` is set.
3. **Web** — the console lives at `/labs/broker`; `deploy.sh`'s web build picks it up. The `/api/broker/match` route proxies to `:3200`.
4. **`broker.poko.blue` subdomain (D5)** — Cloudflare Tunnel + DNS (your ops step):
   - Zero Trust → Networks → Tunnels → [tunnel] → Public Hostname → Add:
     `broker` . `poko.blue` → Service `HTTP` → `http://192.168.1.41:3000` (the web app).
   - `web/src/middleware.ts` already rewrites the `broker.*` host root → `/labs/broker`, so the console is the subdomain home page. Until DNS is live, use `caliber.poko.blue/labs/broker`.

Verified locally: BrokerBond unit/fuzz tests; broker `/match` makes real multi-hop attestation purchases and applies the decline rule (declined a Silver at 25bps fee; matched at a clearing fee); console renders + proxies a match; `Host: broker.poko.blue` root rewrite serves the console.

## Sibling docs

- `FRICTION_LOG.md` — Circle-tooling pain points ($500 dev-feedback prize).
- `WALLETS.md` — wallet registry (addresses only).
- `DEPLOYMENTS.md` — on-chain addresses.
