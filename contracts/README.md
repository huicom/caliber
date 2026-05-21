# ArcRating Contracts

Foundry workspace for the rating-gated marketplace contracts.

- `src/RatingVerifier.sol` — EIP-712 verifier; checks the rating attestation signed by the rating service. See methodology §11.2.
- `src/RatingGateway.sol` — wraps `agenticCommerce.createJob`; pulls USDC into the gateway during `postGatedJob`, exposes `fundJob` for the poster to call after the agent's `setBudget`. See `docs/03-marketplace/marketplace_plan.md` §13 Check 3 for why this is 3 popups, not 1.

## Build & test

```bash
cd contracts
forge build
forge test --summary
```

## Deploy to Arc Testnet

The deploy script (`script/Deploy.s.sol`) reads two environment variables:

| Variable | Used for | Notes |
|---|---|---|
| `DEPLOYER_PRIVATE_KEY` | Signs the deploy transactions | Needs ~0.05 USDC of gas on Arc Testnet. Get USDC from `https://faucet.circle.com`. |
| `SIGNER_ADDRESS` | Address embedded in `RatingVerifier` as the only trusted attestation signer | **Must equal** the address of `RATING_SIGNER_PRIVATE_KEY` used by the rating service (`rating/api/v1/agents/[chain]/[id]/attest/route.ts`). If you don't have one yet, generate via `cast wallet new` and keep the private key on the rating-service host only. |

The deploy script reads `AGENTIC_COMMERCE` and `USDC` from constants in `Deploy.s.sol` — they're already set to the Arc Testnet canonical addresses (`0x0747…4583` and `0x3600…0000`).

### One-shot deploy command

```bash
cd contracts

export DEPLOYER_PRIVATE_KEY=0x...     # deployer EOA
export SIGNER_ADDRESS=0x...           # rating-service signer

forge script script/Deploy.s.sol:DeployArcTestnet \
  --rpc-url arc \
  --broadcast \
  --verify \
  --verifier-url https://testnet.arcscan.app/api \
  --etherscan-api-key "${ARCSCAN_API_KEY:-none}"
```

If the explorer verifier rejects (`ARCSCAN_API_KEY` not set or the testnet verifier is flaky), drop `--verify` and verify manually via Arcscan's UI later — addresses still land in `broadcast/`.

### After deploy — wire the addresses

The script prints both addresses on its last two `console2.log` lines. Paste them into:

1. **`indexer/shared/chain-config.ts`** — replace the two `MISSING_SENTINEL` lines for Arc under `ratingVerifier` and `ratingGateway`.
2. **`web/src/lib/contracts/addresses.ts`** — replace the two `0x0000…` placeholders for `RATING_VERIFIER` and `RATING_GATEWAY`.
3. **Root `.env`** — set `RATING_VERIFIER_ADDRESS` so the rating service uses the correct EIP-712 `verifyingContract` when signing attestations.

Then `sudo systemctl restart arc-rating arc-web` to pick up the addresses.

## Sanity check after deploy

```bash
# Verifier is wired to the right signer + methodology version
cast call <verifier-addr> "signer()(address)" --rpc-url arc
cast call <verifier-addr> "methodologyVersion()(bytes32)" --rpc-url arc

# Gateway points at the right dependencies
cast call <gateway-addr> "verifier()(address)" --rpc-url arc
cast call <gateway-addr> "agenticCommerce()(address)" --rpc-url arc
cast call <gateway-addr> "usdc()(address)" --rpc-url arc
```

All four should return the addresses you expect. If `signer()` is `0x0000…` you forgot to set `SIGNER_ADDRESS` before deploying — redeploy.
