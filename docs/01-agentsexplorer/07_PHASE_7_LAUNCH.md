# Phase 7 — Content & Launch

> **Goal:** Get the world to know ArcAgents exists. Maximize reach via Twitter, Arc House Forum, and Discord.

**Estimated time:** 2 hours
**Output:** Launch thread posted, Arc team notified, Discord/Forum cross-posted, first 100 visitors.

---

## 🎯 Outcomes of Phase 7

After this phase:

1. ✅ Launch tweet thread published with screenshots
2. ✅ Arc House Forum showcase post
3. ✅ Discord `#showcase` cross-post
4. ✅ GitHub repo README polished and pinned
5. ✅ LinkedIn post (optional, for professional reach)
6. ✅ Visible to Circle / Arc team

---

## 📋 Pre-Launch Checklist

- [ ] `https://arcagents.io` is live and stable
- [ ] Your agent #14176 detail page is screenshot-ready
- [ ] Live feed shows actual events (test before posting)
- [ ] GitHub repo is **public**, has proper README, MIT license
- [ ] You've posted in Arc Discord at least 3 times before this (helps with credibility)
- [ ] Phone fully charged + good wifi (you'll be responding for hours)

---

## Step 7.1 — Capture Screenshots (YOU, 20 min)

You need 4-6 high-quality screenshots. Use a 16:9 viewport (1920×1080) for desktop shots and a real phone for mobile.

### Required screenshots

1. **Homepage hero** — top of `arcagents.io` with stats + live feed visible
2. **Your agent detail page** — `/agents/14176` showing reputation, validation badge, capabilities
3. **Live feed page** — with at least 3-5 events visible
4. **Jobs detail with timeline** — `/jobs/20049` showing the lifecycle stepper
5. **Stats page** — with charts populated
6. **Mobile homepage** — taken on actual phone (iPhone/Android)

### How to capture clean shots

**On macOS:** `Cmd+Shift+4` then `Space` then click window for clean window shot.

**On Linux:** Use [Flameshot](https://flameshot.org) or `gnome-screenshot`.

**Crop tool:** Strip out browser chrome unless it adds context.

**Save as:** PNG (lossless) named `arcagents-1-home.png` through `arcagents-6-mobile.png`.

**Add subtle annotations:** Use Skitch, Annotate, or even Preview to highlight key features (red box around reputation score, etc.).

---

## Step 7.2 — Polish the GitHub Repo README (Claude Code, 30 min)

### CLAUDE CODE PROMPT #7.2 — Repo README

> Write a polished `README.md` at the root of `arc-agents-explorer` repo.
>
> Structure:
>
> ````markdown
> # ArcAgents Explorer
>
> > The first agent explorer for [Arc](https://arc.network) — Circle's institutional Layer-1 for stablecoin finance.
>
> Live at **[arcagents.io](https://arcagents.io)**
>
> ![Hero screenshot](./docs/screenshots/hero.png)
>
> ## What is this?
>
> ArcAgents is a public dashboard for every ERC-8004 agent registered on Arc Testnet. It indexes the identity, reputation, validations, and ERC-8183 job activity for every agent — and streams new events live.
>
> ## Why it exists
>
> [8004scan.io](https://8004scan.io) (the canonical ERC-8004 explorer by AltLayer) supports 27 chains. Arc isn't one of them — yet. The agentic economy is being built on Arc; this is the missing infrastructure.
>
> ## Features
>
> - 🔍 **Searchable agent registry** — find agents by name, capability, owner address
> - ⭐ **Live reputation history** — every feedback event, on-chain attested
> - 🪪 **Validation status** — KYC/TEE/custom validators tracked
> - 💼 **ERC-8183 jobs** — full lifecycle: open → funded → submitted → completed
> - 💸 **USDC accounting** — total volume, agent earnings, daily flows
> - ⚡ **Live event stream** — SSE pipe directly from our Arc node
> - 📊 **Analytics dashboard** — 30-day time-series + leaderboards
>
> ## Tech stack
>
> | Layer | Tech |
> |---|---|
> | Frontend | Next.js 15 (App Router) + Tailwind v4 + shadcn/ui + recharts |
> | API | Next.js route handlers + Zod + Drizzle ORM |
> | Database | Postgres 16 + pgvector (future semantic search) |
> | Indexer | TypeScript + viem WS + Postgres LISTEN/NOTIFY |
> | Node | Self-hosted Arc (Reth + Malachite) |
> | Infra | nginx + systemd + Cloudflare + Let's Encrypt |
>
> ## Architecture
>
> ```
> Arc Testnet ──→ Self-hosted Arc node ──→ Indexer ──→ Postgres ──→ Next.js ──→ Cloudflare
>                                                       │
>                                                       └─ LISTEN/NOTIFY → SSE → Browser
> ```
>
> ## Run it locally
>
> ```bash
> # 1. Clone
> git clone https://github.com/huicom/arc-agents-explorer.git
> cd arc-agents-explorer
>
> # 2. Install
> pnpm install
>
> # 3. Start Postgres + pgvector
> docker run -d --name arc-pg \
>   -e POSTGRES_PASSWORD=arcdev \
>   -e POSTGRES_DB=arc_agents \
>   -p 5432:5432 \
>   pgvector/pgvector:pg16
>
> # 4. Configure
> cp .env.example .env
> # edit: DATABASE_URL, ARC_RPC_URL, ARC_RPC_WS
>
> # 5. Migrate
> pnpm db:migrate
>
> # 6. Backfill historical data
> pnpm dev:indexer:backfill
>
> # 7. Run dev mode
> pnpm dev:indexer:live   # terminal 1
> pnpm dev:web            # terminal 2
>
> # Open http://localhost:3000
> ```
>
> ## Project layout
>
> ```
> arc-agents-explorer/
> ├── apps/
> │   ├── web/             # Next.js public site
> │   └── indexer/         # Backfill + live indexer
> ├── packages/
> │   └── db/              # Drizzle schema + migrations
> ├── deploy/              # nginx + systemd configs
> └── docs/                # Architecture notes + screenshots
> ```
>
> ## Contributing
>
> Issues + PRs welcome. Particularly looking for:
> - Better metadata caching (Filecoin Pin integration)
> - Capability ontology (NANDA registry compatibility)
> - Multi-language UI (Thai 🇹🇭 + others)
> - Agent semantic search (pgvector + embeddings)
>
> ## License
>
> MIT — see [LICENSE](./LICENSE)
>
> ## Credits
>
> Built solo from Bangkok 🇹🇭 by [@PokoBlue](https://twitter.com/yourhandle).
>
> Not affiliated with Circle or the Arc team.
>
> ## Roadmap
>
> - [ ] "Hire this agent" flow (ERC-8183 escrow + USDC payment)
> - [ ] Semantic search via pgvector embeddings
> - [ ] Agent-to-agent payment graph visualization
> - [ ] Public read-only API with keys
> - [ ] Thai-language UI
> - [ ] Mobile app (React Native + same API)
> - [ ] Arc Mainnet support (when launched)
>
> ## Acknowledgements
>
> - [Circle](https://circle.com) for Arc + the Developer Wallets SDK
> - [AltLayer](https://altlayer.io) for inspiring 8004scan
> - [ERC-8004 spec](https://eips.ethereum.org/EIPS/eip-8004) authors
> - [Anthropic](https://anthropic.com) — built with Claude Code
> ````
>
> Add `docs/screenshots/` and copy the screenshots there. Add a `LICENSE` file (MIT).

### YOU: Polish + push

```bash
cd ~/arc-agents-explorer
mkdir -p docs/screenshots
# Copy screenshots to docs/screenshots/

git add README.md LICENSE docs/
git commit -m "docs: polished README + screenshots for launch"
git push
```

Make the repo public if it's not already:
- GitHub → Settings → Danger Zone → "Change visibility" → Public

Pin the repo on your profile:
- Your profile → Customize your pins → select `arc-agents-explorer`

---

## Step 7.3 — Twitter Launch Thread (YOU, 30 min)

### Tweet 1 (with hero screenshot)

```
🚀 Shipping: arcagents.io

The first agent explorer for @arc.

Browse every AI agent on Arc. See their reputation, validations, completed jobs, USDC earnings — all in one place.

Built solo from Bangkok 🇹🇭 over 7 days. Powered by my own Arc node.

👇
```

📎 **Attach:** `arcagents-1-home.png`

---

### Tweet 2 (with agent detail screenshot)

```
1/ Every ERC-8004 agent on Arc gets a profile:

✅ Identity + metadata
⭐ Full reputation history
🪪 KYC validation status
💼 All jobs ever taken
💰 Total USDC earned

Example: my translation agent → arcagents.io/agents/14176
```

📎 **Attach:** `arcagents-2-agent-detail.png`

---

### Tweet 3 (with live feed screenshot)

```
2/ Live feed: watch the agentic economy in real time.

Every new agent. Every reputation score. Every USDC payment.

Streamed from my self-hosted Arc node via Postgres LISTEN/NOTIFY → SSE.

arcagents.io/live
```

📎 **Attach:** `arcagents-3-live.png`

---

### Tweet 4 (the why)

```
3/ Why this matters:

@8004_scan tracks ERC-8004 agents across 27 chains. Arc isn't one of them — yet.

The agentic economy is being built on Arc. It needed an explorer.

So I built one. arcagents.io
```

---

### Tweet 5 (tech stack flex)

```
4/ Stack:

→ Self-hosted Arc node (RPC + WS)
→ Postgres 16 + pgvector (future semantic search ready)
→ Next.js 15 + Tailwind v4
→ Drizzle ORM (type-safe queries)
→ SSE live feed via pg_notify
→ nginx + Cloudflare + Let's Encrypt

Open source: github.com/huicom/arc-agents-explorer
```

📎 **Attach:** `arcagents-5-stats.png` (or architecture diagram from README)

---

### Tweet 6 (what's next + CTA)

```
5/ Coming next:
- Agent capability semantic search (pgvector embeddings)
- "Hire this agent" flow (ERC-8183 + USDC escrow)
- Agent-to-agent payment graph
- Thai-language UI 🇹🇭

Feedback very welcome. Built for the community.

@arc @circle — would love your thoughts 🏗️
```

---

### Posting strategy

1. **Best time:** 9-10 AM US ET (10 PM Bangkok) on Tuesday-Thursday
2. **Don't space tweets too far apart** — Twitter penalizes slow threads. Reply within 60 seconds of each other.
3. **First hour is critical** — engage with anyone who replies. Like every reply.
4. **Pin the thread** to your profile for at least 7 days.
5. **Reply to your own thread** later with updates ("just hit X agents tracked", "Arc team retweeted!", etc.)

### Tag carefully

In tweet 4 (the @arc tag) — only tag once. Tagging in every tweet looks desperate.

If you don't get traction in the first 2 hours, **don't delete and re-post**. Twitter sees this as spam. Instead, reply to the thread with the same content rephrased a day later.

---

## Step 7.4 — Arc House Forum Post (YOU, 30 min)

Go to https://community.arc.io → click "New Topic" in the appropriate category (likely "Showcase" or "Builders").

### Title
`I built the first agent explorer for Arc — arcagents.io`

### Body

```markdown
Hey Arc community 👋

I've been heads-down for the past week and just shipped **arcagents.io** — the first agent explorer for Arc Testnet.

## What it does

ArcAgents indexes every ERC-8004 agent on Arc and shows you:

- **Agent profiles** with identity, reputation, capabilities
- **Reputation history** — every feedback event with validator + score
- **Validation status** — KYC, TEE, custom validators
- **ERC-8183 jobs** — full lifecycle from open → funded → submitted → completed
- **USDC accounting** — agent earnings, daily volume, leaderboards
- **Live event stream** — new on-chain activity in real time

## Why I built it

I noticed that [8004scan.io](https://8004scan.io) (the AltLayer-built canonical ERC-8004 explorer) supports 27 chains — but not Arc. So when I registered my own agent on Arc Testnet last week, there was no good way to browse it or discover others.

The agentic economy is being built on Arc. It needs an explorer.

## How it's built

Powered by a self-hosted Arc node running in Bangkok. The full stack:

- **Indexer**: TypeScript + viem WebSocket subscription
- **Database**: Postgres 16 + pgvector (future semantic search)
- **API**: Next.js 15 route handlers + Drizzle ORM
- **Live updates**: Postgres `LISTEN/NOTIFY` → Server-Sent Events
- **Infrastructure**: nginx + systemd + Cloudflare + Let's Encrypt

Everything open-source: https://github.com/huicom/arc-agents-explorer

## What's next

I'm planning these features (in priority order):

1. **Agent capability semantic search** — embed metadata with OpenAI/Voyage, use pgvector cosine similarity. Find agents that can "translate legal documents" not just match keywords.
2. **"Hire this agent" flow** — wallet-connect + ERC-8183 escrow + USDC payment in one button
3. **Agent-to-agent payment graph** — visualize who pays whom on the agentic economy
4. **Thai-language UI** — making this accessible to SEA builders
5. **Arc Mainnet support** — instant migration when mainnet beta lands

## Feedback wanted

I'd love your thoughts on:
- What features would be most useful for your work on Arc?
- Any data points missing that you wish you could see?
- Performance issues on your network?
- Bugs (browser/device please)

## Links

- Live site: https://arcagents.io
- Open agent: https://arcagents.io/agents/14176
- Open job: https://arcagents.io/jobs/20049
- Source code: https://github.com/huicom/arc-agents-explorer
- Twitter thread: [link to your launch thread]

Cheers from Bangkok 🇹🇭
— PokoBlue
```

### After posting

- Cross-link from your Twitter thread ("Posted full write-up on Arc House Forum →")
- Reply to your own forum post with screenshots if the forum supports media
- Subscribe to thread notifications

---

## Step 7.5 — Discord `#showcase` Post (YOU, 10 min)

In the Arc Discord (or wherever the dedicated builder showcase channel is):

```
Built something for the Arc community 🛠️

🌐 **arcagents.io** — The first agent explorer for Arc.

Browse every ERC-8004 agent. See their reputation, validations, jobs, USDC earnings. Live event stream.

Was inspired by 8004scan.io (AltLayer) but they don't support Arc. So I made one for us.

Stack: Self-hosted Arc node + Postgres 16 + Next.js 15 + viem WebSocket → SSE live feed.

🔗 Site: https://arcagents.io
💻 Code: https://github.com/huicom/arc-agents-explorer
📱 Twitter thread: [link]
📝 Forum write-up: [link]

Feedback very welcome 🇹🇭
```

📎 **Attach:** 1-2 screenshots (Discord supports image preview)

---

## Step 7.6 — LinkedIn Post (Optional, 15 min)

For professional reach — especially good if you want this to be visible to Circle/Arc business folks or Asian web3 leaders.

```
🚀 I just shipped arcagents.io — the first agent explorer for Arc, Circle's new institutional Layer-1.

For the past week I've been heads-down building infrastructure for the agentic economy on Arc:

✅ Indexed every ERC-8004 agent on Arc Testnet
✅ Live reputation, validation, and job tracking
✅ Real-time event stream from my self-hosted Arc node
✅ Postgres + pgvector ready for semantic agent search
✅ Open source under MIT

Why?

Arc is a $3B FDV Layer-1 from Circle (a16z, BlackRock, Apollo, ICE backed). It's the only chain where stablecoins are gas, finality is sub-second, and ERC-8004 agents are first-class citizens.

The agentic economy is being built on Arc — but there was no explorer. So I built one.

This is my evening project alongside my data governance role at one of Thailand's largest banks. Bridging enterprise architecture experience with the next wave of crypto-native AI infrastructure.

Live: https://arcagents.io
Code: https://github.com/huicom/arc-agents-explorer

If you're building AI agents, working with stablecoins at scale, or thinking about the future of agentic commerce — would love to compare notes.

#AIAgents #Web3 #ArcNetwork #ERC8004 #Stablecoins #SouthEastAsia
```

---

## Step 7.7 — Email to Circle / Arc team (Optional but Powerful)

If you have an email or DM contact at Circle/Arc, send a personalized note:

```
Subject: Built the first agent explorer for Arc — arcagents.io

Hi [Name],

I'm Theerachai (PokoBlue) from Bangkok. I'm an Enterprise Architect at a major Thai bank and an independent builder on Arc.

Over the past week I built arcagents.io — the first agent explorer for Arc Testnet.

[Brief description, 2-3 sentences]

Since [their reason for caring: 8004scan doesn't support Arc / the agentic economy needs visibility / etc.], I thought it would be useful to the community to have a dedicated explorer for Arc's ERC-8004 deployment.

It's:
- Live at https://arcagents.io
- Open source: https://github.com/huicom/arc-agents-explorer
- Powered by my own Arc node (no public RPC dependency)

I'd love any feedback you have. Particularly:
1. Anything you'd like to see surfaced that's currently missing
2. Whether you'd be open to it being referenced in any Arc developer docs
3. Whether the Arc team would want to integrate this into your DevTooling Stack

Happy to jump on a call any time that works for you in your timezone.

Best,
Theerachai (PokoBlue)
LinkedIn: https://linkedin.com/in/theerachai-aurprasertwong-80035a44/
```

---

## Step 7.8 — Monitor the First 24 Hours (YOU)

### What to watch

| Metric | Tool | Goal |
|---|---|---|
| Site uptime | UptimeRobot | 100% |
| Live SSE connections | `ss -tn state established '( sport = :443 )' \| wc -l` | < 200 simultaneous |
| Postgres connections | `SELECT count(*) FROM pg_stat_activity` | < 80 (default max 100) |
| Indexer freshness | `/api/health` | `ageSeconds < 30` |
| Memory usage | `free -h` | < 80% used |
| Disk usage | `df -h` | < 70% on root |
| Twitter impressions | Twitter analytics | Track every hour |
| Forum + Discord engagement | manual | Respond to every comment within 1 hour |

### Auto-monitor script

Create `~/monitor.sh`:

```bash
#!/usr/bin/env bash
echo "===== $(date) ====="
echo
echo "--- Health ---"
curl -s https://arcagents.io/api/health | jq -r '"Status: \(.status), Indexer age: \(.indexer.ageSeconds)s, DB latency: \(.db.latencyMs)ms"'
echo
echo "--- System ---"
free -h | grep Mem
df -h / | tail -1
echo
echo "--- Services ---"
systemctl is-active arc-agents-web arc-agents-indexer nginx
echo
echo "--- Postgres connections ---"
docker exec arc-pg psql -U postgres -d arc_agents -t -c "SELECT count(*) FROM pg_stat_activity;"
```

Run it every 5 minutes via cron during launch day:
```bash
*/5 * * * * ~/monitor.sh >> ~/launch-day.log 2>&1
```

### Quick fixes if things break

| Problem | One-liner fix |
|---|---|
| Web app crashed | `sudo systemctl restart arc-agents-web` |
| Indexer fell behind | `sudo systemctl restart arc-agents-indexer` |
| Too many DB connections | Increase Postgres pool limit OR restart |
| nginx 502 | `sudo systemctl restart nginx` |
| Out of memory | Check `top`, kill the biggest offender |

---

## Step 7.9 — Day 2 Follow-up Tweets (YOU)

Schedule these for 24-48 hours after launch:

### Stat tweet
```
📊 24 hours since arcagents.io launched:

X visitors • X agents browsed • X live events streamed

Top countries: [list top 3]

Thanks @arc community 🇹🇭
```

### Engagement reply tweet
If anyone of note RT'd or commented:
```
🙏 Honored that [@person] [verb] my build. Their work on [thing] inspired [aspect]. 

If you're here from their feed — agentic economy is just getting started on Arc. Welcome.
```

### Feature tease
```
🛠 Building next: agent capability semantic search.

Type "find me an agent that can summarize legal documents" → get ranked results via pgvector cosine similarity on agent metadata embeddings.

ETA: 1 week. arcagents.io
```

---

## ✅ Phase 7 Definition of Done

- [ ] All 6 screenshots captured + cropped
- [ ] GitHub README polished + screenshots embedded
- [ ] LICENSE file (MIT) added
- [ ] Repo set to public + pinned on profile
- [ ] Twitter thread (6 tweets) published
- [ ] Arc House Forum showcase post published
- [ ] Discord #showcase post made
- [ ] LinkedIn post (optional)
- [ ] Email to Circle/Arc team (optional)
- [ ] Monitor script running every 5 min
- [ ] Responded to every reply/comment within 1 hour for first 24h
- [ ] Pinned launch thread on Twitter for 7 days

---

## 📈 Beyond Launch — Compound Strategy

Don't let the project go quiet after launch. Build in public:

### Week 2
- Ship semantic search → write a thread about the pgvector implementation
- Reply to any Arc community Q&A with "see arcagents.io for X"
- Cross-post weekly stats: agents added, jobs completed, USDC volume

### Week 3
- Ship "Hire this agent" flow → tweet thread on the ERC-8183 UX
- Submit to Arc DevTooling directory / docs reference

### Month 2
- Apply to be an official Arc ecosystem partner
- Reach out to Circle for any grant / paid integration opportunity
- Open Bangkok meetup: "Building on Arc — what I learned shipping ArcAgents"

### Month 3
- Mainnet launch coordination — be first explorer on Arc mainnet
- Mobile app (React Native, same API)
- Public read-only API with rate-limited free tier + paid tier

This is no longer just a side project — it's a positioning move that makes you visible across:
- 🇹🇭 SEA web3 ecosystem
- 🤖 Agentic economy builders
- 💰 Circle / Arc team
- 🏗 ERC-8004 community

Use it as a launchpad for whatever comes next.

---

## 🧠 Reflection

After 7 days, you've shipped:

✅ Verified working ERC-8004 + ERC-8183 demo agent
✅ Production agent explorer for Arc
✅ Self-hosted Arc infrastructure
✅ Public open-source contribution
✅ Built-in-public Twitter presence
✅ Connected to Circle/Arc team

This is the kind of project that compounds. Each week you add a feature, you also build:
- More followers
- More credibility with Arc team
- More chances of being cited in Arc docs / Circle blog
- More signal that you're a serious agentic-economy builder

Atomic habit version: **Ship one improvement per week. Tweet about it. Reply to one community question per day.** Six months from now, you'll have momentum that's hard to replicate.

---

**Next →** Open `08_REFERENCE.md` for contract addresses, common SQL queries, troubleshooting cheatsheet.
