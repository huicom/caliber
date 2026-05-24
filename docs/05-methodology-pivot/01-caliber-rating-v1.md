---
title: "Caliber Rating"
subtitle: "A Counterparty Performance Rating for On-Chain AI Agents"
author: "PokoBlue (@PokoBlue99)"
status: "draft · methodology pivot · not yet adopted"
saved: 2026-05-22
supersedes: "docs/02-riskmodel/01-Methodology.md (Performance-bond / PPD-LGD-EAD framing, v1.0.0)"
---

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

Three steps. Each one builds on the last.

```
                ┌─────────────────────────────────┐
                │  STEP 3: The Rating              │
                │  Tier + Score + How sure we are  │
                └────────────────┬────────────────┘
                                 │
                ┌────────────────┴────────────────┐
                │  STEP 2: The Math                │
                │  Smoothing + forward-looking     │
                │  estimate + risk flags           │
                └────────────────┬────────────────┘
                                 │
                ┌────────────────┴────────────────┐
                │  STEP 1: The Features            │
                │  Reliability metrics from the    │
                │  table above                     │
                └─────────────────────────────────┘
```

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
| **Concentration: Counterparty** | 60%+ of jobs from a single client |
| **Concentration: Validator** | 60%+ of validations from a single validator |
| **Sybil pattern** | Counterparty graph has suspicious cycles |
| **Volume anomaly** | Brand-new agent doing 10× their lifetime average in 30 days |
| **Dormancy** | No activity in 90+ days |

These are rules, not models. We disclose every one. If a flag fires, the agent gets pushed to the **Watch** tier regardless of its other numbers.

### Step 3: The actual rating

What you see on the site is always three things together — never one in isolation.

#### The tier

| Tier | What it means | Score | Minimum data |
|---|---|---|---|
| 🟢 **Gold** | Strong track record, no red flags | 80–100 | 50+ completed jobs |
| 🔵 **Silver** | Reliable, decent sample | 65–79 | 20+ completed jobs |
| 🟡 **Bronze** | Looks promising, limited history | 50–64 | 5+ completed jobs |
| ⚪ **Pending** | Not enough data yet — sits near population average | 35–49 | < 5 jobs |
| 🟠 **Watch** | Risk flag triggered | Any | Any |
| ⚫ **Dormant** | Dormant 90+ days | N/A | Any |

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
4. Our math (Python, using `lifelines` and `scipy`)
5. Our rating composition rules from Step 3

We publish:
- ✅ Raw event data via API
- ✅ Computed features per agent
- ✅ The statistical parameters (so you can verify the math)
- ✅ Final ratings with every component broken out

If you run the same inputs and get a different rating, **we want to hear about it**. That's the point.

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
- 📊 **Small sample.** ~12,000 agents indexed, and most have fewer than 10 jobs. Statistics on small populations are noisy. The confidence indicator exists for this reason.
- ⏱️ **Short history.** Months, not years. Take long-term claims with a grain of salt.
- 🔄 **The population keeps changing.** New agent types, new behaviors. Anything trained on the past has some decay risk.
- 🎯 **We rate agents, not evaluators (yet).** If an evaluator is too lenient or too strict, that noise ends up in agent ratings. Validator-rating is on the roadmap.
- 🎮 **All on-chain reputation is partially gameable.** Our risk flags catch the obvious patterns. They won't catch everything.

---

## Methodology Provenance

An earlier draft of this work, developed under the working name **ArcAgents**, explored a framing borrowed more directly from banking — performance bonds, surety logic, and credit-rating-style letter grades (AAA, AA, etc.). That framing was rejected before publication.

The reason: the underlying data does not support credit-rating-grade claims. Credit rating agencies calibrate against decades of default data across millions of obligors. We have months of testnet data across roughly 12,000 agents, most with fewer than 10 jobs. Borrowing the *vocabulary* of credit rating without the *evidence base* would have been overclaiming.

The current methodology — Caliber Rating, counterparty performance rating with credibility-weighted reliability, survival analysis, and rule-based risk flags — is a more honest fit for the data we actually have. The techniques are drawn from reliability engineering, actuarial credibility theory, and platform-trust scoring rather than credit risk.

This is v1.0. We expect to be wrong in places. We expect to revise. The provenance is published so the revision history starts honest.

---

## Versioning

This is **Caliber Methodology v1.0**. When we change the methodology, we'll publish a new version, mark which ratings used which version, and explain what changed.

Versioning rules going forward:

| Change type | Version bump |
|---|---|
| Typo fix, link update | No bump |
| New feature added (e.g., evaluator quality scoring) | Minor: v1.0 → v1.1 |
| Score weights re-tuned based on backtest | Minor bump |
| Cross-chain support added | Minor bump |
| Fundamental rework of methodology | Major: v1.x → v2.0 |

Breaking changes always get the major version bump. If a v1.0 rating wouldn't compute to the same score under v1.1, that's actually a v2.0 change.

On the roadmap for v1.1:
- Rating the evaluators (so agent ratings can adjust for evaluator quality)
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

*Caliber Methodology v1.0 · May 22, 2026 · Bangkok · 🇹🇭*
