---
title: "Caliber: Methodology and Service Overview"
description: "Operational summary of the Caliber performance-risk rating service for ERC-8004 agents on Arc Testnet. Companion to the full methodology paper."
slug: methodology-and-service
methodology_version: 1.0.0
updated: 2026-05-22
---

# Caliber: Methodology and Service Overview

*Performance-risk rating for ERC-8004 agents on Arc Testnet. Operational companion to the formal methodology paper at [caliber.poko.blue/methodology](https://caliber.poko.blue/methodology). Live operating numbers as of 2026-05-22.*

## 1. Abstract

Caliber is a performance-risk rating system for autonomous software agents transacting under the ERC-8004 identity standard and the ERC-8183 escrow standard on Arc Testnet (chain id 5042002). The service produces nine-tier ratings (Caliber-AAA through Caliber-D), publishes the underlying probability of performance default (PPD), loss severity (LGD), funded exposure (EAD), and expected loss (EL), and exposes those values both through a public HTTP API and through an on-chain attestation verifiable by any Solidity contract.

The risk being measured is not credit default — agents do not borrow money. The risk is *performance default*: failure to deliver a contracted job under pre-funded escrow. The methodology adopts the structural vocabulary of credit-risk modeling (`EL = PD × LGD × EAD`) because the expected-loss formula generalizes cleanly to performance-bond settings, but does not claim Basel or NRSRO equivalence. The framing throughout this document is closer to surety underwriting than to issuer credit ratings.

Methodology version 1.0.0 was published 2026-05-20 and is current. The service operates on Arc Testnet only. Mainnet is out of scope until backtesting under §7 reaches the acceptance thresholds in §7.1 of the paper.

## 2. The risk problem

On-chain agent commerce introduces a counterparty-risk problem that existing frameworks do not directly address.

**Why this is not credit risk.** In a credit-risk model, the counterparty borrows capital and the default event is missed repayment. The expected-loss formula `EL = PD × LGD × EAD` measures the lender's loss from that event. ERC-8183 escrow inverts the cash flow: the *client* pre-funds the contract, and the *agent* receives payment only on validated delivery. The agent never borrowed. Insolvency in the traditional lending sense is structurally impossible.

**Why this is not pure reputation risk.** Reputation-style scoring (recent positive feedback, validator counts, peer ratings) is necessary but not sufficient for the underwriting question. A reputation score does not tell a counterparty *how much money is at stake* when the agent fails, *how often* the failure occurs per resolved job, or *how much of the funded escrow is recoverable* when it does. Those are the quantities a counterparty actually needs to price risk.

**The right framing is performance-bond underwriting.** The decision facing every job poster — and every contract that holds funds on a client's behalf — is structurally the same one a surety underwriter faces when issuing a performance bond on a construction contract. The principal (the agent) promises to deliver an obligation (the deliverable); the obligee (the client) needs confidence that the promise will be kept; the question is the probability of failure-to-deliver and the loss severity when failure occurs. Caliber adopts this framing throughout. Where formula notation uses `PD`, `LGD`, or `EAD`, those quantities should be read as **Probability of Performance Default**, **Loss Given Performance Failure**, and **Funded Exposure at Default**, respectively. Full definitions are in methodology §1.3.

**Why pre-funded escrow does not eliminate the risk.** The funded portion of an ERC-8183 escrow is ring-fenced before the agent acts, so the client has no exposure to agent insolvency in a lending sense. What remains is operational performance risk — the probability that the agent does not perform the work for which the escrow was funded. The funds may be partially recovered through cancellation, validator-mediated release, or dispute resolution, but the gap between funded and delivered value is the loss. Caliber measures that gap.

## 3. System architecture

Caliber is operated as five loosely-coupled components, each with its own responsibility and failure mode.

**3.1 Data ingestion.** A self-hosted Arc Network full node is the source of truth for all on-chain data. A separate indexer process (`indexer/arc/` in the repository) decodes every ERC-8004 IdentityRegistry, ReputationRegistry, and ValidationRegistry event, and every ERC-8183 AgenticCommerce job-lifecycle event, into a Postgres schema (`packages/db/src/schema.ts`). The indexer maintains a checkpointed catch-up loop for backfill and a WebSocket live subscription for new blocks. The shared backfill core in `indexer/shared/` handles rate-limit retry with exponential backoff, gap detection, and resumable state.

A third-party RPC provider is integrated as a redundant cross-check on specific endpoints. Per the resilience principle in methodology §8.3, *no rating depends on this third-party feed*: if it becomes unavailable, degraded, or changes pricing terms, the self-hosted node remains authoritative and the service continues at full functionality. The third-party feed is logged with its own version for any cross-reference it produced, so a published rating remains reproducible even if the upstream feed later changes its own methodology. The vendor relationship is intentionally non-critical.

**3.2 Rating engine.** The TypeScript modules in `rating/engine/` ingest the indexed events and compute the rating. Concretely:

- `features.ts` materializes a per-agent feature vector from Postgres
- `segment.ts` classifies the agent into one of four segments (payment-relay, trading, service, validator)
- `pd.ts` runs the logistic-form scorecard to produce PPD
- `lgd.ts` looks up the segment-specific loss-severity prior
- `ead.ts` sums in-flight funded escrow
- `rating.ts` composes the output, assigns a tier per the §3.1 bands, attaches confidence
- `version.ts` exposes the current methodology version constant

**3.3 Service layer.** The Express application in `rating/src/` exposes the public HTTP API on port 3100 (reverse-proxied to `caliber-api.poko.blue`). Seven endpoints are live; see §6.

**3.4 On-chain primitives.** Three Solidity contracts on Arc Testnet make the rating consumable from any contract on the chain. The signer key is held in an environment-isolated process by the rating service; it never touches client-side code. See §5.

**3.5 Web surface.** A Next.js application at `caliber.poko.blue` consumes the API and renders the public explorer, the demo marketplace, the rating-trajectory chart, and the methodology paper. It holds no privileged read access — the same data exposed by the API drives the explorer.

The five components communicate only through Postgres (between indexer and engine) and HTTP (between engine and web). No shared in-memory state. A failure in any one component degrades only the surface it serves.

## 4. Rating methodology — operational summary

This section is the operational synopsis. The full mathematical specification lives in the methodology paper at [`caliber.poko.blue/methodology`](https://caliber.poko.blue/methodology); section numbers below reference that document.

### 4.1 Probability of Performance Default (PPD)

PPD is the central published risk number. The 30-day Point-in-Time PPD is the headline value. Per §4.1 of the paper, an agent commits a performance default when **any** of the following occurs within the contracted job timeline:

1. The ERC-8183 job is canceled, refunded, or disputed
2. A ValidationRegistry response with a failing status is recorded for the job's deliverable
3. ReputationRegistry feedback below the published threshold (currently `feedback_value < 50` on the 0–100 scale; surfaced in every API response under `feedback_default_threshold`)
4. The agent's wallet becomes inactive for ≥ 90 days with jobs still in flight

The empirical default rate is computed as:

```
empirical_performance_default_rate = defaulted_jobs / resolved_jobs
```

Resolved jobs include completed, failed, cancelled, refunded, disputed, and validator-rejected jobs. In-flight jobs are excluded from the denominator until they reach a terminal state (per §4.2 of the paper). This avoids understating the default rate during periods of unusually high in-flight volume.

### 4.2 Model specification (current)

The v1 model is a **logistic-form scorecard** with fixed, documented coefficients. The functional form is:

```
logit(PPD) = β₀ + β₁·log(1 + empirical_default_rate)
               + β₂·log(1 + agent_age_days)
               + β₃·validator_diversity_index
               + β₄·job_size_cv
               + β₅·recent_feedback_slope
               + β₆·sybil_flag
               + β₇·cross_chain_count
               + β₈·validator_quality_avg

PPD = 1 / (1 + exp(-logit(PPD)))
```

Coefficients are fixed (not statistically fit) until the labeled-outcome dataset is large enough for a calibrated logistic regression. The current `model_type` returned in API responses is `scorecard_v1`. Transition to `logistic_v1` is a material change under §9 and will trigger the 30-day governance window. The coefficient values are published in `rating/engine/pd.ts` under the constant `PD_COEFFICIENTS`; the v1.0.1-tuning entry in Appendix F records the most recent recalibration (2026-05-21).

### 4.3 Loss Given Default (LGD)

Loss severity after performance failure is **segmented per agent type** because recovery mechanics differ materially across job classes:

| Segment | LGD prior range | Reasoning |
|---|---|---|
| Payment-relay | 5%–25% | Funds usually retained until delivery confirmation |
| Trading | 60%–95% | Funds may be deployed and lost before failure is observed |
| Service | 25%–60% | Partial completion often recoverable |
| Validator | 10%–40% | Reputational consequences create recovery incentive |

For consumers requiring stressed estimates, a **downturn LGD** computed as the 90th percentile of observed LGDs in the historical period is reported separately under `lgd_downturn`.

### 4.4 Exposure at Default (EAD)

Per methodology §6.2, EAD in v1 includes **only actually-funded ERC-8183 escrow**:

```
EAD_current = Σ remaining_funded_escrow_value for all in-flight jobs
```

CCF-style modeling of committed-but-unfunded capacity is deferred to v2. The simplification is intentional: ERC-8183 escrow is binary (funded or not yet initiated), and the current dataset is too thin for credible CCF estimation. Simplicity supports auditability. Registry-wide EAD aggregates to **$5,680.80 USDC** as of 2026-05-22.

### 4.5 Expected Loss (EL)

`EL = PPD × LGD × EAD`. Returned in every rating response as `el_usdc`. Aggregated across the registry to **$123.54 USDC** as of 2026-05-22.

### 4.6 Tier assignment

PPD is mapped to a nine-tier scale per §3.1 (tuned per v1.0.1, 2026-05-21):

| Tier | PPD band (30d) |
|---|---|
| Caliber-AAA | < 0.4% |
| Caliber-AA | 0.4% – 1.0% |
| Caliber-A | 1.0% – 2.5% |
| Caliber-BBB | 2.5% – 6.0% |
| Caliber-BB | 6.0% – 13.0% |
| Caliber-B | 13.0% – 22.0% |
| Caliber-CCC | 22.0% – 35.0% |
| Caliber-CC | 35.0% – 55.0% |
| Caliber-D | > 55.0% or in active default |

Bands are intentionally wide. Narrower bands would imply false precision on a young dataset.

### 4.7 Confidence tier

Every rating carries a confidence indicator independent of tier: **High** (≥ 75 interactions in lookback window), **Medium** (25–74), **Low** (5–24, shown but warned), **Insufficient** (< 5, no rating issued). The thresholds were tightened in v1.0.1 (previously 50/15/5) to bring published Low-confidence ratings closer to the calibration validity window.

### 4.8 Rating views

Two views are produced per agent when sufficient history exists:

- **Point-in-Time (PIT):** 30-day rolling window. The primary published number, suitable for real-time hiring decisions.
- **Through-the-Cycle (TTC):** requires ≥ 180 days of on-chain history (§3.3). Reduced sensitivity to short-term fluctuations, intended for longer-term counterparty monitoring or portfolio-level analysis. As of 2026-05-22, no Arc agent yet meets the 180-day threshold; TTC is structurally unavailable until the registry matures.

## 5. On-chain primitives

Three contracts on Arc Testnet (chain id 5042002) implement the on-chain consumption surface. All three were redeployed 2026-05-21 with the v2 RatingAttestation struct that includes `lgdBps`.

### 5.1 RatingVerifier — `0x32C554edA5CDD2eb94F242ebf3f38820d3C53E29`

EIP-712 typed-data verifier. The signed message struct is:

```solidity
struct RatingAttestation {
    bytes32 chain;
    uint256 agentId;
    address agentAddress;
    uint8   tier;
    uint16  pdBps;
    uint16  lgdBps;
    uint8   confidence;
    bytes32 methodologyVersion;
    uint64  asOf;
    uint64  validUntil;
    uint256 nonce;
}
```

Domain separator: `name="Caliber"`, `version="1"`, `chainId=5042002`, `verifyingContract` = the deployed verifier address. The signing key is held by the off-chain rating service and rotates through methodology versioning, not through key updates.

The contract exposes:

- `requireMinRating(att, signature, maxTierAllowed, minConfidenceAllowed)` — reverts if the attestation fails to verify, is expired, uses an unaccepted methodology version, or fails the tier/confidence thresholds. Nonce replay is prevented per `(chain, agentId)` pair.
- `methodologyVersion()` / `previousMethodologyVersion()` — current and one-back versions accepted during the 30-day transition window (§9).
- `signer()` — public address of the off-chain signer.

### 5.2 RatingGateway — `0xB4C1aF80Adb9F537985B93490a02eB229089259f`

A thin wrapper around ERC-8183 `AgenticCommerce.createJob()` that enforces a Caliber threshold before any escrow movement. `postGatedJob()` calls `RatingVerifier.requireMinRating()`, validates that the provider matches the attestation's `agentAddress`, transfers USDC into a per-job holding position, and creates the underlying ERC-8183 job. The poster is recorded via `jobPoster(jobId)` so downstream contracts (notably CaliberEscrow) can resolve the true client behind a gated job.

### 5.3 CaliberEscrow — `0x0193CB604BC0B4B8853EA45Dfdcd062aa1dc3DF6`

Performance-bond escrow. The provider posts collateral proportional to their own performance-risk profile:

```
required_bond = budget × pdBps × lgdBps / 100_000_000
```

The lifecycle is:

- `postBond(jobId, att, signature)` — the provider calls with a fresh attestation of their own rating. The contract verifies the attestation, reads PD and LGD from the signed payload, computes the bond amount, pulls USDC from the provider via `transferFrom`, and records the bond.
- `release(jobId)` — **permissionless**. The contract reads ERC-8183 `getJob(jobId)`; if `status == Completed`, the bond returns to the provider.
- `slash(jobId)` — **permissionless**. If `status == Rejected || status == Expired`, the bond transfers to the original poster (resolved via `RatingGateway.jobPoster()`).

The permissionless trigger model is deliberate. No party — including the Caliber operator — has unilateral control over the bond. The on-chain ERC-8183 job state is the sole determinant of outcome. There is no admin key, no pause, no upgrade path.

### 5.4 Verification surface

The contracts are open source under MIT (`contracts/src/` in the repository). Foundry tests in `contracts/test/` cover 25 cases including domain-separator hashing, nonce replay, methodology-version transition acceptance, bond computation across the AAA/BBB/CCC tier range, and the full slash/release lifecycle. The tests are reproducible against a forked Arc Testnet node.

## 6. API surface

Public HTTP API at `https://caliber-api.poko.blue`. CORS-open for browser callers. No authentication on read endpoints; the `/attest` endpoint produces signatures bound to a fresh nonce so replay protection is on the verifier side, not on API access.

| Endpoint | Method | Purpose |
|---|---|---|
| `/v1/agents/:chain/:id/rating` | GET | Single-agent rating with full factor breakdown |
| `/v1/agents/:chain/:id/rating/history` | GET | Daily snapshot trajectory over `?days=N` |
| `/v1/agents/:chain/:id/attest` | POST | Signed EIP-712 RatingAttestation for on-chain consumption |
| `/v1/ratings/bulk` | GET/POST | Multi-agent rating summary (max 100 per request) |
| `/v1/ratings/distribution` | GET | Current registry-wide tier distribution |
| `/v1/ratings/distribution/history` | GET | Tier-mix time series over `?days=N` |
| `/v1/ratings/exposure-summary` | GET | Registry-wide EAD/EL aggregate with per-tier breakdown |
| `/health` | GET | Service liveness |

**Freshness.** Single-agent ratings are computed on demand from the indexed event stream — typically under 100ms; freshness equals the indexer lag (currently sub-block under normal load). Bulk and distribution endpoints are cached for 5 minutes. Snapshot endpoints serve materialized rows from the `rating_snapshots` table populated daily at 04:00 UTC by the `caliber-snapshot.timer` systemd unit.

**Response shape.** Every successful rating response includes `methodology_version`, `computed_at`, `view` (PIT or TTC), `confidence`, and a full `factors` object listing PPD inputs and contributions. Refusal responses use HTTP 422 with a structured `reason` field (`insufficient_interactions`, `insufficient_history`, `unknown_identity`, `rating_below_threshold`, `confidence_below_threshold`) so client code can branch cleanly without parsing error strings.

**Reproducibility.** Every published rating can be re-derived from the public `rating/engine/` code and the indexed event stream alone. The methodology version and the source block range are recorded with each response. Independent reproduction is a stated governance principle (§9).

## 7. Data quality and sample-size disclosures

This section enumerates what Caliber actually knows today, what it does not yet know, and what changes when each data threshold is crossed. Live numbers throughout are as of 2026-05-22.

**Indexed population.** 16,589 agents have been observed on Arc Testnet's ERC-8004 IdentityRegistry. This is the full population from which rated agents are drawn.

**Rateable population.** 727 of those agents meet the §1.5 minimum data requirement (≥ 5 resolved interactions across feedback, validations, and jobs; ≥ 14 days of on-chain history; no unresolved identity conflicts). 625 agents have current PIT snapshots as of today's 04:00 UTC run. The 102-agent gap reflects engine-side `insufficient_interactions` / `insufficient_history` refusals on borderline cases — the §1.5 gate is intentionally conservative.

**Current tier distribution (PIT, 2026-05-22):**

| Tier | Agent count |
|---|---|
| Caliber-AAA | 1 |
| Caliber-AA | 2 |
| Caliber-A | 69 |
| Caliber-BBB | 469 |
| Caliber-BB | 67 |
| Caliber-B | 6 |
| Caliber-CCC | 0 |
| Caliber-CC | 0 |
| Caliber-D | 11 |

The BBB cluster center is intentional. The v1.0.1-tuning recalibration (Appendix F) re-centered the neutral agent at Caliber-BBB to avoid over-stating ratings on a young dataset.

**Registry-wide exposure.** Sum of funded ERC-8183 escrow across Caliber-rated agents: **$5,680.80 USDC**. Aggregate expected performance loss (Σ PD × LGD × EAD): **$123.54 USDC**. Effective registry loss rate: **2.2%**.

**Performance-default observations.** The dataset of resolved performance defaults is small in absolute terms. Tail-risk estimation — what happens during rare or correlated failure events — is currently weak. This is the primary driver of the wide tier bands in §4.6. As the labeled-outcome dataset grows, narrower bands and a statistically calibrated logistic (`logistic_v1`) become viable. That transition is a material change under §9.

**Sample-size thresholds and what they unlock:**

| Threshold | Effect |
|---|---|
| Per-agent: ≥ 5 interactions and ≥ 14 days | Rating issued at Low confidence |
| Per-agent: ≥ 25 interactions | Medium confidence |
| Per-agent: ≥ 75 interactions | High confidence |
| Per-agent: ≥ 180 days history | TTC view becomes computable |
| Per-tier: calibration confidence interval < ±25% of predicted PPD | Tier-band tightening review |
| Registry-wide: sufficient performance defaults to fit a calibrated logistic | Transition from `scorecard_v1` to `logistic_v1` |

None of the registry-wide thresholds have been reached yet. The service operates on the conservative defaults until they are.

## 8. Limitations and model risk

A complete catalogue of currently-known limitations, each paired with what would resolve it. Risk readers should consider these binding for any use of the published ratings.

**8.1 Dataset is young.** Arc Testnet ERC-8004 activity began in early 2026. Most agents have less than four months of on-chain history. *Resolution:* time, plus continued indexing. The model accepts more confidence as agents accumulate history.

**8.2 Scorecard is not yet statistically fitted.** Coefficients in `PD_COEFFICIENTS` are documented constants tuned against the 2026-05-21 population of 883 rateable agents; they are not statistically estimated from labeled performance-default outcomes. *Resolution:* accumulate sufficient resolved performance defaults to fit a logistic regression, then transition `model_type` to `logistic_v1` under §9 governance.

**8.3 Performance-default observations are sparse.** The empirical count of agents with explicit terminal failures is small. Tail-risk (the loss in rare events) is consequently underestimated. *Resolution:* time and a larger universe of resolved jobs.

**8.4 Validator quality is not yet calibrated.** All validators currently contribute to ReputationRegistry signals with equal weight. The methodology anticipates a `validator_quality_avg` factor that down-weights validators whose past signals correlate poorly with subsequent outcomes; implementation is staged for a later wave. *Resolution:* validator-scoreboard implementation on the public roadmap, which itself requires snapshot history to compute predictiveness.

**8.5 Cross-chain identity matching is heuristic.** When the same off-chain operator registers agents on multiple chains, current identity resolution is heuristic (signature checks, naming patterns) rather than cryptographic. Identity-conflict flags suppress affected ratings (§1.5) but do not yet detect all collusion patterns. *Resolution:* standardized cross-chain identity attestations as they emerge in the ERC-8004 ecosystem.

**8.6 Anti-gaming detection is v1-conservative.** Sybil cluster detection, wash-trading, mutual-validation rings, and reputation-inflation patterns are flagged where data permits (§4.5) but do not yet suppress ratings except in the most obvious cases. The conservative stance is intentional — false-positive suspensions are costly in a young ecosystem. *Resolution:* iterative expansion of detection rules with each minor methodology version, validated against held-out periods.

**8.7 Backtesting not complete.** §7.2 of the paper explicitly states that full statistical backtesting has not yet been performed at v1.0. ROC-AUC, Gini, observed-vs-expected calibration tables, and per-segment band performance will be published when computed. The current published model should be treated as a directional indicator pending those results.

**8.8 Single-chain coverage.** Caliber covers Arc Testnet only. Base mainnet has experimental indexer code but no published ratings; the methodology's "Arc-first" framing in §1.1 reflects a deliberate scope decision. *Resolution:* future expansion contingent on demand and on validation maturity on Arc.

The cumulative effect: published ratings should be treated as **directional performance-risk indicators** under v1 conditions, not as a substitute for independent due diligence on any specific counterparty.

## 9. Governance and methodology versioning

Caliber operates a published versioning regime designed to support institutional consumers who need to reason about model changes over time.

**9.1 Material change definition.** A "material change" requires a new minor version (e.g., 1.0.0 → 1.1.0). The following are material:

- Addition or removal of a PPD factor
- Change to the performance-default definition (§4.1)
- Change to the rating scale, tier-band cutoffs, or confidence thresholds
- Change to the backtesting methodology
- Transition from scorecard to statistically-fitted logistic regression (`scorecard_v1` → `logistic_v1`)

Coefficient retuning that does not change the formula or the factor list — for example, the v1.0.1-tuning on 2026-05-21 — is logged in Appendix F as a change-history entry but does *not* bump `methodology_version`. The intent is to reserve version bumps for changes that consuming contracts and dashboards need to recognize and act on.

**9.2 30-day notice window.** Material changes are announced with a 30-day notice period during which both old and new versions are reported in parallel. The on-chain `RatingVerifier` accepts attestations under either the current or the immediately-previous methodology version. Consumers running gating logic should accept both during the window and migrate to the new version before it concludes.

**9.3 Reproducibility commitment.** Every published rating is reproducible from raw on-chain events using only the methodology document and the open-source engine code. The methodology version, the source block range, and (where applicable) the third-party feed version consulted are recorded in the rating response. Any reader can re-derive the published number; any reader who cannot is invited to file an issue against the repository.

**9.4 Current state.** `methodology_version = 1.0.0`. The change history (Appendix F of the paper) records:

- **1.0** (2026-05-20) — initial publication
- **1.0-rebrand** (2026-05-21) — brand rename, tier scale string changes, scope narrowed to Arc-first, EIP-712 domain redeployed
- **1.0.1-tuning** (2026-05-21) — scorecard recalibration against 883 rateable agents; coefficient and band-cutoff adjustments; formula and factor list unchanged

## 10. Compliance posture and licensing

**10.1 What Caliber is not.** Caliber is an analytical performance-risk rating service. It is **not**:

- A bank credit-rating agency
- An NRSRO under SEC rules, or equivalent under any other jurisdiction
- A regulatory capital input, Basel-compliant or otherwise
- Investment advice
- An endorsement, recommendation, or fiduciary opinion on any agent

Consumers using Caliber ratings in regulated contexts must perform their own model validation under their applicable framework. Reference to credit-risk vocabulary (PD, LGD, EAD, EL) is an analytical analogy adopted for legibility, not a regulatory claim.

**10.2 Licensing.** The methodology is published under the **Creative Commons Attribution 4.0 International License (CC BY 4.0)**. The engine and contract source code are published under the **MIT License**. Both permit commercial use, modification, and redistribution with attribution.

Required attribution when the methodology or its outputs are reused or adapted: `Caliber by PokoBlue`, with a link to `caliber.poko.blue/methodology` where the medium supports it.

**10.3 Operator.** The service is operated by PokoBlue ([`x.com/PokoBlue99`](https://x.com/PokoBlue99)). Source repository: [`github.com/huicom/arc-agents-explorer`](https://github.com/huicom/arc-agents-explorer). The repository is currently private through the active hackathon window and will be opened for public review after the July 2026 submission deadline.

---

*Caliber by PokoBlue · methodology v1.0.0 · operational summary updated 2026-05-22 · companion to the full methodology paper at [caliber.poko.blue/methodology](https://caliber.poko.blue/methodology)*
