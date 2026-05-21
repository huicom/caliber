# ArcAgents Explorer — Implementation Documentation

> **The first agent explorer for Arc.** Browse every AI agent registered on Arc Testnet, see their reputation, validations, completed jobs, and USDC earnings — all in one place.

---

## 📦 Project Overview

| | |
|---|---|
| **Project codename** | `arcagents` |
| **Target domain** | `arcagents.io` |
| **Author** | PokoBlue (Bangkok 🇹🇭) |
| **GitHub** | `huicom/arc-agents-explorer` |
| **Timeline** | 7 days to public MVP |

## 🎯 What We're Building

A public web app that:

1. **Lists every ERC-8004 agent** registered on Arc testnet
2. **Shows agent details:** identity, reputation, validations, jobs, USDC earned
3. **Lists every ERC-8183 job** with status, parties, and timeline
4. **Streams live events** via WebSocket (new agents, feedback, jobs)
5. **Provides analytics:** leaderboards, time-series charts, top earners

## 🥊 Competitive Moat

- **Self-hosted Arc node** — unlimited query throughput, no rate limits
- **First-mover** — no other Arc agent explorer exists (8004scan supports 27 chains, but NOT Arc)
- **Postgres + pgvector ready** — future-proof for semantic search and AI features

---

## 🗂 Documentation Structure

Read these in order — each phase builds on the previous one.

| File | Phase | Time | What it covers |
|---|---|---|---|
| `00_README.md` | Overview | — | This file |
| `01_PHASE_1_FOUNDATION.md` | Foundation & Schema | Day 1 (~3h) | Postgres setup, Drizzle ORM, schema design |
| `02_PHASE_2_BACKFILL.md` | Historical Backfill | Day 2 (~4h) | Index all past on-chain events |
| `03_PHASE_3_LIVE_LISTENER.md` | Live Listener | Day 3 (~3h) | WebSocket + Postgres NOTIFY |
| `04_PHASE_4_API.md` | API Layer | Day 4 (~4h) | Next.js API routes + Zod validation |
| `05_PHASE_5_FRONTEND.md` | Frontend UI | Day 5 (~6h) | Pages, components, design system |
| `06_PHASE_6_DEPLOY.md` | Deploy & Launch | Day 6 (~3h) | nginx, systemd, SSL, Cloudflare |
| `07_PHASE_7_LAUNCH.md` | Content & Launch | Day 7 (~2h) | Twitter, Arc House, Discord |
| `08_REFERENCE.md` | Reference | — | Contracts, ABIs, RPCs, common queries |

---

## 🧱 Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Arc Testnet                            │
│  (IdentityRegistry / ReputationRegistry / ValidationReg /   │
│   AgenticCommerce / USDC contracts)                         │
└──────────────────────────┬──────────────────────────────────┘
                           │ JSON-RPC + WebSocket
                           ▼
┌─────────────────────────────────────────────────────────────┐
│              YOUR ARC NODE (Bangkok VPS)                    │
│  Reth (execution) + Malachite (consensus)                   │
│  https://arc-rpc.yourdomain.com  +  wss://...               │
└──────────────────────────┬──────────────────────────────────┘
                           │
        ┌──────────────────┼──────────────────┐
        ▼                                     ▼
┌────────────────────┐              ┌────────────────────┐
│  INDEXER SERVICE   │              │  WEB APP (Next.js) │
│  (backfill + live) │   reads      │  - API routes      │
│  - viem WS sub     │ ◄────────────┤  - SSR pages       │
│  - decodes events  │              │  - WebSocket /live │
│  - writes Postgres │              └────────────────────┘
└─────────┬──────────┘                       ▲
          │ writes                           │ reads
          ▼                                  │
┌──────────────────────────────────────────────────────────┐
│        POSTGRES 16 + pgvector (Docker)                   │
│  Tables: agents, feedback_events, validations,           │
│          jobs, job_events, indexer_state                 │
│  LISTEN/NOTIFY → pushes live events to web app           │
└──────────────────────────────────────────────────────────┘
                              ▲
                              │ public HTTPS
                              │
┌──────────────────────────────────────────────────────────┐
│   nginx (reverse proxy) + Let's Encrypt SSL              │
│   arcagents.io → :3000 (Next.js)                         │
│   /api/live → WebSocket upgrade                          │
└──────────────────────────────────────────────────────────┘
                              ▲
                              │
                       Cloudflare DNS + DDoS
                              ▲
                              │
                         Public Internet
```

---

## 📋 Prerequisites (Verify Before Starting)

Tick these before starting Phase 1:

- [ ] Arc node is fully synced and exposing RPC publicly (e.g. `https://arc-rpc.yourdomain.com`)
- [ ] WebSocket RPC also exposed (e.g. `wss://arc-rpc.yourdomain.com`)
- [ ] VPS has at least **16 GB RAM** (confirmed)
- [ ] Domain reserved (e.g. `arcagents.io`)
- [ ] Cloudflare account ready for DNS
- [ ] GitHub repo created: `huicom/arc-agents-explorer`
- [ ] Plant-the-flag tweet posted (signals intent publicly)
- [ ] Docker installed on VPS (`docker --version`)
- [ ] Node.js 22+ installed (`node --version`)
- [ ] pnpm installed (`pnpm --version`)
- [ ] Claude Code installed and working

---

## ⚙️ Tech Stack Summary

### Runtime
- **Node.js** 22 LTS
- **pnpm** for monorepo workspaces
- **TypeScript** strict mode

### Backend
- **Postgres** 16 with `pgvector` extension (single Docker container)
- **Drizzle ORM** — type-safe queries
- **viem** — Ethereum/EVM client
- **postgres** npm package (driver) — for Postgres LISTEN/NOTIFY

### Frontend
- **Next.js 15** App Router
- **React 19**
- **Tailwind CSS v4**
- **shadcn/ui** components
- **lucide-react** icons
- **recharts** for analytics charts
- **sonner** for toasts

### Infrastructure
- **nginx** reverse proxy
- **certbot** Let's Encrypt SSL
- **systemd** for service management
- **Cloudflare** DNS + DDoS protection
- **UptimeRobot** free monitoring

---

## 🎬 Quick Start

```bash
# 1. Clone (after creating)
git clone git@github.com:huicom/arc-agents-explorer.git
cd arc-agents-explorer

# 2. Install
pnpm install

# 3. Start Postgres
docker run -d --name arc-pg \
  -e POSTGRES_PASSWORD=arcdev \
  -e POSTGRES_DB=arc_agents \
  -p 5432:5432 \
  -v ~/arc-pg-data:/var/lib/postgresql/data \
  pgvector/pgvector:pg16

# 4. Configure env
cp .env.example .env
# Edit: DATABASE_URL, ARC_RPC_URL, ARC_RPC_WS

# 5. Migrate schema
pnpm db:migrate

# 6. Backfill historical data
pnpm dev:indexer:backfill

# 7. Start live indexer (separate terminal)
pnpm dev:indexer:live

# 8. Start web (separate terminal)
pnpm dev:web

# Visit http://localhost:3000
```

---

## 🚦 Definition of Done — MVP Launch

The MVP is ready to launch publicly when ALL of these are true:

- [ ] Homepage loads in <2s
- [ ] `/agents` lists all agents with sort + filter
- [ ] `/agents/[id]` shows full detail for your own agent (#14176)
- [ ] `/jobs` lists all jobs with status filter
- [ ] `/live` streams real-time events via WebSocket
- [ ] `/stats` shows accurate counts and charts
- [ ] Mobile responsive (test on real phone)
- [ ] HTTPS works at `https://arcagents.io`
- [ ] `/api/health` returns 200 OK
- [ ] Indexer running as systemd service with auto-restart
- [ ] UptimeRobot monitoring active
- [ ] README in GitHub repo is polished
- [ ] Launch Twitter thread drafted

---

## 🔮 Roadmap (Post-MVP)

These are NOT for the first 7 days, but Postgres + pgvector make them trivial later:

| Feature | Effort |
|---|---|
| Semantic agent search ("find agents that can do legal translation") | 1 day |
| ERC-8183 "Hire This Agent" button + flow | 2 days |
| Agent-to-agent payment graph visualization | 2 days |
| Multi-language UI (start with Thai) | 1 day |
| Mobile app (React Native) | 1 week |
| Agent badges/reputation NFTs | 3 days |
| Public API with rate limits + API keys | 2 days |
| Telegram bot for alerts ("notify me when this agent completes a job") | 1 day |

---

## 📞 Help When Stuck

If you hit a blocker:

1. **Check `08_REFERENCE.md`** — most contract addresses, ABIs, queries are documented there
2. **Check Arc docs** — https://docs.arc.io
3. **Check arcscan** — https://testnet.arcscan.app (for tx debugging)
4. **Re-prompt Claude Code** with full error output + the relevant phase file pasted in

---

## 📝 License

MIT — feel free to fork, learn from, or contribute back.

Built solo from Bangkok 🇹🇭 by **PokoBlue**.

---

**Next →** Open `01_PHASE_1_FOUNDATION.md` to begin.
