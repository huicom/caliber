> **[HISTORICAL — superseded by `docs/01-mysel-roadmap.md` + Caliber rebrand 2026-05-21]**

# ArcRating — Phase 1 Implementation Plan v2.1

_Week 1: Tuesday May 19 — Monday May 25, 2026_

> **Project name:** ArcRating **Service URL (target):** `rating-arcagents.poko.blue` **Mode:** Outcome-bounded · Build-in-the-open cadence **Timezone:** Bangkok / GMT+7 throughout **Author:** PokoBlue (@PokoBlue99) **Governs:** Roadmap v3.1 Phase 1 **Supersedes:** Phase 1 plan v2 (calendar dates corrected)

---

## Calendar Reality Check

**Today is Tuesday May 19, 2026.** The week shape:

|Day|Date|Role|
|---|---|---|
|Tuesday|May 19|Today — Foundation + positioning launch|
|Wednesday|May 20|Spike (validation gates)|
|Thursday|May 21|Multichain build|
|Friday|May 22|Risk Engine|
|Saturday|May 23|Methodology launch (the centerpiece)|
|Sunday|May 24|Rest|
|Monday|May 25|Weekly recap + Phase 1 audit|

This shapes the week differently than a Monday-start week. Notable consequences:

- Methodology launch lands on **Saturday** — generally a lower-engagement social day, but gives breathing room before Monday recap
- The "weekend rest" is essentially **Sunday only**
- **Monday May 25 closes Phase 1**; Phase 2 starts Tuesday May 26

---

## Phase 1 North Star

**End-of-Monday May 25 reality:**

- Live working URL: `rating-arcagents.poko.blue` with ArcRating service
- Methodology v1 paper published
- Multichain coverage: Arc + Base
- 6+ public timestamps showing consistent shipping
- Architect Tier 1 progress
- Family, bank job, sleep intact

**Not in scope this week:**

- Agora submission (skipped — misfit)
- Trading agent (out of scope)
- BNB Chain (Phase 2)
- MCP server (Phase 2 stretch)

---

## Daily Posting Strategy

**Cadence:** 1 substantive post Tue-Sat, rest Sunday, recap Monday.

**Format mix:**

- 3x technical threads (Tue, Thu, Sat) — substance posts
- 2x build update tweets with screenshots (Wed, Fri) — momentum posts
- 1x Discord post (Sat, with methodology link, in #user-made-things)
- 1x weekly recap thread (Mon) — narrative close

**Posting time (Bangkok GMT+7):**

- Best windows for Arc/Circle US audience: 8-10 PM Bangkok (= 9-11 AM US East)
- Best windows for Asia/EU audience: 12-2 PM Bangkok
- Avoid: 2-6 AM Bangkok (US deep night, EU early morning — dead zone)

**Tagging discipline:**

- Always: `@arc` + `@samconnerone`
- Sometimes: `@DavideCrapis` for ERC-8004-specific content; `@marco_derossi` for methodology
- Acknowledge Quicknode positively when relevant
- Never tag competitors

**Tone:** lowercase-friendly, technical, real numbers when possible, no marketing fluff.

**Discord rules (critical):**

- NEVER post URLs in #general-chat (auto-block)
- URLs OK in #user-made-things
- Lowercase, casual, real numbers

---

## Day-by-Day Outcomes

### 🟢 Tuesday May 19 (today) — Foundation + Positioning Launch

**Build outcomes:**

- [done] Canteen Discord + Arc builder Discord onboarded
- [done]ARC CLI installed locally
- [done] community.arc.network profile + Architect Tier registration started
- [done]Local project repo restructured (separate `rating/` directory)

**Post — Twitter thread (5-6 tweets):**

- Topic: _"Why agent reputation isn't credit risk — it's performance bond risk"_
- Hook: surety vs credit framing distinction
- Body: 3-4 tweets walking through the framing
- Close: "building v1 this week, follow along"
- Tags: @arc @samconnerone
- Post window: Tuesday evening Bangkok (around 8-10 PM local)

**Estimated effort:** 3-3.5h **Stop conditions:**

- Thread feels off after 2 drafts → ship simplified version
- Engagement zero by Wednesday morning → adjust Thursday's content toward more concrete data

**Monday evening check:** Was the Tuesday thread the right opening shot?

---

### 🟡 Wednesday May 20 — Spike + Data Tweet

**Build outcomes:**

1. Alchemy free-tier viability confirmed for Base
2. Base canonical contracts verified (`0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` and `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63`)
3. PD math sanity check on 50 random Arc agents
4. Methodology v1 markdown finalized for Saturday publish

**Post — single tweet with screenshot:**

- Topic: PD distribution preview from real data
- Example: _"sanity-checking my PD model on 50 random arc agents. distribution looks right — most cluster around arc-bb, some arc-a, a few arc-d. methodology page drops saturday. arc-native first, base + bnb later."_
- Visual: histogram or table of rating distribution
- Tags: @arc
- Post window: Wednesday evening Bangkok

**Estimated effort:** 3.5-4h **Stop conditions:**

- Spike fails any decision gate → tweet about the _finding_ honestly ("alchemy free tier blocks faster than expected" is also content)
- Screenshot looks ugly → ship anyway, substance over polish

**Monday evening check:** Did the screenshot get more engagement than Tuesday's framing thread?

---

### 🟡 Thursday May 21 — Multichain Build + Technical Thread

**Build outcomes:**

- Schema migration: `chain_id` added to agent + event tables
- Indexer abstraction for multichain config
- Base backfill running (30 days)
- Tested: query "agents on Base" and "agents on Arc" with same indexer code

**Post — Twitter thread (4-5 tweets):**

- Topic: _"Indexing ERC-8004 across multiple chains — what's actually hard"_
- Body: confirmation depth per chain, vanity prefix gotcha, identity heuristics
- Close: "by saturday: ~40K agents across 2 chains. arc + base."
- Tags: @arc @DavideCrapis
- Post window: Thursday evening Bangkok

**Estimated effort:** 5-5.5h **Stop conditions:**

- Base backfill fails → thread about _why_ it's failing, that's also content
- Schema migration breaks Arc data → restore backup, ship Arc-only, document

**Monday evening check:** Any engagement from ERC-8004 community accounts?

---

### 🟡 Friday May 22 — Risk Engine + Progress Tweet

**Build outcomes:**

- PD function (methodology §4.2-4.4)
- LGD with agent-type segmentation (methodology §5.3)
- EAD funded-only (methodology §6.2)
- Rating tier assignment Arc-AAA → Arc-D
- API endpoint live: `/v1/agents/:chain/:id/rating`
- Returns JSON: rating, PD, LGD, EAD, EL, confidence, methodology_version

**Post — single tweet with 2 screenshots:**

- Topic: live rating API working
- Example: _"first end-to-end ratings live. agent #4521 on arc → arc-bb, PD 8.3%, confidence: medium. arc-aaa: __ agents. arc-d: __ agents. open API, no key required. methodology paper drops tomorrow."_
- Visuals: API response JSON + rating distribution chart
- Tags: @arc @samconnerone
- Post window: Friday evening Bangkok

**Estimated effort:** 5-5.5h **Stop conditions:**

- API returns garbage → fix before posting, don't post broken things
- API too slow → cache or document the limitation honestly
- Distribution makes no sense → revisit factor weights, delay tweet to Saturday morning

**Monday evening check:** This is the highest-substance post of the week pre-methodology. Should get strong signal.

---

### 🟡 Saturday May 23 — Methodology Launch + Big Thread + Discord

**Build outcomes:**

- Methodology page live at `rating-arcagents.poko.blue/methodology`
- Public rating page: `rating-arcagents.poko.blue/agent/:chain/:id`
- README updated for public viewing
- Repo cleaned up

**Post — Twitter thread (6-8 tweets) + Discord post:**

_Twitter thread:_

- Topic: methodology v1 launch — the centerpiece post of the week
- Hook: performance bond framing is the differentiator
- Body: walk through §2 (framing), §3 (Arc-* scale why not S&P), §5 (LGD segmentation)
- Close: link to paper, link to live ratings, link to repo, feedback welcome
- Tags: @arc @samconnerone @DavideCrapis @marco_derossi
- Post window: Saturday afternoon Bangkok (Saturday morning US — better for US audience awakening to weekend Twitter)

_Discord post in #user-made-things (NOT #general-chat):_

- Lowercase, casual, 3-4 sentences
- Example: "shipped the v1 of my agent rating service this week. arc-native, multichain (base added thursday), methodology paper published today. framed it as performance bond risk not credit risk because pre-funded escrow makes basel IRB the wrong analog. would love feedback from anyone who reads it."
- URLs OK in this channel

**Estimated effort:** 5-6h **Stop conditions:**

- Methodology page renders badly → fallback to static markdown viewer, polish Sunday
- Thread too long → split into two, second one Monday
- Saturday engagement weak → don't repost; the timestamp counts

**Caveat on Saturday timing:** Saturdays are weaker engagement days globally. The methodology launch lands here because of the calendar, not by choice. Compensate by repurposing the same content into Monday's recap thread for a second visibility pass.

**Monday evening check:** This is the day that defines the week's signal. Methodology + thread + Discord all on one day = maximum compound exposure.

---

### 🟢 Sunday May 24 — Rest

**Build outcomes:**

- None scheduled
- If energy permits: visual polish on rating page (mobile readable)

**Post:** NONE.

Saturday's methodology launch needs breathing room. Don't break the rhythm by force-posting on the weakest engagement day.

**Estimated effort:** 0-2h max. Family/lens business/personal priority.

---

### 🔴 Monday May 25 — Weekly Recap Thread + Phase 1 Audit

**Build outcomes:**

- None. Polish only if needed.

**Post — recap thread (5-6 tweets):**

- Topic: _"week 1 of building arcrating in public"_
- Hook: _"one week ago i had an idea about agent counterparty risk. here's what shipped."_
- Body: list of shipped artifacts with links — methodology paper, live API, Arc + Base coverage, total agents rated, open source repo
- Close: _"what's next: bnb chain, real backtest results, more methodology depth. follow along."_
- Tags: @arc @samconnerone
- Post window: Monday evening Bangkok (= Monday morning US — strong engagement day/time)

**Phase 1 audit (private, 30 min):** See template in next section

**Estimated effort:** 2-2.5h

**Stop conditions:**

- Energy at 4/10 or lower → cap Phase 2 ambition before it starts
- No engagement on any post all week → recalibrate strategy in Phase 2
- Strong week → proceed to Phase 2 (Grant prep) confidently

---

## Total Effort

|Day|Hours|
|---|---|
|Tue May 19|3-3.5h|
|Wed May 20|3.5-4h|
|Thu May 21|5-5.5h|
|Fri May 22|5-5.5h|
|Sat May 23|5-6h|
|Sun May 24|0-2h|
|Mon May 25|2-2.5h|
|**Total**|**23.5-29h**|

Inside 20h+holiday-bonus budget. Family/bank/health intact.

---

## Daily Post Calendar — Quick Reference

|Day|Date|Post Type|Topic|Tags|
|---|---|---|---|---|
|Tue|May 19|Thread (5-6)|Performance bond framing|@arc @samconnerone|
|Wed|May 20|Single + screenshot|PD distribution data|@arc|
|Thu|May 21|Thread (4-5)|Multichain indexing|@arc @DavideCrapis|
|Fri|May 22|Single + 2 screenshots|Live rating API + numbers|@arc @samconnerone|
|Sat|May 23|Thread (6-8) + Discord|Methodology launch|@arc @samconnerone @DavideCrapis @marco_derossi|
|Sun|May 24|—|Rest|—|
|Mon|May 25|Thread (5-6)|Week 1 recap|@arc @samconnerone|

**6 substantive posts + 1 Discord engagement across 7 days.**

---

## Project File Structure

```
arc-agents-explorer/             (existing repo)
├── indexer/                     (existing indexer)
│   ├── arc/
│   └── base/                    (new this week)
├── rating/                      (new — the rating service)
│   ├── api/v1/agents/
│   ├── engine/
│   │   ├── pd.ts                (methodology §4)
│   │   ├── lgd.ts               (methodology §5)
│   │   ├── ead.ts               (methodology §6)
│   │   └── rating.ts            (methodology §3)
│   └── tests/
├── web/
│   ├── pages/
│   │   ├── agent/[chain]/[id].tsx
│   │   └── methodology.tsx
├── docs/
│   └── methodology-v1.md
└── README.md
```

---

## Phase 1 Audit Template (Monday May 25 evening)

```
PHASE 1 — WEEK 1 AUDIT — Monday May 25, 2026 (Bangkok)
═══════════════════════════════════════════════════════

SHIPPED THIS WEEK:
- [ ] Methodology v1 published at rating-arcagents.poko.blue/methodology
- [ ] Live rating service multichain (Arc + Base)
- [ ] 6 Twitter posts + 1 Discord post + 1 recap thread
- [ ] Architect Tier 1 progress

SIGNAL TOTALS:
- Twitter followers in Arc circle: +__
- Total post engagement (likes/replies/retweets): __
- Methodology page visits: __
- GitHub stars: __
- Any retweet from credible Arc account? Y/N
- Any reply from @arc, @samconnerone, @DavideCrapis, @marco_derossi? Y/N
- Discord reactions: __

EFFORT REALITY:
- Hours actually spent: __
- Hours planned: 23.5-29
- Sleep average: __ hrs/night
- Family time: Green / Yellow / Red
- Bank job: Green / Yellow / Red
- Energy at end of week: __/10

PHASE 2 ENTRY GATE:
- Energy ≥ 6/10 AND family ≤ yellow AND bank ≤ yellow → proceed full
- Any red flag → scale Phase 2 to maintenance until reset
```

---

## What Phase 1 Does NOT Include

Explicitly out of scope:

- ❌ Agora submission (skipped — misfit)
- ❌ Trading agent (out of scope)
- ❌ BNB Chain (Phase 2)
- ❌ MCP server (Phase 2 stretch)
- ❌ Embed badge JS (Phase 2 stretch)
- ❌ Webhook system (Phase 2 if energy)
- ❌ Real backtest results in methodology (Phase 3)
- ❌ Worked example agent page (v1.1)

Any creep means something planned drops instead.

---

## Recalibration Triggers

Watch for these during the week:

1. **Tuesday thread gets zero engagement** → adjust Thursday's thread to be more concrete (less framing, more data).
2. **Builds slip behind by Wednesday evening** → drop Friday's tweet, focus on Saturday only.
3. **Family/bank job strain by Thursday** → cut Sunday rest deeper, simplify Monday recap to single tweet.
4. **Methodology page doesn't ship by Saturday** → push to Monday, restructure recap as launch announcement.

---

## What's Next

Phase 2 plan drafts Tuesday May 26 morning. Covers:

- Circle Developer Grant application drafting (Tue-Fri)
- BNB Chain integration (Wed-Thu if holiday block available)
- Public API documentation (Fri)
- **Sunday May 31: Grant submission deadline**
- Monday Jun 1: Phase 2 audit + Phase 3 plan drafting

Phases 3-4 stay milestone-only until execution begins.

---

_Implementation plan v2.1 · Calendar-corrected · Locked Tuesday May 19, 2026 Bangkok_ _Phase 1 governs Tue May 19 → Mon May 25._ _Build smart. Sleep well. 🇹🇭_
