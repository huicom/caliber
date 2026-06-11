# Lepton — Wallet Registry

> **Addresses only. NEVER commit private keys.** Keys live in the repo-root
> `.env` (gitignored) as `HIREBOT_PRIVATE_KEY` / `BROKER_PRIVATE_KEY`, etc.
>
> `payer_class` drives honest-traction accounting (Guardrail 4). Every wallet
> we control is `demo` or `internal`; everything else is `external`. Keep this
> table in sync with `packages/db/src/known-wallets.ts` — that module is the
> machine-readable source the ledger classifies against.

| Role | Address | Funded | payer_class | Notes |
|---|---|---|---|---|
| Caliber Seller (x402 revenue) | `0x49f9…` (set as `X402_SELLER_ADDRESS`) | yes | internal | Receives Gateway Balance from settled attestations. Pre-existing (Circle grant). |
| Test Funder | derived from `TEST_FUNDER_PRIVATE_KEY` | yes | internal | Drips test USDC to judge demo wallets. Pre-existing. |
| Try-it demo wallet | via `CIRCLE_DEMO_WALLET_SET_ID` | yes | demo | The `/metered` "Try it" button pays from here through the real x402 path. |
| **HireBot buyer (EOA)** | `0xCef42B2EA67cb702843583a568098Ee686216e33` | _pending_ | demo | **Active** budget-aware paying agent (Phase 1 A4). `HIREBOT_PRIVATE_KEY`. Fund by moving the 40 USDC from the Circle wallet below (or `depositFor` from the test funder). |
| **Broker buyer (EOA)** | `0x5192E427183dF26Aa68652771Be91fe771C97e83` | _pending_ | demo | **Active** Bonded Broker agent (Phase 2). `BROKER_PRIVATE_KEY`. |
| HireBot funding (Circle 2/5) | `0xf45863a4fbe812993ed96a068cff5fd6bfe41354` | 40 USDC | demo | Parked. Circle developer-controlled wallet (no exportable key). Transfer its USDC to the HireBot EOA above via Circle console/API. |
| Broker funding (Circle 3/5) | `0x82855ead1d741261e394ee4fbcd8b5592d99774b` | 40 USDC | demo | Parked. Transfer its USDC to the Broker EOA above. |

## Signing the agent wallets (key situation — read this)

HireBot and Broker are Circle **developer-controlled** wallets. Circle never
exposes their raw private keys (that's the security model — they're controlled
via the Circle API using `CIRCLE_API_KEY` + `CIRCLE_ENTITY_SECRET`, referencing
the wallet ID). The current buyer client (`packages/x402-client`) wraps Circle's
`GatewayClient`, which is **private-key based** — so it cannot drive these two
wallets directly. Two ways to resolve this:

- **EOA buyers (fast path).** Generate two plain EOA keypairs, set
  `HIREBOT_PRIVATE_KEY` / `BROKER_PRIVATE_KEY`, and move the 40 USDC over (Circle
  console/API transfer out of each developer-controlled wallet, or top up from
  the test funder). Works today with the client as built. The 20% Circle-tools
  criterion is still met via Gateway Nanopayments + USDC settlement (+ the
  existing browser Circle PW flow on `/jobs/new`).
- **Circle-API signer (Circle-native path).** Build a `BatchEvmSigner` backed by
  Circle's developer-controlled sign-typed-data endpoint, and route the
  Gateway deposit/approve through Circle's contract-execution API. Keeps these
  exact wallets as the agents (stronger Circle-tools narrative) but requires
  partly reimplementing `GatewayClient` — meaningful extra build.

**Decision (2026-06-11): EOA buyers.** Two fresh testnet EOAs were generated for
HireBot/Broker (`HIREBOT_PRIVATE_KEY` / `BROKER_PRIVATE_KEY` in `.env`, addresses
in the table). The Circle developer-controlled wallets are kept as funding
sources only. Circle-tools criterion is still met via Gateway Nanopayments + USDC
settlement (+ the browser Circle PW flow on `/jobs/new`).

**Rail verified (M0) 2026-06-11.** A real $0.001 USDC nanopayment settled against
the live `caliber-api.poko.blue` attest endpoint and returned a signed v2.0.1
attestation (agent 1446 · Silver · score 77 · settle ref `628a675e…`), using the
`TEST_FUNDER` EOA as buyer (it already had 5 USDC deposited into Gateway).

```bash
# Reproduce the smoke test (funder buyer, already Gateway-funded):
cd packages/x402-client
CALIBER_PAYER_PRIVATE_KEY="$(grep -E '^TEST_FUNDER_PRIVATE_KEY=' ../../.env | cut -d= -f2-)" \
  pnpm smoke -- --agent 1446

# Once the HireBot/Broker EOAs are funded into Gateway, they pay as themselves:
pnpm --filter @caliber/x402-client deposit  -- --amount 5     # uses HIREBOT_PRIVATE_KEY
pnpm --filter @caliber/x402-client smoke    -- --agent 1446
```
