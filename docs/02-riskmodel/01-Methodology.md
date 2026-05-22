# Caliber Rating

## A Counterparty Performance Rating for On-Chain AI Agents

> by PokoBlue · @PokoBlue99 · May 2026
> Live at [caliber.poko.blue](https://caliber.poko.blue)

---

## TL;DR

The **Caliber Rating** rates AI agents on Arc based on what they've actually done on-chain — jobs completed, jobs disputed, who paid them, how fast they delivered, who vouches for them. Everything comes from public events on Arc (ERC-8004 + ERC-8183). No vibes. No off-chain noise. If you can read our table below, you can audit any rating we publish.

---

## Why This Exists

Arc is filling up with AI agents. Some are great. Some are sketchy. Some are brand new and haven't proven anything yet.

If you're about to fund an escrow, hire an agent for a job, or let one act on your behalf — you want a quick read on **whether this thing actually delivers**.

That's what Caliber rates. Not whether an agent is "smart." Not whether it has a cool name. Just: **based on its on-chain track record, how likely is it to do the job?**

---

## What We Look At (The Core Table)

This is the foundation. Everything in our rating traces back to one of these signals. If you understand this table, you understand the whole system.

| What happens on-chain | What it tells us | What we use it for |
|---|---|---|
| **Job created** (ERC-8183) | Agent is participating in the market | Activity rate |
| **Job funded** (ERC-8183) | Someone trusted this agent enough to lock USDC into escrow for them | Inbound reputation |
| **Deliverable submitted** (ERC-8183) | Agent actually did the work and pushed it back on-chain | Throughput |
| **Evaluation accepted** ✅ (ERC-8183) | A counterparty said "yes, this delivered" | **Success event** |
| **Evaluation rejected / disputed** ❌ (ERC-8183) | A counterparty said "no, this didn't deliver" | **Failure event** |
| **Settled in USDC** (ERC-8183) | The money actually moved | Realized value |
| **Reputation attestation** (ERC-8004) | Someone on Arc vouched for this agent | Network endorsement |
| **Validation event** (ERC-8004) | Agent verified a credential | Identity strength |
| **Time between events** | How fast and consistent the agent is | Operational reliability |
| **Counterparty mix** | Whether the agent has many clients or just one | Concentration risk |

### A few things this table is honest about

- **We rate what's observable.** No off-chain promises, marketing, or Twitter clout factors in. If it didn't emit an event, we don't see it.
- **Performance is two-sided.** A "success" requires a counterparty to accept the work. A "failure" requires one to reject it. We're rating the agent, but the data is jointly produced.
- **Settlement is the truth signal.** Until USDC actually moves, the value is just promised, not realized. We track all three states but anchor our economic metrics to settled value only.

### What this table can't tell us

- **Whether the work was actually good.** If the evaluator was sloppy and accepted bad work, that's a "success" in our data. We inherit evaluator noise.
- **Whether the agent is one person, a team, or pure code.** Doesn't matter for the rating, but worth saying.
- **Whether the counterparty is high-quality.** A high-volume agent serving sketchy evaluators looks the same as one serving rigorous ones — for now. We'll fix this later.

---

## How the Rating Gets Built

Three steps, left to right. Each step builds on the previous; each step is documented and reproducible.

### fig. 1 — rating pipeline

![Caliber rating pipeline: Step 01 Foundation (deterministic feature summaries from on-chain events) → Step 02 Transformation (credibility weighting, forward-looking estimate, risk flags) → Step 03 Output (tier, score 0–100, confidence interval). Score composition: 50% smoothed reliability, 25% forward estimate, 15% network, 10% latency.](/methodology/rating-pipeline.png)

The table below is the same diagram in copy-pasteable form for accessibility and indexing.

| **Step 01 · Foundation** | **Step 02 · Transformation** | **Step 03 · Output** |
|---|---|---|
| **The features** | **The math** | **The rating** |
| *deterministic summaries* | *three techniques, each disclosed* | *tier + score + confidence* |
| Raw on-chain events summarised per agent. Run the same SQL against the same node, get the same numbers. No predictions yet — just what happened. | Statistics on top of the features. Each technique does specific work and is documented in the methodology — no ensembles, no black boxes. | A signed, methodology-versioned attestation. Never one number alone — the tier states what's been observed, the score quantifies it, the interval declares how sure we are. |

**Step 01 — features (deterministic):**

| name | type |
|---|---|
| `completion_rate` | ratio |
| `dispute_rate` | ratio |
| `delivery_latency_p50` | seconds |
| `delivery_latency_cv` | unitless |
| `settled_usdc_volume` | usdc |
| `unique_counterparties` | count |
| `unique_validators` | count |
| `counterparty_hhi` | index |
| `self_deal_share` | ratio |

**Step 02 — math (three techniques):**

- **2.1 Credibility weighting** — blends agent record with population mean. Small samples pulled toward average. Actuarial method, 1960s.
- **2.2 Forward-looking estimate** — recency-weighted probability of next-job success. Handles in-flight jobs. Returns point + interval.
- **2.3 Risk flags** — disclosed heuristics: concentration, sybil pattern, volume anomaly, dormancy. One fire → Watch tier.

**Step 03 — output (example):**

```
tier        ● Proven           describes observed behaviour, not predicted default
score       72 / 100           weighted composite of Step 02 outputs
confidence  ± 4.8              90% interval — wider when data is thin
```

**Score composition** (weighted sum of Step 02 outputs; revised in public):

| 50% smoothed reliability | 25% forward estimate | 15% network | 10% latency |
|---|---|---|---|

*Each step builds on the last.* The detail of each step is below.

### Step 1: Turn events into features

We take the raw events from the table and summarize them per agent. Things like:

- **Completion rate** — how often does this agent's work get accepted?
- **Dispute rate** — how often does it get rejected?
- **Speed** — how long between funding and delivery? Is it consistent or all over the place?
- **Volume** — how much USDC has actually settled through this agent?
- **Network reach** — how many different counterparties? How many different validators?
- **Concentration** — is this agent mostly serving one client, or spread across many?

All of this is just summarizing what happened. No predictions yet. No magic. If you ran the same SQL against the same node, you'd get the same numbers.

### Step 2: Apply the math

Three techniques. Each does specific work.

**1. Smoothing for small samples.**

Here's a common trap: Agent A has 4 jobs, all successes (100%). Agent B has 200 jobs, 180 successes (90%).

Naive ranking says A is better. Reality says B has actually proven something and A might just be lucky.

We fix this by blending each agent's individual record with the population average, weighted by how much data we have. New agents with thin history get pulled toward the average. Agents with long history get to stand on their own record.

The technique is called **credibility weighting**. Insurance actuaries have used it since the 1960s. It's the right tool for sparse data.

**2. Forward-looking estimate.**

A backward-looking completion rate is fine, but you actually want to know: *what's the chance the next job goes well?*

So we run a model that:
- Weights recent jobs more than old ones
- Handles jobs that are still in progress (rather than ignoring them)
- Adjusts for things like job size and how diverse the agent's counterparties are

You get a probability with a confidence range. The thinner the data, the wider the range. We don't pretend to know more than we do.

**3. Risk flags.**

Statistics assume nobody's gaming the system. On-chain, that's not safe. So we add some heuristic flags on top:

| Flag | When it fires |
|---|---|
| **Concentration: Counterparty** | 80%+ of jobs from a single client AND fewer than 3 unique clients |
| **Concentration: Validator** | 80%+ of validations from a single validator AND fewer than 3 unique validators |
| **Sybil pattern** | Self-deal share > 30% of jobs AND fewer than 5 unique clients. The flag requires self-dealing to dominate the behavior, not just appear once. Full graph cycle detection is v2.1. |
| **Volume anomaly** | Brand-new agent doing 10× their lifetime average in 30 days (requires ≥30 days history) |
| **Dormancy** | No activity in 90+ days |

These are rules, not models. We disclose every one. If a flag fires, the agent gets pushed to the **Watch** tier regardless of its other numbers.

### Step 3: The actual rating

What you see on the site is always three things together — never one in isolation.

#### The tier

| Tier | What it means | Score | Minimum data |
|---|---|---|---|
| 🟢 **Established** | Strong track record, no red flags | 80–100 | 50+ completed jobs |
| 🔵 **Proven** | Reliable, decent sample | 65–79 | 20+ completed jobs |
| 🟡 **Emerging** | Looks promising, limited history | 50–64 | 5+ completed jobs |
| ⚪ **Provisional** | Not enough data yet — sits near population average | 35–49 | < 5 jobs |
| 🟠 **Watch** | Risk flag triggered | Any | Any |
| ⚫ **Inactive** | Dormant 90+ days | N/A | Any |

We don't use AAA/AA/BBB letter grades on purpose. Those grades come from credit rating agencies and carry decades of meaning about default probability that we cannot back up with this data. Our tiers describe what's actually been observed.

#### The score

A number from 0–100. It's a weighted combination of:

- 50% — smoothed completion reliability (Step 2.1)
- 25% — forward-looking success probability (Step 2.2)
- 15% — network endorsement (validator diversity, attestations)
- 10% — operational reliability (latency consistency)

These weights are our starting point. We'll adjust as we get more data and we'll publish every change.

#### How sure we are

Every rating ships with a confidence line. Things like:

- *"High confidence — based on 247 completed jobs over 9 months"*
- *"Moderate confidence — based on 31 completed jobs"*
- *"Low confidence — only 6 jobs observed; score anchored to population average"*
- *"Watch flag: concentration on single counterparty"*

This isn't optional. If you hit our API, you get the score AND the confidence in the same response. Anyone hiding their confidence level is selling you something.

---

## Reproduce Anything

The whole point of doing this on-chain is that you don't have to trust us. You can rebuild any rating yourself.

Here's what you need:

1. An Arc node — self-hosted or RPC provider
2. The contract addresses for ERC-8004 and ERC-8183
3. Our feature definitions (SQL views in the repo)
4. Our math (open source in `rating/engine/`, TypeScript)
5. Our rating composition rules from Step 3

We publish:
- ✅ Raw event data via API
- ✅ Computed features per agent
- ✅ The statistical parameters (so you can verify the math)
- ✅ Final ratings with every component broken out

If you run the same inputs and get a different rating, **we want to hear about it**. That's the point.

---

## The Attestation Primitive

**The product is the attestation, not just the rating.**

Caliber publishes every rating as a **signed EIP-712 attestation** that any contract on Arc can verify and consume. The rating describes an agent's track record; the attestation makes that description composable into on-chain logic. Any contract on the chain can read a signed Caliber claim and do something with it — gate access, require collateral, weight a vote, route payments, set fees, condition disbursements.

This is what makes Caliber a **trust primitive** rather than a dashboard. We compute and sign; the network builds on top.

### What the attestation carries

Each EIP-712 `RatingAttestation` carries: the agent's chain + on-chain ID + wallet address, the tier (0–5 enum), the score (0–100), the interaction count, the flags bitfield, the methodology version, a freshness window, and a replay-protection nonce. A contract that verifies the signature against the published Caliber signer key knows the claim is current, complete, and untampered.

### Reference implementations

We built two reference contracts to show what consuming an attestation can look like:

- **`RatingGateway`** — a thin wrapper over ERC-8183 `createJob()` that refuses jobs whose providers fall below a caller-chosen tier threshold (or trigger blocking flags). This is **access gating**: the application decides who is allowed to participate.
- **`CaliberEscrow`** — a tier-stepped performance-bond escrow. Agents lock USDC collateral when accepting a gated job, sized by their tier. The bond returns on completion or slashes to the original client on rejection/expiry. This is **commitment device**: the application creates an additional consequence for failure beyond the ERC-8183 protocol's default refund.

These are examples, not the methodology's outputs. Other contracts can consume the same attestation differently — and we expect they will. A staking module could weight votes by tier. A marketplace could set listing fees inversely to tier. A payment router could disburse to Established agents at lower latency. The attestation is the primitive; the integrations are open-ended.

### A note on bonds vs. rating

A bond is a *commitment device*, not a *rating signal*. The tier already tells you what the agent has shown. The bond creates a different thing: an actual consequence the agent's wallet feels when they fail. These do related but distinct work. ERC-8183 escrow already refunds the client's budget on rejection — the bond addresses something the budget refund doesn't, the agent's lack of personal downside otherwise.

Bond rates are configurable on-chain (admin-set, event-logged, capped at 50% of budget). They are an **editorial market-design choice**, not an empirically calibrated default-probability estimate — there is not enough resolved-default data on a young testnet to derive them from observed failure rates. As resolved defaults accumulate, the table can be re-derived from observed failure rate × loss severity. Until then we publish them as a published schedule with a refinement path. The bond table itself lives at [`caliber.poko.blue/integrate`](/integrate) — the methodology paper does not prescribe specific rates, because rate-setting is an application-layer decision, not a rating decision.

Material changes to the bond table follow the same 30-day notice rule as methodology version changes (see §Versioning).

---

## What This Is Not

A few things worth saying clearly:

- **Not a prediction.** A high rating doesn't guarantee the next job goes well. It describes a track record.
- **Not a credit score.** We don't model default probability. We don't assess solvency. Different problem.
- **Not financial advice.** If you're about to send funds, do your own diligence. Our rating is one input.
- **Not an endorsement.** A high tier isn't us vouching for an agent. It's us summarizing their on-chain history.

---

## The Honest Disclaimers

Stuff you should hold in mind whenever you look at a Caliber Rating:

- 🧪 **Testnet only.** All current ratings are from Arc Testnet. Mainnet behavior may be different. We'll reset and recalibrate at mainnet.
- 📊 **Small sample.** ~16,000 agents indexed, and most have fewer than 10 jobs. Statistics on small populations are noisy. The confidence indicator exists for this reason.
- ⏱️ **Short history.** Months, not years. Take long-term claims with a grain of salt.
- 🔄 **The population keeps changing.** New agent types, new behaviors. Anything trained on the past has some decay risk.
- 🎯 **We rate agents, not evaluators (yet).** If an evaluator is too lenient or too strict, that noise ends up in agent ratings. Validator-rating is on the roadmap.
- 🎮 **All on-chain reputation is partially gameable.** Our risk flags catch the obvious patterns. They won't catch everything.

---

## Methodology Provenance

An earlier draft of this work, developed under the working name **ArcAgents** and later as **Caliber v1.0**, explored a framing borrowed more directly from banking — performance bonds, surety logic, and credit-rating-style letter grades (Caliber-AAA, AA, BBB, …, D). That framing was rejected.

The reason: the underlying data does not support credit-rating-grade claims. Credit rating agencies calibrate against decades of default data across millions of obligors. We have months of testnet data across roughly 16,000 agents, most with fewer than 10 jobs. Borrowing the *vocabulary* of credit rating (PD, LGD, EAD, EL, AAA/AA/BBB) without the *evidence base* would have been overclaiming, and any reviewer with five minutes of risk experience would have caught it.

The current methodology — **Caliber Rating v2.0**, counterparty performance rating with credibility-weighted reliability, survival analysis, and rule-based risk flags — is a more honest fit for the data we actually have. The techniques are drawn from reliability engineering, actuarial credibility theory, and platform-trust scoring rather than credit risk.

The v1.0 contracts and methodology paper are preserved as a public archive (git tag `methodology-v1.0.1-final` in the repository) so the revision history is auditable. They are no longer the operative methodology and no longer match the live `RatingVerifier`.

This is **v2.0**. We expect to be wrong in places. We expect to revise. The provenance is published so the revision history starts honest.

---

## Versioning

This is **Caliber Methodology v2.0**. When we change the methodology, we'll publish a new version, mark which ratings used which version, and explain what changed.

Versioning rules going forward:

| Change type | Version bump |
|---|---|
| Typo fix, link update | No bump |
| New feature added (e.g., evaluator quality scoring) | Minor: v2.0 → v2.1 |
| Score weights re-tuned based on backtest | Minor bump |
| Cross-chain support added | Minor bump |
| Bond table revision (rate per tier) | Minor bump (governance change, 30-day notice) |
| Fundamental rework of methodology | Major: v2.x → v3.0 |

Breaking changes always get the major version bump. If a v2.0 rating wouldn't compute to the same score under v2.1, that's actually a v3.0 change.

**Material changes** (anything that changes a rating's computed value, the tier scheme, the bond table, or the default definition) get a 30-day notice period during which both old and new versions are reported in parallel. The on-chain `RatingVerifier` accepts attestations under either the current or the immediately-previous methodology version. Consumers running gating logic should accept both during the window and migrate to the new version before it concludes.

On the roadmap for v2.1:
- Rating the evaluators (so agent ratings can adjust for evaluator quality)
- Per-factor audit drill-down on every rating
- Watchlist webhook subscriptions for tier transitions
- Cross-chain ratings (Base first, maybe BNB)
- Backtest results once we have 60+ days of mainnet data

---

## Want to dig deeper?

- **Site:** [caliber.poko.blue](https://caliber.poko.blue)
- **Code:** [github.com/huicom/arc-agents-explorer](https://github.com/huicom/arc-agents-explorer)
- **Issues, disagreements, requests:** open an issue on GitHub
- **DM:** @PokoBlue99 on Twitter

Built in Bangkok. Powered by a self-hosted Arc node. Standards-native, open methodology.

*If you got value out of this, the most useful thing you can do is try a rating, find something we got wrong, and tell us. Methodology improves by getting punched.*

---

## Appendix F — Change History

| Version | Date | Changes |
|---|---|---|
| 1.0 | 2026-05-20 | Initial publication under the working name ArcAgents. Performance-bond / PPD-LGD-EAD framing. Tier scale Arc-AAA … Arc-D. |
| 1.0-rebrand | 2026-05-21 | Brand renamed from ArcAgents to **Caliber**. Tier scale strings renamed `Arc-*` → `Caliber-*`. Scope narrowed to Arc-only. EIP-712 domain redeployed with `name="Caliber"`. No methodological change. |
| 1.0.1-tuning | 2026-05-21 | Scorecard recalibration against the first 883 rateable agents. PD coefficient and tier-band cutoff adjustments. Same formula, no methodological change. **This was the last v1.x version.** Archive tag: `methodology-v1.0.1-final`. |
| **2.0** | **2026-05-22** | **Pivot to counterparty performance rating.** Performance-bond / PPD-LGD-EAD framing replaced with credibility-weighted reliability, survival analysis, and rule-based risk flags. Tier scale renamed from Caliber-AAA … Caliber-D to Established / Proven / Emerging / Provisional / Watch / Inactive. Score 0–100 replaces PD probability as the central published number. Attestation struct redesigned (`tier`, `score`, `interactionCount`, `flags` replace `pdBps`, `lgdBps`, `confidence`). CaliberEscrow bond formula changed from `budget × PD × LGD` to tier-stepped table with configurable rates. Three contracts redeployed on Arc Testnet. Provenance: the v1.x framing was rejected as overclaiming for the data available; v2.0 is the honest fit. |

---

*Caliber Methodology v2.0 · May 22, 2026 · Bangkok · 🇹🇭*
