# Lepton — On-chain Deployments (Arc Testnet, chain 5042002)

> Testnet only (Guardrail 6). This build is **additive** — no redeploys of the
> existing v2.0.1 contracts (Guardrail 1).

## Pre-existing (do not touch)

| Contract | Address |
|---|---|
| RatingVerifier | `0xE3b1e82f1A047BC5B41d8982EaC635EC61526EE8` |
| RatingGateway | `0x003234AAd031242052d7e580d337386f1B261b78` |
| CaliberEscrow | `0xc76bb990E498ACace1ff6A83ea4CCDDa92485365` |
| AgenticCommerce (ERC-8183) | `0x0747EEf0706327138c69792bF28Cd525089e4583` |
| USDC | `0x3600000000000000000000000000000000000000` |

## New for Lepton

| Contract | Address | Deployed | Notes |
|---|---|---|---|
| BrokerBond | `0x9B8b1361B2e7D77c910195DFb9a67AF1Faf16f7F` | ✅ deployed 2026-06-11 (owner = broker EOA `0x5192…`) | Phase 2 B1. Holds the broker's USDC bond per match; permissionless release/slash keyed on ERC-8183 job state. 18 Foundry tests green. **Staged slash verified on-chain**: bond #1 posted ($0.05) → job 115804 rejected → slashed to requester (tx `0x29728edf…`). |
| ~~BrokerBond v0~~ | ~~`0x3fBdF01c87A0672aFCd948D82DD9d9CeA4E00373`~~ | orphaned | First deploy used a flat-tuple `getJob` ABI that misdecodes the real struct-returning AgenticCommerce; superseded by the address above. Do not use. |
| EvidenceRegistry | `0xD6A8184372EbcDcBe479513187Fdc6E7E50C4A1D` | ✅ deployed 2026-06-14 (owner = deployer `0x8164…`, signer = rating signer `0xbF01…`) | Steward Phase 2 WS-2. EIP-712 verifier + event emitter; **custodies no funds**. `attest(att, sig)` is permissionless (the rating signer's sig is the auth); records `EvidenceAttested(agentId, paymentId, …, attestationHash)`. Per-agent monotonic nonce (`lastNonce[agentId]`). methodologyVersion = `bytes32("2.0.1")`. 15 Foundry tests green. Off-chain↔on-chain digest parity verified: steward-core `evidenceAttestationHash` == on-chain `hashAttestation` (`0x50de73ec…`). |

## Deploy command (after B1 is written + tested)

```bash
# From contracts/ — adapt the existing Deploy script pattern.
forge script script/DeployBrokerBond.s.sol --rpc-url "$ARC_RPC_URL" --broadcast
# Record the printed address above and in .env (BROKERBOND_ADDRESS).
```
