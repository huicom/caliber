# Caliber Rating Methodology — v1.0

*Performance-Risk Framework for ERC-8004 Agents*

> **Published:** 2026-05-20 | **Authored by:** PokoBlue (@PokoBlue99) | **Version:** 1.0 | **Status:** Draft for community review

---

## In plain language

Caliber is not a bank credit rating agency for AI agents. It is a transparent performance-risk score.

The question is not whether an agent can repay debt. The question is whether the agent can reliably complete the jobs it accepts.

The methodology borrows useful structure from credit-risk modeling because PPD, LGD, EAD, and Expected Loss are familiar ways to express obligation-failure risk. But the economic event being modeled is different: **performance failure** under an on-chain job/escrow workflow.

> **Caliber is a performance-risk rating system for AI agents. It estimates the probability that an agent accepts a job but fails to complete it successfully. The methodology borrows useful structure from credit-risk modeling, but the event being measured is performance failure, not loan default. Surety and contractor underwriting are useful analogies, but Caliber is not a guarantor, insurer, bank rating agency, or regulatory capital model.**

---

## Executive Summary

Caliber Rating Service produces early performance-risk ratings for autonomous AI agents registered under the ERC-8004 standard.

The goal is to estimate how likely an agent is to accept a job and fail to complete it successfully.

This is not traditional lending credit risk. The agent is not borrowing money, and the job poster is not underwriting loan repayment. The risk is **performance risk**: did the agent complete the job, pass validation, and avoid dispute?

The methodology borrows familiar concepts from credit-risk modeling — probability of default, loss severity, exposure, and expected loss — but adapts them to agent performance. In this document, "default" means **performance default**, not legal or regulatory credit default.

The output is a Caliber-* rating, a **Probability of Performance Default (PPD)**, estimated loss severity after performance failure, current exposure from in-flight jobs, and an expected loss estimate.

The output is designed to be transparent and easy for risk-minded users to interpret. It may be useful for builders, job posters, validators, and analysts who want a structured view of agent reliability.

This v1 methodology is intentionally simple, transparent, and open for community review. The dataset is still young, so ratings should be treated as **directional performance-risk indicators** rather than bank-grade credit ratings, investment advice, or regulatory capital inputs.

This document specifies the rating methodology, the validation framework, governance principles, and limitations. **It is published openly because reputation systems are useful only when they cannot be gamed by whoever runs them.**

---

## 1. Scope and Definitions

### 1.1 What This Methodology Covers

This methodology produces ratings for entities meeting all of the following:

- Registered in an ERC-8004 IdentityRegistry on a supported chain (currently **Arc testnet**. Base scaffolding parked in the codebase)
- Has at least one ReputationRegistry or ValidationRegistry interaction
- Meets the minimum data requirement in §1.5

### 1.2 What It Does Not Cover

This methodology does not rate:

- Agents engaged exclusively in non-financial coordination
- Agents whose primary identity is off-chain
- Smart contract risk of the agent's underlying logic (this is a code audit, not a counterparty rating)
- Token issuance, governance, or other instruments associated with the agent

### 1.3 Key Definitions

| Term | Definition in this context |
|------|----------------------------|
| **Counterparty** | An ERC-8004 agent transacting under ERC-8183 jobs or analogous escrow primitives |
| **Performance Default** | Failure to deliver a contracted job within agreed parameters, resulting in escrow release back to the counterparty or dispute |
| **Probability of Performance Default (PPD)** | Expected probability the agent commits a performance default within a forward 30-day window. Plays a similar modeling role to PD in credit risk, but the default event is task failure, not missed debt repayment. |
| **Loss Severity** (LGD by convention) | Expected unrecovered portion of EAD after performance failure, taking into account escrow refunds, partial releases, validator decisions, and dispute resolution. |
| **Exposure at Default (EAD)** | Remaining funded escrow across in-flight jobs for the agent |
| **Expected Loss (EL)** | EL = PPD × Loss Severity × EAD |
| **Resolved Job** | A job in a terminal state: completed, failed, cancelled, refunded, disputed, or validator-rejected. In-flight (funded but not yet terminal) jobs are not resolved. |
| **In-Flight Job** | A funded job that has not yet reached a terminal state |

Where formulas elsewhere in this document use `PD` for readability, `PD` should be read as **PPD**.

### 1.4 Data Sources

Caliber currently uses the following data sources:

1. ERC-8004 **IdentityRegistry** events (agent registration, metadata)
2. ERC-8004 **ReputationRegistry** events (feedback signals)
3. ERC-8004 **ValidationRegistry** events (validator outcomes)
4. ERC-8183 **AgenticCommerce** (or analogous) job and escrow events
5. Caliber **self-hosted Arc indexer** (block-by-block decoder, source of truth)
6. **Supplementary upstream feeds** where available (e.g., Quicknode ERC-8004 API for cross-validation; treated as redundant, not critical — see §8.3)

For each rating, the API records the source block range, chain ID, methodology version, and rating timestamp. Ratings are reproducible from raw on-chain events using only this document and the published indexer + rating engine code.

### 1.5 Minimum Data Requirement

An agent receives a public rating only when **all** of the following are true:

- At least **5 resolved jobs** *or* reputation/validation interactions
- At least **14 days** since first observed on-chain activity
- No unresolved identity conflict across supported chains
- Sufficient source data to reproduce the score from this document

Agents below this threshold are returned as `rated: false` with `reason: 'insufficient_interactions'` or `'insufficient_history'`, not assigned a tier.

Lookback windows used inside the model:

| Use | Window | Notes |
|-----|--------|-------|
| Minimum on-chain history | **14 days** | gate for any rating |
| Point-in-Time (PIT) PPD | rolling **30 days** | the primary public number |
| Through-the-Cycle (TTC) PPD | rolling **180 days minimum**, full available history | only issued when ≥180d history exists |

Until sufficient history exists across the ecosystem, **TTC ratings will be unavailable for most agents** in v1.

---

## 2. Economic Framework: Agent Performance Risk

The economic substance of an ERC-8004 agent transaction is **not lending**. An agent does not receive a loan and promise repayment over time. Instead, the agent accepts a task and is expected to deliver a service or output.

For that reason, the primary risk is **performance risk**: the risk that the agent fails to complete the job, fails validation, receives poor outcome feedback, or becomes inactive while work remains outstanding.

A useful analogy is **surety or contractor performance underwriting**. In those settings, the core question is not "will the borrower repay?" but "will the principal perform the contracted obligation?"

Caliber uses this analogy carefully. ERC-8004 jobs are not legal surety bonds, and Caliber does not act as a guarantor. The analogy is used only to frame the risk problem: one party promises performance, another party needs confidence, and the key event is failure to deliver.

The vocabulary — Probability of Default, Loss Given Default, Exposure at Default, Expected Loss — is borrowed from credit-risk modeling because:

1. The Expected Loss formula (PPD × LGD × EAD) is a structurally sound way to express any obligation-failure problem.
2. The rating-scale convention (AAA → D) is universally legible to a broad audience.
3. Risk-minded users already have mental slots for these inputs, making the output easier to interpret.

Throughout this document:

- "Probability of Default" should be read as **Probability of Performance Default (PPD)**.
- "Loss Given Default" should be read as **Loss Severity After Performance Failure** under pre-funded escrow.
- The terms PD, LGD, and EAD are used in their adapted form for formula readability.

**This methodology makes no claim of Basel regulatory compliance, and does not present itself as a bank-grade credit rating or a regulatory capital input.** The reference to credit-risk vocabulary is an **analytical analogy**, not a regulatory precedent.

### Why pre-funded escrow changes the picture

The funded portion of an ERC-8183 escrow is ring-fenced before the agent acts. There is no counterparty insolvency exposure in the traditional lending sense. What remains is operational performance risk — whether the agent does the work it has been paid (in escrow) to do. That is the risk this methodology measures.

---

## 3. Rating Scale

### 3.1 Caliber-* Letter Grades

Ratings are issued on the following 9-tier Caliber-* scale. The `Caliber-` prefix is intentional. **These ratings are not equivalent to S&P, Moody's, Fitch, or AM Best ratings.** They are ordinal indicators of agent performance risk within a young on-chain ecosystem.

| Rating | PPD Range (30d) | Description |
|--------|-----------------|-------------|
| Caliber-AAA | < 0.4% | Highest quality, minimal performance risk |
| Caliber-AA | 0.4% – 1.0% | Very high quality |
| Caliber-A | 1.0% – 2.5% | Upper-medium grade |
| Caliber-BBB | 2.5% – 6.0% | Medium grade |
| Caliber-BB | 6.0% – 13.0% | Speculative |
| Caliber-B | 13.0% – 22.0% | Highly speculative |
| Caliber-CCC | 22.0% – 35.0% | Substantial risks |
| Caliber-CC | 35.0% – 55.0% | Very high risks |
| Caliber-D | > 55.0% or in active default | Defaulted or near-defaulted |

*Bands reflect the v1.0.1-tuning recalibration (2026-05-21) against the first 883 rateable agents on Arc. See Appendix F for the pre-tuning bands and rationale; the formula and factor list are unchanged.*

The bands are deliberately wide. Narrower bands invite false precision on a young dataset. The reasoning behind the band widths and the planned tightening schedule is in Appendix C (Calibration Philosophy).

### 3.2 Confidence Tiers

Each rating includes a confidence indicator:

| Confidence | Conditions |
|------------|-----------|
| **High** | ≥ 75 interactions in lookback window |
| **Medium** | 25–74 interactions |
| **Low** | 5–24 interactions; rating shown but consumers should not act on it alone |
| **Insufficient** | < 5 interactions; no rating issued (see §1.5) |

*Thresholds reflect the v1.0.1-tuning recalibration; see Appendix F.*

The "±2% confidence interval" sometimes attached to the High tier is a planned statistical estimate based on the underlying PPD distribution. It is not yet computed for every rating in v1 — when present, the calculation method will be documented in a subsequent minor version. Until then, the confidence tier is the primary indicator of evidence sufficiency.

### 3.3 Through-the-Cycle vs Point-in-Time

Two rating views are produced for every agent with sufficient history:

- **Point-in-Time (PIT):** reflects current 30-day rolling behavior. Used for real-time hiring decisions.
- **Through-the-Cycle (TTC):** reflects full available history with reduced sensitivity to short-term fluctuations. Requires minimum 180 days of history. Used for **longer-term counterparty monitoring or portfolio-level analysis**.

A migration matrix tracks PIT rating transitions over rolling 30-day windows, enabling consumers to assess rating stability.

### 3.4 Rating Actions

Caliber may assign the following rating actions:

| Action | Meaning |
|--------|---------|
| **New Rating** | First rating issued after the agent meets the minimum data requirement (§1.5) |
| **Upgrade** | Rating improves due to stronger observed performance |
| **Downgrade** | Rating weakens due to failures, disputes, inactivity, or deteriorating signals |
| **Watch Negative** | Recent behavior indicates elevated risk but data is not yet conclusive for a downgrade |
| **Watch Positive** | Recent behavior improves but has not persisted long enough for an upgrade |
| **Withdrawn** | Rating removed due to stale data, identity conflict, unsupported chain, or methodology exclusion |

Rating actions are written to the public change log per agent and included in the API response under `rating_action` when not `New Rating` or steady-state.

---

## 4. Probability of Performance Default (PPD) Model

> **Why PPD, not PD?**
>
> To avoid confusion with bank lending terminology, this methodology uses **Probability of Performance Default (PPD)** as the primary term.
>
> PPD estimates the probability that an agent will fail to complete a job successfully within a forward 30-day window. For readers familiar with credit risk, PPD plays a similar modeling role to PD — but the default event is task failure, validation failure, dispute, refund, or abandonment, **not missed debt repayment**.
>
> Where formulas in this document use `PD`, it should be read as `PPD`.

### 4.1 Performance Default Definition

An agent is considered to have committed a **performance default** on a job when **any** of the following occur within the contracted job timeline:

1. ERC-8183 job (or analogous escrow) is canceled, refunded, or disputed
2. A validator submits a failing ValidationRegistry response for the job's deliverable
3. Counterparty submits ReputationRegistry feedback with `value` below a defined threshold for outcome-tagged feedback (v1 threshold: feedback `value < 50` on the 0–100 scale, treated as a performance signal). The threshold and scale are subject to change as ERC-8004 feedback semantics mature; the active threshold is recorded in the API response under `feedback_default_threshold` for each rating.
4. The agent's wallet becomes inactive for ≥ 90 days while jobs remain in-flight. The 90-day window is chosen because it is short enough to flag genuinely abandoned agents but long enough to absorb realistic operational gaps (holidays, infrastructure migrations). The threshold is configurable per future methodology version.

Performance defaults are tagged per-job and aggregated into agent-level default rates.

**Note on terminology:** This is *performance default*, not *credit default*. Credit-risk frameworks use "default" for specific credit events such as missed loan payments or bankruptcy. Performance default in this methodology refers to failure-to-deliver events under pre-funded escrow.

### 4.2 Default Rate Calculation

For each agent across the lookback period (PIT: 30 days; TTC: 180 days minimum):

```
empirical_performance_default_rate = defaulted_jobs / resolved_jobs
```

**Resolved jobs** include completed jobs, failed jobs, cancelled jobs, refunded jobs, disputed jobs, and validator-rejected jobs. **In-flight jobs are excluded from the denominator until they reach a terminal state.** This avoids understating the default rate during periods of unusually high in-flight volume.

This empirical rate is the **base PPD** before factor adjustments.

### 4.3 PPD Factor Adjustments

The base PPD is adjusted using behavioral and structural risk factors. Each factor is a multiplicative or additive modifier applied to the base rate:

| Factor | Direction | Rationale |
|--------|-----------|-----------|
| Agent age (younger = higher PPD) | + | New agents have less observed behavior |
| Validator diversity (concentrated = higher PPD) | + | Single-validator histories are weaker signals |
| Job size variance (very high variance = higher PPD) | + | Inconsistent capacity signals operational risk |
| Recent feedback trend (declining = higher PPD) | + | Deterioration signal |
| Sybil concentration flags (from upstream feeds and §4.5 checks) | + | Reputation may be inflated |
| Cross-chain presence (more chains active = lower PPD) | – | More observable surface area, harder to manipulate |
| Validator reputation quality (better validators = lower PPD) | – | Higher-quality validators produce more reliable signals |

Factor weights are documented in the published source code (`rating/engine/pd.ts`, constant `PD_COEFFICIENTS`) and reflected back in the API response under `factor_contributions` for any consumer that wants to audit how the final PPD was assembled.

### 4.4 PPD Model Specification

A **logistic regression form** is the intended v1 model specification once sufficient labeled outcomes are available:

```
logit(PPD) = β₀ + β₁·log(1+empirical_performance_default_rate)
               + β₂·log(1+agent_age_days)
               + β₃·validator_diversity_index
               + ... + βₙ·factorₙ
```

Logistic regression is chosen because it is **explainable** to model validators, well-understood, and appropriate for binary outcome modeling.

**Honesty about current calibration.** Until the dataset contains enough resolved jobs and observed performance defaults to fit coefficients statistically, Caliber uses a **transparent scorecard approximation with fixed, documented weights**. The model type used for each published rating is included in the API response as:

- `model_type: "scorecard_v1"` — fixed weights, current state
- `model_type: "logistic_v1"` — once statistically calibrated coefficients replace the scorecard

The transition between scorecard and fitted logistic is itself a material change under §8.1 and will be announced with the 30-day notice window.

### 4.5 Anti-Gaming Controls

Because on-chain reputation can be manipulated, Caliber applies the following anti-gaming checks where data is available. Each may **reduce confidence, increase PPD, or suppress a rating** until more independent history is observed.

| Signal | What it flags |
|--------|---------------|
| Repeated interactions among a small wallet cluster | Wash-trading-style reputation building |
| Validator concentration | All positive validations come from one or two validators |
| Unusually small job values driving completion rate | Reputation inflation via dust-sized jobs |
| Sudden burst of positive feedback in a short window | Coordinated reputation push |
| Circular reputation patterns (A rates B, B rates A) | Mutual-validation rings |
| New-agent history with very low aggregate economic value | Cheap-to-create identities |
| Identity conflict across chains | Same off-chain operator behind multiple registered identities without disclosure |

Anti-gaming detection is **conservative in v1**: the goal is to suppress ratings on suspicious agents, not to publish accusations. When a signal triggers, the API response includes a `flags` array (e.g., `flags: ["validator_concentration"]`) and the confidence tier is reduced one step.

---

## 5. Loss Severity After Performance Failure

In lending, LGD usually means the portion of a loan not recovered after borrower default. **That is not the case here.**

For Caliber, **loss severity** measures the unrecovered value after an agent fails to perform. Because many jobs are pre-funded through escrow, losses may be reduced by refunds, partial releases, validator decisions, or dispute resolution.

For formula compatibility, this methodology may refer to this quantity as **LGD**. More precisely, it means **Loss Given Performance Failure (LGPF)** — the gap between escrow funded and value delivered when a performance default occurs.

### 5.1 Recovery Mechanisms

For ERC-8183 (or analogous) jobs, the following recovery mechanisms exist:

1. **Escrow refund:** unused USDC returns to the counterparty on cancellation
2. **Partial completion release:** validator-determined partial payment to agent, balance to counterparty
3. **Dispute resolution:** off-chain or DAO-mediated resolution
4. **No recovery:** funds disbursed before performance failure became evident

### 5.2 LGD Calculation

```
LGD = 1 - (recovered_USDC / EAD_at_default)
```

Aggregated across all observed performance defaults for the agent's segment.

### 5.3 LGD Segmentation

LGD is computed **per agent type segment** because recovery mechanisms behave differently across job types:

| Segment | Typical LGD Range (v1 observed) | Reasoning |
|---------|---------------------------------|-----------|
| Payment relay agents | 5%–25% (Low) | Funds usually retained until delivery confirmation |
| Trading agents | 60%–95% (High) | Funds may be deployed and lost before failure is detected |
| Service agents (translation, analysis, etc.) | 25%–60% (Medium) | Partial completion often recoverable |
| Validator agents | 10%–40% (Low–Medium) | Reputational consequences create recovery incentive |

Segmentation is included because different job types have **different recovery patterns** — a failed trading agent and a failed translation agent leave behind very different recoverable balances. The numeric ranges above are v1 prior estimates from limited live data; they are refined as observed defaults accumulate per segment.

### 5.4 Downturn LGD

For consumers requiring stressed estimates, a **downturn LGD** is computed using the 90th percentile of observed LGDs in the historical period. This is reported separately from the central estimate.

---

## 6. Exposure at Default (EAD)

### 6.1 Current EAD Calculation

```
EAD_current = Σ(remaining_funded_escrow_value) for all in-flight jobs
```

EAD is recalculated continuously as new jobs are funded and as in-flight jobs are partially released or completed.

### 6.2 v1 Scope: Funded EAD Only

For v1, **EAD is computed using actually-funded escrow only**.

- **Funded escrow** (USDC already in the ERC-8183 contract for an in-flight job) — counted.
- **Unfunded job requests or quoted-but-not-yet-funded capacity** — excluded. They may be monitored as pipeline activity, but they are not treated as current exposure until escrow is funded.

Modeling expected new exposure from committed-but-unfunded capacity (CCF-style adjustments familiar from credit-risk modeling) is **deferred to v2**. Rationale: ERC-8183 escrow is binary — either funded or not yet initiated. Modeling "expected new jobs in the PPD horizon" introduces forecasting noise without v1 benefit. Simplicity supports auditability.

---

## 7. Validation and Backtesting

### 7.1 Backtesting Methodology

The PPD model is backtested against historical data using:

- **Out-of-time validation:** model trained on the first 75% of available history, tested on the most recent 25%.
- **Discriminatory power:** measured via Gini coefficient and Receiver Operating Characteristic (ROC) AUC.
- **Calibration accuracy:** observed-vs-expected default rates per rating band.

Target metrics for v1:

- ROC-AUC ≥ 0.70 (acceptable discriminatory power on limited data)
- Gini ≥ 0.40
- Calibration: no rating band where observed default rate falls outside ±50% of predicted

**Note on thresholds.** These v1 thresholds are deliberately conservative for a young dataset. Production banking models typically target ROC-AUC ≥ 0.75. As more performance default observations accumulate, target thresholds will tighten and be re-documented in subsequent versions.

### 7.2 Initial Backtest Results

**As of v1.0 draft, full statistical backtesting has not yet been completed.** The target validation metrics in §7.1 are shown to define the intended acceptance criteria, not to imply that the current model has already met them.

When backtest results are published they will appear here in full, regardless of strength — honesty about model limitations is stronger than inflated metrics. Results will include:

- ROC-AUC, Gini, sample size, default count
- Per-band calibration table (predicted vs observed PPD)
- Out-of-time test window dates
- Any segments where the model failed acceptance thresholds and the resulting action (e.g., scorecard fallback, segment-specific recalibration)

### 7.3 Limitations Acknowledged

- Dataset is young: ERC-8004 activity since early 2026 (Arc testnet from Q1 2026; Base mainnet coverage added during this build).
- Performance default observations are limited; statistical confidence on tail risk is weak.
- Cross-chain agent identity matching is heuristic and may introduce noise.
- Validator quality varies; downstream signal quality is bounded by upstream signal quality.
- v1 covers Arc only; Base scaffolding parked.

---

## 8. Governance Framework

### 8.1 Model Change Control

This methodology is versioned. Any of the following constitute a **material change** requiring a new minor version:

- Addition or removal of a PPD factor
- Change to the performance default definition
- Change to rating scale or PPD band cutoffs
- Change to backtesting methodology
- Transition from scorecard to statistically-fitted logistic regression (§4.4)

Material changes are announced ahead of time. The intent is a **30-day notice period** during which both old and new versions are reported in parallel; in practice, smaller-scale changes from a solo maintainer may be documented in the public change history with a shorter notice window — the active policy is recorded in the change log (Appendix F) and reflected in every API response via a `methodology_version` field.

### 8.2 Auditability and Independent Review

Even at v1 scale, the service operates with simple role separation:

- **Development:** the publisher (PokoBlue) builds and operates the model.
- **Independent review:** the methodology is published openly for community review; substantive feedback from named reviewers is documented in the change history.
- **Auditability:** every published rating is reproducible from raw on-chain events using only this methodology document and the published code.

This methodology does not claim a formal three-lines-of-defense governance structure. It claims operational discipline appropriate to a v1 open-source project, with **intentional transparency as the substitute for organizational separation**.

### 8.3 Vendor Risk Management

The service runs on a self-hosted Arc node operated by the publisher. Upstream data feeds (Quicknode ERC-8004 API, hosted Base RPC providers) are integrated as redundant or supplementary sources, **not critical dependencies**:

- If hosted RPC access is degraded, the Arc-native rating service continues at full functionality.
- If Quicknode's API is discontinued or pricing changes adversely, ratings continue using only direct on-chain reads.
- If the methodology of an upstream feed changes (e.g., Quicknode's reputation formula version), this service explicitly versions which upstream version was consumed at any given time.

This design follows a basic data-resilience principle: ratings should not depend on a single hosted API when direct on-chain reads are available.

---

## 9. Disclaimers and Limitations

### 9.1 Not Investment Advice, Not Regulatory Approval

Caliber Rating Service produces analytical performance-risk ratings. These ratings are **not investment advice**, **not endorsements**, and have not been approved by any banking regulator or rating agency licensing body. Consumers using these ratings in regulated contexts must perform their own model validation. **No claim of Basel compliance is made.**

### 9.2 Permissionless and Open

This methodology is published openly under the **Creative Commons Attribution 4.0 International License (CC BY 4.0)**. You are free to share and adapt the methodology — including for commercial use — provided you give appropriate credit.

**Required attribution string:** *"Caliber by PokoBlue"* (with a link to the source paper or `caliber.poko.blue/methodology` when the medium supports it).

The rating engine source code is open source at `github.com/huicom/arc-agents-explorer` (kept private through the active hackathon window; will be made public after the July 2026 submission deadline). Forks of the methodology are encouraged under the terms above.

### 9.3 Known Limitations

- v1.0 covers Arc only; Base scaffolding parked.
- Confidence-Insufficient agents receive no rating.
- Performance default observations are limited by chain age.
- Sybil-resistance is partially inherited from upstream feeds; independent sybil detection is staged across v1 (§4.5) and v2.
- Through-the-Cycle ratings require 180+ days of history; many agents will only receive Point-in-Time ratings in v1.
- API JSON field names use the `ppd_` prefix (e.g., `ppd_30d`, `base_ppd`, `mean_ppd_30d`) to match the public terminology used throughout this paper.

---

## Appendix A: Concept Mapping (for readers from credit-risk and surety backgrounds)

The terms used in this methodology are adapted from credit-risk and surety-style frameworks. The mapping below is provided for **orientation only** — it is not a regulatory implementation of either framework, and no claim of regulatory equivalence is made.

| Caliber concept | Performance-bond analog | Credit-risk analog |
|-------------------|-------------------------|--------------------|
| Performance Default | Bond claim event | Default event |
| Loss Severity (LGD by convention) | Bond recovery rate | LGD |
| EAD | Bond face value at claim | EAD |
| Expected Loss | Expected bond payout | EL |
| Through-the-cycle rating | Long-run obligor rating | TTC rating |
| Point-in-time rating | Current contract performance score | PIT rating |
| Rating migration matrix | Rating transition analysis | Transition matrix |
| Agent type segmentation | Bond class (bid, performance, payment) | Exposure class |
| Downturn loss severity | Stressed recovery scenario | Downturn LGD |

The methodology is *inspired by* both surety-style and credit-risk thinking, but does not claim to be either. It is an early performance-risk scoring framework for on-chain AI agents.

---

## Appendix B: Glossary

| Term | Definition |
|------|-----------|
| **Agent** | Autonomous or semi-autonomous service entity registered under ERC-8004 |
| **Job** | A task accepted by an agent under ERC-8183 or an analogous workflow |
| **Job poster** | Party requesting and funding the job |
| **Validator** | Entity or mechanism that assesses whether output passed requirements |
| **Reputation event** | On-chain or indexed feedback about agent outcome |
| **Performance default** | Failure to complete accepted work within agreed parameters (see §4.1) |
| **PPD** | Probability of Performance Default over a defined horizon |
| **LGD / LGPF** | Loss severity after performance failure |
| **EAD** | Remaining funded exposure across in-flight jobs |
| **Expected Loss (EL)** | PPD × LGD × EAD |
| **PIT rating** | Current behavior-sensitive rating (30-day window) |
| **TTC rating** | Longer-history rating with reduced short-term sensitivity (≥180 days) |
| **Confidence tier** | Indicator of how much evidence supports the rating |
| **Resolved job** | Job with final state: completed, failed, cancelled, refunded, disputed, or rejected |
| **In-flight job** | Funded job not yet resolved |
| **Sybil risk** | Risk that reputation is inflated by controlled or related identities |
| **Methodology version** | Semver string published in every API response identifying which document version produced the rating |
| **Rating action** | Categorical label describing change vs. prior rating (New, Upgrade, Downgrade, Watch Negative, Watch Positive, Withdrawn) |
| **ERC-8004** | Open standard for on-chain agent identity, reputation, and validation registries |
| **ERC-8183** | On-chain job and escrow primitive used as the canonical job lifecycle in v1 (Arc reference deployment at `0x0747EEf0706327138c69792bF28Cd525089e4583`) |

---

## Appendix C: Calibration Philosophy

Caliber-* bands are deliberately wide for a young dataset. Narrow bands would invite false precision — small fluctuations in a thin set of resolved jobs would push agents across tier boundaries in ways the underlying signal doesn't support.

The bands will tighten over time as observed performance defaults accumulate and the per-tier confidence intervals shrink. Tightening is a material change under §8.1 and will be announced through the standard governance window. Drivers of band-width change that should trigger a tightening review:

- Per-tier sample size exceeds the threshold where calibration-test confidence intervals fall below ±25% of the predicted PPD.
- Out-of-time backtest (§7.1) demonstrates consistent ordering of agents across at least two consecutive 90-day windows.
- A material change in the performance-default definition (§4.1) settles into stable observation.

For readers familiar with bank credit rating scales: the letter convention (AAA → D) is intentionally familiar so the **direction** of the scale is immediately legible. The **numeric bands** are calibrated for agent performance over 30-day windows and should not be read as equivalent to any annual issuer-credit grade. Caliber is not a credit rating agency and makes no claim to NRSRO-equivalent calibration.

---

## Appendix D: Worked Example

Agent A has, over the last 30 days:

- **40 resolved jobs**
- **3 performance defaults**
- **10,000 USDC of currently-funded in-flight escrow**
- Estimated **Loss Given Performance Failure of 30%** for its agent-type segment

**Step 1 — Empirical performance default rate:**

```
3 / 40 = 7.5%
```

**Step 2 — Factor adjustments (illustrative):**

The base rate is adjusted using the factors in §4.3. For this agent, factors push the rate slightly higher (young agent, moderate validator diversity), so:

```
PPD = 9.0%
```

**Step 3 — Loss severity and exposure:**

```
LGPF = 30%
EAD  = 10,000 USDC
```

**Step 4 — Expected Loss:**

```
EL = PPD × LGPF × EAD
   = 0.09 × 0.30 × 10,000
   = 270 USDC
```

The model estimates **270 USDC of expected performance-loss exposure** for Agent A's current in-flight job book over the next 30 days. The agent's PPD of 9.0% lands in the **Caliber-BB** band (6.0%–13.0%).

This example is illustrative. The actual factor weights for any published rating are documented in `rating/engine/pd.ts` (`PD_COEFFICIENTS`) and surfaced per-rating in the API under `factor_contributions`.

---

## Appendix E: Example Rating Output

```json
{
  "agent_id": "12",
  "chain": "arc",
  "rated": true,
  "rating": "Caliber-BB",
  "rating_view": "point_in_time",
  "ppd_30d": 0.09,
  "lgd": 0.30,
  "ead_usdc": "10000",
  "expected_loss_usdc": "270",
  "confidence": "medium",
  "interactions": 40,
  "model_type": "scorecard_v1",
  "methodology_version": "1.0.0",
  "rating_timestamp": "2026-05-20T00:00:00Z",
  "data_window_days": 30,
  "rating_action": "New Rating",
  "flags": [],
  "factor_contributions": {
    "empirical_default_rate": "+0.06",
    "agent_age_days": "+0.01",
    "validator_diversity_index": "+0.005",
    "cross_chain_presence": "-0.005"
  }
}
```

**Notes on field names:**
- `chain` values in v1: `"arc"` (testnet) and `"base"` (mainnet).
- `ppd_30d` represents **Probability of Performance Default** over a 30-day horizon.
- `ead_usdc` and `expected_loss_usdc` are returned as **strings** to preserve precision (the values are denominated in 6-decimal USDC and may exceed JavaScript's safe integer range when aggregated).
- `model_type` indicates whether the rating used the v1 scorecard (`scorecard_v1`) or a statistically-fitted logistic (`logistic_v1`) — see §4.4.

---

## Appendix F: Change History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-05-20 | Initial publication. Includes PPD terminology, Arc-* scale, segmented LGD, funded-EAD-only, scorecard model with planned logistic transition, anti-gaming controls (§4.5), rating actions (§3.4), data sources (§1.4), minimum data requirement (§1.5), worked example (Appendix D), and example API output (Appendix E). |
| 1.0-rebrand | 2026-05-21 | Brand renamed from ArcAgents Rating Service to **Caliber**. Tier scale strings renamed `Arc-*` → `Caliber-*` (band cutoffs unchanged). Methodology version remains 1.0.0 — no methodological change. Multi-chain language (Arc + Base) narrowed to "Arc only; Base scaffolding parked" per the Arc-first focus. EIP-712 domain name in the deployed `RatingVerifier` contract redeployed with `name="Caliber"` to match the brand. Required attribution string: `"Caliber by PokoBlue"`. |
| 1.0.1-tuning | 2026-05-21 | **Scorecard recalibration** against the first 883 rateable agents. Same formula, tighter parameters — **no methodological change** (`model_type` remains `scorecard_v1`). Pre-tuning distribution: 55% A-or-better, CCC/CC empty. **PD coefficients** (`rating/engine/pd.ts`): `intercept` −3.5 → **−3.0** (re-centers neutral agent from A to BBB), `agentAge` −0.4 → **−0.3**, `recentFeedbackSlope` −0.2 → **−0.15** (dampen slope-driven AAAs on thin data), `sybilFlag` +0.6 → **+1.0** (concentration penalty doubled). **Tier-band cutoffs** (§3.1): AAA `<0.5%` → `<0.4%`, AA `<1.5%` → `<1.0%`, A `<3.0%` → `<2.5%`, BB `<12%` → `<13%`, B `<20%` → `<22%`, CC `<60%` → `<55%`. BBB and CCC ceilings unchanged. **Confidence thresholds** (§3.2): medium `15` → **25**, high `50` → **75**. Low stays at 5 (changing it would alter §1.5). LGD priors unchanged. |

---

*Methodology published under **CC BY 4.0**. Required attribution when reused or adapted: **"Caliber by PokoBlue"**. Maintained by PokoBlue (@PokoBlue99) and the Caliber community.*

*Reproducible. Auditable. Open.*
