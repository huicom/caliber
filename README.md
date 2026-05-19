# ArcAgents Explorer

Monorepo for the ArcAgents agent explorer and rating service — tracking every ERC-8004 AI agent on Arc Network.

## Structure

| Directory | Purpose |
|-----------|---------|
| `indexer/arc/` | Arc testnet event indexer — backfill + live WebSocket listener |
| `indexer/base/` | Base chain placeholder (future ERC-8004 support) |
| `indexer/shared/` | Chain-agnostic types and chain configuration registry |
| `rating/` | Agent credit rating engine (PD/LGD/EAD → tier) — built this week |
| `web/` | Next.js 15 frontend — live at [arcagents.poko.blue](https://arcagents.poko.blue) |
| `packages/db/` | Shared Drizzle ORM schema, migrations, DB client |
| `docs/` | Implementation docs and methodology |
| `deploy/` | systemd services, nginx config, deployment scripts |

## Quick Start

See `docs/00_README.md` for full setup.

## License

MIT — built solo from Bangkok 🇹🇭 by PokoBlue.
