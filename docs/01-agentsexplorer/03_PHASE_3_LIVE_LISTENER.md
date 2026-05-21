# Phase 3 — Live Event Listener + Postgres NOTIFY

> **Goal:** A long-running service subscribed to new Arc blocks via WebSocket. Events arrive in real time, get written to Postgres, and trigger `NOTIFY` so the web app can push them to browsers over WebSocket.

**Estimated time:** 3 hours
**Output:** A systemd service that streams Arc events 24/7.

---

## 🎯 Outcomes of Phase 3

After this phase:

1. ✅ `live.ts` long-running indexer subscribed to `newHeads` via WebSocket
2. ✅ New events written to Postgres within ~2 seconds of being mined
3. ✅ Postgres `NOTIFY` fired so Phase 4 web app can listen
4. ✅ Automatic reconnect with exponential backoff
5. ✅ Catch-up logic when reconnecting (no missed events)
6. ✅ Running as a systemd service with auto-restart

---

## 📋 Pre-Phase Checklist

- [ ] Phase 2 backfill completed
- [ ] Your Arc node exposes WebSocket on `wss://...`
- [ ] `ARC_RPC_WS` is set in `.env`
- [ ] `indexer_state.last_indexed_block` matches current head (within a few blocks)

---

## 🧠 Architecture

```
        ┌──────────────────────┐
        │   Arc Node (WS)      │
        │   newHeads stream    │
        └──────────┬───────────┘
                   │ WebSocket subscription
                   ▼
        ┌──────────────────────────────────────┐
        │       LIVE INDEXER (Node.js)         │
        │                                      │
        │  on newHead:                         │
        │    1. Fetch logs for this block      │
        │    2. Parse + apply (Phase 2 code)   │
        │    3. pg_notify('arc_events', ...)   │
        │                                      │
        │  on disconnect:                      │
        │    - Reconnect with backoff          │
        │    - Catch up missed blocks via      │
        │      eth_getLogs(lastIndexed, head)  │
        └─────────────┬────────────────────────┘
                      │ writes + NOTIFY
                      ▼
              ┌───────────────────┐
              │   Postgres        │
              │   LISTEN/NOTIFY   │
              └─────────┬─────────┘
                        │ pushes
                        ▼
              ┌───────────────────┐
              │   Web app         │
              │   (Phase 4)       │
              └───────────────────┘
```

---

## Step 3.1 — Build the Live Listener (Claude Code, 90 min)

### CLAUDE CODE PROMPT #3.1 — Live listener

> Build the **live event listener** in `apps/indexer/src/live.ts`. This is a long-running service that subscribes to new Arc blocks via WebSocket, processes events immediately, and fires Postgres `NOTIFY` so the web app can push them to browsers.
>
> **Key principles:**
> - Reuse parsers + handlers from Phase 2 (no duplication)
> - Resilient to disconnects (exponential backoff reconnect)
> - On reconnect, catch up missed blocks via `eth_getLogs`
> - Single `pg_notify` per batch with structured JSON payload
>
> ## `lib/notify.ts` — Postgres NOTIFY helper
>
> ```typescript
> import { sql } from '@arc-agents/db';
> import type { ParsedEvent } from './parsers';
> import { logger } from './logger';
>
> const CHANNEL = 'arc_events';
>
> export interface NotifyPayload {
>   blockNumber: string;     // bigint serialized
>   timestamp: number;       // unix ms
>   events: Array<{
>     kind: ParsedEvent['kind'];
>     // discriminated payload depending on kind
>     [key: string]: any;
>   }>;
> }
>
> export async function notifyEvents(blockNumber: bigint, events: ParsedEvent[]): Promise<void> {
>   if (events.length === 0) return;
>
>   const payload: NotifyPayload = {
>     blockNumber: blockNumber.toString(),
>     timestamp: Date.now(),
>     events: events.map(e => {
>       // Convert any BigInt fields to strings for JSON serialization
>       return JSON.parse(JSON.stringify(e, (_, value) =>
>         typeof value === 'bigint' ? value.toString() : value
>       ));
>     }),
>   };
>
>   const json = JSON.stringify(payload);
>
>   // Postgres NOTIFY has 8000-byte payload limit. If too large, send a compact summary.
>   if (json.length > 7000) {
>     const compact = {
>       blockNumber: payload.blockNumber,
>       timestamp: payload.timestamp,
>       eventCount: events.length,
>       eventKinds: [...new Set(events.map(e => e.kind))],
>     };
>     await sql`SELECT pg_notify(${CHANNEL}, ${JSON.stringify(compact)})`;
>     logger.info(`Notify (compact) for block ${blockNumber}: ${events.length} events`);
>   } else {
>     await sql`SELECT pg_notify(${CHANNEL}, ${json})`;
>     logger.info(`Notify for block ${blockNumber}: ${events.length} events`);
>   }
> }
> ```
>
> ## `lib/ws-client.ts` — Robust WebSocket client
>
> Use viem's `webSocket` transport with reconnect logic:
>
> ```typescript
> import { createPublicClient, webSocket } from 'viem';
> import { arcTestnet } from './viem';
> import { config } from './config';
> import { logger } from './logger';
>
> export function createWsClient() {
>   return createPublicClient({
>     chain: arcTestnet,
>     transport: webSocket(config.ARC_RPC_WS, {
>       retryCount: 0,  // we'll handle retries ourselves
>       reconnect: {
>         attempts: 1000,
>         delay: 1000,
>       },
>       keepAlive: { interval: 30_000 },
>     }),
>   });
> }
> ```
>
> ## `src/live.ts` — Main entry point
>
> ```typescript
> import 'dotenv/config';
> import { config } from './lib/config';
> import { publicClient } from './lib/viem';     // HTTP client for getLogs
> import { createWsClient } from './lib/ws-client';
> import { parseLog } from './lib/parsers';
> import { applyEvents } from './lib/handlers';
> import { getLastIndexedBlock, setLastIndexedBlock } from './lib/state';
> import { notifyEvents } from './lib/notify';
> import { fetchTokenURI, fetchMetadataFromUri } from './lib/ipfs';
> import { logger } from './lib/logger';
> import { db, agents } from '@arc-agents/db';
> import { eq } from 'drizzle-orm';
>
> const CONTRACT_ADDRESSES = [
>   config.IDENTITY_REGISTRY,
>   config.REPUTATION_REGISTRY,
>   config.VALIDATION_REGISTRY,
>   config.AGENTIC_COMMERCE,
> ];
>
> // ------------------- Catch-up logic -------------------
> async function catchUpToHead(lastIndexed: bigint, head: bigint): Promise<bigint> {
>   if (lastIndexed >= head) return lastIndexed;
>
>   logger.info(`Catching up: ${lastIndexed + 1n} → ${head}`);
>
>   const BATCH = 1000n;
>   let cursor = lastIndexed;
>
>   while (cursor < head) {
>     const fromBlock = cursor + 1n;
>     const toBlock = fromBlock + BATCH - 1n > head ? head : fromBlock + BATCH - 1n;
>
>     const logs = await publicClient.getLogs({
>       address: CONTRACT_ADDRESSES,
>       fromBlock,
>       toBlock,
>     });
>
>     const events = logs.map(parseLog).filter((e): e is NonNullable<typeof e> => e !== null);
>     await applyEvents(events);
>     if (events.length > 0) {
>       await notifyEvents(toBlock, events);
>     }
>
>     await processNewAgentMetadata(events);
>
>     await setLastIndexedBlock(toBlock);
>     cursor = toBlock;
>     logger.info(`Caught up to block ${toBlock} (${events.length} events)`);
>   }
>
>   return cursor;
> }
>
> async function processNewAgentMetadata(events: ReturnType<typeof parseLog>[]): Promise<void> {
>   const newAgents = events.filter((e): e is NonNullable<typeof e> => e?.kind === 'AgentRegistered');
>   for (const ev of newAgents) {
>     try {
>       const uri = await fetchTokenURI(ev.agentId);
>       if (!uri) continue;
>
>       const metadata = await fetchMetadataFromUri(uri);
>       await db.update(agents).set({
>         metadataUri: uri,
>         metadata: metadata ?? null,
>         name: metadata?.name ?? null,
>         agentType: metadata?.agent_type ?? null,
>         capabilities: metadata?.capabilities ?? null,
>         updatedAt: new Date(),
>       }).where(eq(agents.agentId, ev.agentId));
>     } catch (err) {
>       logger.warn(`Failed to fetch metadata for agent ${ev.agentId}`, err);
>     }
>   }
> }
>
> // ------------------- Block processor -------------------
> async function processBlock(blockNumber: bigint): Promise<void> {
>   try {
>     const logs = await publicClient.getLogs({
>       address: CONTRACT_ADDRESSES,
>       fromBlock: blockNumber,
>       toBlock: blockNumber,
>     });
>
>     const events = logs.map(parseLog).filter((e): e is NonNullable<typeof e> => e !== null);
>
>     if (events.length > 0) {
>       await applyEvents(events);
>       await notifyEvents(blockNumber, events);
>       await processNewAgentMetadata(events);
>       logger.info(`📦 Block ${blockNumber}: ${events.length} events processed`);
>     }
>
>     await setLastIndexedBlock(blockNumber);
>   } catch (err) {
>     logger.error(`Failed to process block ${blockNumber}`, err);
>     throw err;
>   }
> }
>
> // ------------------- Main loop with reconnect -------------------
> async function runLive(): Promise<never> {
>   let attempt = 0;
>
>   while (true) {
>     try {
>       attempt++;
>       logger.info(`🔌 Connecting to WebSocket (attempt ${attempt})...`);
>
>       const wsClient = createWsClient();
>
>       // Catch up first
>       const head = await publicClient.getBlockNumber();
>       const lastIndexed = await getLastIndexedBlock(0n);
>       if (lastIndexed < head) {
>         await catchUpToHead(lastIndexed, head);
>       }
>
>       logger.info('✅ Live subscription active. Watching for new blocks...');
>       attempt = 0;  // reset on successful connect
>
>       // Subscribe to newHeads
>       const unwatch = wsClient.watchBlockNumber({
>         onBlockNumber: async (blockNumber) => {
>           try {
>             // Process every new block we see
>             await processBlock(blockNumber);
>           } catch (err) {
>             logger.error(`Error processing block ${blockNumber}`, err);
>           }
>         },
>         onError: (err) => {
>           logger.error('WebSocket error', err);
>         },
>         poll: false,    // use the WS subscription, not polling
>       });
>
>       // Block forever (until error / disconnect)
>       await new Promise((_, reject) => {
>         // viem will reject the watcher promise on disconnect
>         process.on('SIGINT', () => {
>           unwatch();
>           reject(new Error('SIGINT received'));
>         });
>       });
>     } catch (err) {
>       const delayMs = Math.min(60_000, 1000 * Math.pow(2, attempt));
>       logger.warn(`Disconnected. Reconnecting in ${delayMs}ms...`, err);
>       await new Promise(r => setTimeout(r, delayMs));
>     }
>   }
> }
>
> // ------------------- Entry -------------------
> runLive().catch((err) => {
>   logger.error('Fatal in live loop', err);
>   process.exit(1);
> });
> ```
>
> ## Verification
>
> 1. `pnpm typecheck` must pass
> 2. Confirm `live.ts` imports correctly resolved
> 3. Print file tree for review
>
> Don't run yet — I want to test it interactively first.

---

## Step 3.2 — Test the Live Listener (YOU, 30 min)

### Test 1 — Start it locally

```bash
cd ~/arc-agents-explorer

# Run in foreground first to see logs
pnpm dev:indexer:live
```

Expected output:
```
[INFO] 🔌 Connecting to WebSocket (attempt 1)...
[INFO] Catching up: 5234100 → 5234210
[INFO] ✅ Live subscription active. Watching for new blocks...
[INFO] 📦 Block 5234211: 0 events processed   ← (only printed when events exist)
```

### Test 2 — Trigger a new event from your demo project

Open a new terminal:

```bash
cd ~/arc-agent-demo

# Register a new agent (creates new on-chain activity)
npm run register
```

Within ~2 seconds of the registration tx confirming, your live listener should print:
```
[INFO] 📦 Block <N>: 1 events processed
[INFO] Notify for block <N>: 1 events
```

### Test 3 — Verify NOTIFY fires

In a third terminal:

```bash
docker exec -it arc-pg psql -U postgres -d arc_agents
```

```sql
LISTEN arc_events;
```

(Keep this `psql` session open.)

Now trigger another on-chain event:

```bash
cd ~/arc-agent-demo
npm run register   # creates new agent + reputation events
```

Within seconds, the `psql` terminal should print:
```
Asynchronous notification "arc_events" with payload "{...}" received from server process with PID NNNN.
```

✅ This confirms the NOTIFY → LISTEN pipeline works.

Type `\q` to exit psql when done testing.

---

## Step 3.3 — Install as systemd Service (YOU, 30 min)

### YOU: Build production-ready dist

```bash
cd ~/arc-agents-explorer
pnpm build:indexer
```

This compiles TS → JS in `apps/indexer/dist/`.

### YOU: Create systemd service file

```bash
sudo nano /etc/systemd/system/arc-agents-indexer.service
```

Paste this (adjust `User` and paths to match your setup):

```ini
[Unit]
Description=ArcAgents Live Indexer
After=network-online.target docker.service postgresql.service
Wants=network-online.target

[Service]
Type=simple
User=huicom
WorkingDirectory=/home/huicom/arc-agents-explorer

# Read env from .env
EnvironmentFile=/home/huicom/arc-agents-explorer/.env

# Use pnpm to start
ExecStart=/usr/bin/pnpm start:indexer:live

# Restart policy
Restart=always
RestartSec=10s
StartLimitIntervalSec=300
StartLimitBurst=5

# Logging
StandardOutput=append:/var/log/arc-indexer.log
StandardError=append:/var/log/arc-indexer-err.log

# Hardening
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

### YOU: Create log files with correct permissions

```bash
sudo touch /var/log/arc-indexer.log /var/log/arc-indexer-err.log
sudo chown huicom:huicom /var/log/arc-indexer*.log
```

### YOU: Enable and start

```bash
sudo systemctl daemon-reload
sudo systemctl enable arc-agents-indexer
sudo systemctl start arc-agents-indexer

# Check status
sudo systemctl status arc-agents-indexer

# Watch logs
tail -f /var/log/arc-indexer.log
```

✅ Status should show `active (running)`.

### YOU: Test auto-restart

```bash
# Find the PID
sudo systemctl status arc-agents-indexer | grep PID

# Kill it
sudo kill -9 <PID>

# Wait 10 seconds
sleep 11

# Check status — should be running again
sudo systemctl status arc-agents-indexer
```

✅ If it auto-restarted, systemd is configured correctly.

---

## Step 3.4 — Set Up Log Rotation (YOU, 10 min)

Without rotation, `/var/log/arc-indexer.log` will fill the disk over time.

```bash
sudo nano /etc/logrotate.d/arc-agents
```

Paste:

```
/var/log/arc-indexer.log
/var/log/arc-indexer-err.log
{
    daily
    rotate 14
    compress
    delaycompress
    missingok
    notifempty
    create 0644 huicom huicom
    postrotate
        systemctl reload arc-agents-indexer > /dev/null 2>&1 || true
    endscript
}
```

Test the config:
```bash
sudo logrotate -d /etc/logrotate.d/arc-agents
```

---

## ✅ Phase 3 Definition of Done

- [ ] `pnpm dev:indexer:live` runs and catches up to head
- [ ] New on-chain events appear in Postgres within ~5 seconds
- [ ] `pg_notify` fires with valid JSON payload
- [ ] `LISTEN arc_events` in psql receives notifications
- [ ] WebSocket reconnects gracefully after disconnect (test: `sudo systemctl restart <your-node-service>`)
- [ ] Catch-up logic works (no missed events after reconnect)
- [ ] systemd service auto-starts on boot (`sudo reboot` and verify)
- [ ] systemd service auto-restarts on crash
- [ ] Log rotation configured
- [ ] Committed to Git

### Git commit

```bash
cd ~/arc-agents-explorer
git add .
git commit -m "feat: live event listener with Postgres NOTIFY (Phase 3)

- WebSocket subscription to Arc node via viem.watchBlockNumber
- Catches up missed blocks on (re)connect via eth_getLogs
- Exponential backoff reconnect (max 60s)
- Postgres pg_notify on arc_events channel for live updates
- Compact payload fallback if NOTIFY size exceeds 7KB
- systemd service for 24/7 operation
- Log rotation configured"
git push
```

---

## 🔥 Common Issues & Fixes

### Live listener never sees new blocks
- Confirm `ARC_RPC_WS` uses `wss://` not `https://`
- Test the WS endpoint manually: `wscat -c $ARC_RPC_WS` then send `{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}`
- Check your nginx exposes WebSocket upgrade headers (see Phase 6)

### "NOTIFY payload too large" errors
The 8000-byte limit was hit. The code handles this with a compact payload — but check the warning logs.

### High CPU usage
You may be processing too many empty blocks. Confirm `processBlock` returns early when no relevant logs exist.

### systemd service won't start
```bash
sudo journalctl -u arc-agents-indexer -n 50
```
Common causes:
- Wrong path to `pnpm` — use `which pnpm` and update `ExecStart`
- `.env` not readable by `huicom` — `chmod 600 .env`
- Working directory has bad permissions

### Indexer falls behind during congestion
Increase parallel processing by:
1. Splitting receive into a queue
2. Processing blocks in parallel (be careful with order!)
3. Or just scale up your Arc node — more RAM helps Reth's caches

---

**Next →** Open `04_PHASE_4_API.md` to build the type-safe API layer that consumes this data.
