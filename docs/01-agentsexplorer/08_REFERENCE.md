# Reference — Contracts, ABIs, Queries, Troubleshooting

> Quick-reference doc for everything you'll need to look up while building or debugging ArcAgents Explorer.

---

## 🔗 Arc Testnet Constants

### Network info
```
Chain name:    Arc Testnet
Chain ID:      5042002
Native token:  USDC (6 decimals)
RPC HTTP:      https://rpc.testnet.arc.network    (public, rate-limited)
RPC WS:        wss://rpc.testnet.arc.network      (public, rate-limited)
Block time:    ~1 second
Block explorer: https://testnet.arcscan.app
Faucet:        https://faucet.testnet.arc.network
```

### Contract addresses (Arc Testnet)
```
IdentityRegistry      0x8004A818BFB912233c491871b3d84c89A494BD9e
ReputationRegistry    0x8004B663056A597Dffe9eCcC1965A193B7388713
ValidationRegistry    0x8004Cb1BF31DAf7788923b405b754f57acEB4272
AgenticCommerce       0x0747EEf0706327138c69792bF28Cd525089e4583
USDC                  0x3600000000000000000000000000000000000000
```

> ⚠️ These differ from ERC-8004 deployments on other chains. 8004scan.io uses `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` — that's the wrong address for Arc.

### Your own resources (PokoBlue)
```
Agent ID:           14176 (and 14167)
Owner wallet:       0x3fc25c9345494160fca2d1229eb5eb7b34694cf5
Validator wallet:   0x2bcff76a35d6be57bdc9aa49c09439fdb2f9d916
Job ID:             20049 (and 20022)
Demo repo:          https://github.com/huicom/arc_translation_agent
```

---

## 📋 Event Signatures Reference

### IdentityRegistry events

```solidity
// ERC-721 standard — new agent = mint
event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
//   topic[0]: keccak256("Transfer(address,address,uint256)")
//          = 0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef
//   topic[1]: from (zero-padded address)
//   topic[2]: to (zero-padded address)
//   topic[3]: tokenId (uint256)
//   data: (empty for indexed-only events)

// URI update
event MetadataUpdate(uint256 indexed _tokenId);
```

### ReputationRegistry events

```solidity
event FeedbackGiven(
    uint256 indexed agentId,
    address indexed validator,
    int128 score,
    uint8 scoreType,
    string tag,
    string filename,
    string fileURL,
    string fileType,
    bytes32 feedbackHash
);
```

### ValidationRegistry events

```solidity
event ValidationRequested(
    bytes32 indexed requestHash,
    address indexed validator,
    uint256 indexed agentId,
    string requestURI
);

event ValidationResponded(
    bytes32 indexed requestHash,
    uint8 response,           // 100 = passed in spec convention
    string responseURI,
    bytes32 responseHash,
    string tag
);
```

### AgenticCommerce events (ERC-8183)

```solidity
event JobCreated(
    uint256 indexed jobId,
    address indexed client,
    address indexed provider,
    address evaluator,
    uint256 expiredAt,
    string description
);

event BudgetSet(uint256 indexed jobId, uint256 amount);
event JobFunded(uint256 indexed jobId);
event JobSubmitted(uint256 indexed jobId, bytes32 deliverableHash);
event JobCompleted(uint256 indexed jobId, bytes32 reasonHash);
event JobRejected(uint256 indexed jobId, bytes32 reasonHash);
```

> ⚠️ **If event signatures don't match what arcscan shows:** Use arcscan's "Topics" tab on a known transaction to extract the real event signature, then update `apps/indexer/src/lib/abis.ts`.

---

## 📄 ABI Snippets (viem-ready)

### IdentityRegistry minimal ABI

```typescript
export const IDENTITY_ABI = [
  {
    type: 'event',
    name: 'Transfer',
    inputs: [
      { name: 'from', type: 'address', indexed: true },
      { name: 'to', type: 'address', indexed: true },
      { name: 'tokenId', type: 'uint256', indexed: true },
    ],
  },
  {
    type: 'function',
    name: 'tokenURI',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'ownerOf',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ type: 'address' }],
    stateMutability: 'view',
  },
] as const;
```

### ReputationRegistry minimal ABI

```typescript
export const REPUTATION_ABI = [
  {
    type: 'event',
    name: 'FeedbackGiven',
    inputs: [
      { name: 'agentId', type: 'uint256', indexed: true },
      { name: 'validator', type: 'address', indexed: true },
      { name: 'score', type: 'int128', indexed: false },
      { name: 'scoreType', type: 'uint8', indexed: false },
      { name: 'tag', type: 'string', indexed: false },
      { name: 'filename', type: 'string', indexed: false },
      { name: 'fileURL', type: 'string', indexed: false },
      { name: 'fileType', type: 'string', indexed: false },
      { name: 'feedbackHash', type: 'bytes32', indexed: false },
    ],
  },
  {
    type: 'function',
    name: 'getSummary',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [
      { name: 'averageScore', type: 'int128' },
      { name: 'totalFeedback', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
] as const;
```

### ValidationRegistry minimal ABI

```typescript
export const VALIDATION_ABI = [
  {
    type: 'event',
    name: 'ValidationRequested',
    inputs: [
      { name: 'requestHash', type: 'bytes32', indexed: true },
      { name: 'validator', type: 'address', indexed: true },
      { name: 'agentId', type: 'uint256', indexed: true },
      { name: 'requestURI', type: 'string', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'ValidationResponded',
    inputs: [
      { name: 'requestHash', type: 'bytes32', indexed: true },
      { name: 'response', type: 'uint8', indexed: false },
      { name: 'responseURI', type: 'string', indexed: false },
      { name: 'responseHash', type: 'bytes32', indexed: false },
      { name: 'tag', type: 'string', indexed: false },
    ],
  },
] as const;
```

### AgenticCommerce minimal ABI

```typescript
export const AGENTIC_COMMERCE_ABI = [
  {
    type: 'event',
    name: 'JobCreated',
    inputs: [
      { name: 'jobId', type: 'uint256', indexed: true },
      { name: 'client', type: 'address', indexed: true },
      { name: 'provider', type: 'address', indexed: true },
      { name: 'evaluator', type: 'address', indexed: false },
      { name: 'expiredAt', type: 'uint256', indexed: false },
      { name: 'description', type: 'string', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'BudgetSet',
    inputs: [
      { name: 'jobId', type: 'uint256', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'JobFunded',
    inputs: [{ name: 'jobId', type: 'uint256', indexed: true }],
  },
  {
    type: 'event',
    name: 'JobSubmitted',
    inputs: [
      { name: 'jobId', type: 'uint256', indexed: true },
      { name: 'deliverableHash', type: 'bytes32', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'JobCompleted',
    inputs: [
      { name: 'jobId', type: 'uint256', indexed: true },
      { name: 'reasonHash', type: 'bytes32', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'JobRejected',
    inputs: [
      { name: 'jobId', type: 'uint256', indexed: true },
      { name: 'reasonHash', type: 'bytes32', indexed: false },
    ],
  },
] as const;
```

---

## 🗃 Common SQL Queries

### Connect to DB

```bash
docker exec -it arc-pg psql -U postgres -d arc_agents
```

### Health checks

```sql
-- How many of each entity?
SELECT
  (SELECT COUNT(*) FROM agents) AS agents,
  (SELECT COUNT(*) FROM feedback_events) AS feedback,
  (SELECT COUNT(*) FROM validations) AS validations,
  (SELECT COUNT(*) FROM jobs) AS jobs,
  (SELECT COUNT(*) FROM job_events) AS job_events;

-- Indexer freshness
SELECT key, value, updated_at, NOW() - updated_at AS age
FROM indexer_state;

-- Last 10 indexed blocks (by tx_hash creation)
SELECT block_number, COUNT(*) AS event_count, MAX(created_at) AS last_seen
FROM (
  SELECT registered_at_block AS block_number, created_at FROM agents
  UNION ALL SELECT block_number, created_at FROM feedback_events
  UNION ALL SELECT block_number, created_at FROM job_events
) AS all_events
GROUP BY 1
ORDER BY 1 DESC
LIMIT 10;
```

### Agent queries

```sql
-- Find my agent
SELECT agent_id, name, owner_address, reputation_score, validation_status,
       jobs_completed, usdc_earned, registered_at_block
FROM agents
WHERE agent_id = 14176;

-- Top 10 agents by reputation
SELECT agent_id, name, reputation_score, feedback_count, jobs_completed, usdc_earned
FROM agents
WHERE reputation_score IS NOT NULL
ORDER BY reputation_score DESC NULLS LAST
LIMIT 10;

-- Agents with KYC validation
SELECT agent_id, name, validation_status
FROM agents
WHERE validation_status = 'PASSED'
ORDER BY agent_id DESC;

-- Agents by owner
SELECT agent_id, name, registered_at_block
FROM agents
WHERE LOWER(owner_address) = LOWER('0x3fc25c9345494160fca2d1229eb5eb7b34694cf5');

-- Agents with a specific capability (JSONB array contains)
SELECT agent_id, name, capabilities
FROM agents
WHERE capabilities @> '["english_to_thai_translation"]'::jsonb;

-- Agents whose metadata contains a keyword (FTS)
SELECT agent_id, name, agent_type
FROM agents
WHERE name ILIKE '%translation%' OR agent_type ILIKE '%translation%';
```

### Job queries

```sql
-- Find my job
SELECT job_id, status, budget_usdc, provider_address, description,
       created_at_block, completed_at_block
FROM jobs
WHERE job_id = 20049;

-- Job timeline
SELECT event_type, actor_address, block_number, tx_hash, data, created_at
FROM job_events
WHERE job_id = 20049
ORDER BY block_number ASC, log_index ASC;

-- All completed jobs in last 24h
SELECT job_id, budget_usdc, provider_address, completed_at_block
FROM jobs
WHERE status = 'Completed' AND created_at > NOW() - INTERVAL '24 hours'
ORDER BY completed_at_block DESC;

-- Top-paying clients
SELECT client_address,
       COUNT(*) AS jobs_created,
       SUM(budget_usdc) AS total_paid
FROM jobs
WHERE status = 'Completed'
GROUP BY client_address
ORDER BY total_paid DESC NULLS LAST
LIMIT 10;

-- Top-earning providers
SELECT provider_address,
       COUNT(*) AS jobs_completed,
       SUM(budget_usdc) AS total_earned
FROM jobs
WHERE status = 'Completed'
GROUP BY provider_address
ORDER BY total_earned DESC NULLS LAST
LIMIT 10;
```

### Time-series

```sql
-- Daily agent registrations (last 30 days)
SELECT DATE(created_at) AS day, COUNT(*) AS new_agents
FROM agents
WHERE created_at > NOW() - INTERVAL '30 days'
GROUP BY 1
ORDER BY 1;

-- Daily USDC volume (completed jobs)
SELECT DATE(completed_at_block) AS day, SUM(budget_usdc) AS volume
FROM jobs
WHERE status = 'Completed'
GROUP BY 1
ORDER BY 1 DESC
LIMIT 30;

-- Hourly activity (rolling 7 days)
SELECT DATE_TRUNC('hour', created_at) AS hour, COUNT(*) AS event_count
FROM job_events
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY 1
ORDER BY 1;
```

### Maintenance

```sql
-- Vacuum + analyze for performance
VACUUM ANALYZE agents;
VACUUM ANALYZE feedback_events;
VACUUM ANALYZE jobs;
VACUUM ANALYZE job_events;

-- Table sizes
SELECT
  schemaname || '.' || tablename AS table_name,
  pg_size_pretty(pg_total_relation_size(schemaname || '.' || tablename)) AS total_size,
  pg_size_pretty(pg_relation_size(schemaname || '.' || tablename)) AS table_size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname || '.' || tablename) DESC;

-- Index usage
SELECT indexrelname, idx_scan, idx_tup_read
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
ORDER BY idx_scan DESC;

-- Reset indexer to re-process from a block (be careful)
UPDATE indexer_state SET value = '5000000' WHERE key = 'last_indexed_block';
```

---

## 🩺 Troubleshooting Cheatsheet

### Service issues

| Symptom | Check | Fix |
|---|---|---|
| `arc-agents-web` won't start | `sudo journalctl -u arc-agents-web -n 50` | Usually port conflict or missing build |
| `arc-agents-indexer` keeps restarting | `tail -f /var/log/arc-indexer-err.log` | Check WS connection / DB connectivity |
| nginx returns 502 | `sudo systemctl status arc-agents-web` | Restart web service |
| nginx returns 522 (Cloudflare) | VPS firewall blocking | `sudo ufw allow 443/tcp` |

### Database issues

| Symptom | Check | Fix |
|---|---|---|
| "too many connections" | `SELECT count(*) FROM pg_stat_activity` | Increase `max_connections` in postgres.conf, or reduce pool size in code |
| Slow queries | `EXPLAIN ANALYZE SELECT ...` | Verify indexes are being used; run VACUUM ANALYZE |
| pgvector "type vector does not exist" | `\dx` to check extensions | Run `CREATE EXTENSION vector;` |
| Disk filling up | `du -sh ~/arc-pg-data` | Vacuum unused space, or migrate old data |

### Indexer issues

| Symptom | Check | Fix |
|---|---|---|
| Indexer falls behind | `/api/health` shows high `ageSeconds` | Restart, increase parallelism |
| "no event signatures match" | Verify ABIs match arcscan | Update `lib/abis.ts` |
| IPFS timeouts | Check gateway latency | Switch gateway or accept null metadata |
| WS disconnects frequently | Check Arc node logs | Restart Arc node, check network |

### Frontend issues

| Symptom | Check | Fix |
|---|---|---|
| SSE drops every 60s | nginx config | Set `proxy_read_timeout 24h` on /api/live |
| Hydration errors | Browser console | Wrap dynamic content in `<Suspense>` |
| Build fails OOM | `pnpm build` exit code | `NODE_OPTIONS="--max-old-space-size=2048" pnpm build` |
| 500 on API routes | `journalctl -u arc-agents-web` | Usually DB connection or env var missing |

### Deploy issues

| Symptom | Check | Fix |
|---|---|---|
| SSL cert won't renew | `sudo certbot renew --dry-run` | Disable Cloudflare proxy during renewal |
| Cron job not running | `crontab -l` + `/var/log/syslog` | Check user has crontab permission |
| Log rotation not working | `sudo logrotate -d /etc/logrotate.d/arc-agents` | Fix syntax in logrotate config |

---

## 🛠 Useful Commands Cheatsheet

### Quick operations

```bash
# Reload everything
sudo systemctl restart arc-agents-web arc-agents-indexer nginx

# Tail all logs
sudo journalctl -u arc-agents-web -u arc-agents-indexer -f

# Hot deploy from laptop
git push && ssh huicom@vps "cd ~/arc-agents-explorer && ./deploy/deploy.sh"

# Reset Postgres (DANGEROUS — wipes all data)
docker stop arc-pg
docker rm arc-pg
rm -rf ~/arc-pg-data
# Then re-run docker run command + pnpm db:migrate + pnpm dev:indexer:backfill

# Force re-index from a specific block
docker exec -it arc-pg psql -U postgres -d arc_agents -c \
  "UPDATE indexer_state SET value = '5000000' WHERE key = 'last_indexed_block';"
sudo systemctl restart arc-agents-indexer

# Check Postgres connections
docker exec arc-pg psql -U postgres -d arc_agents -c \
  "SELECT count(*), state FROM pg_stat_activity GROUP BY state;"

# Tail nginx access log filtered to API calls
sudo tail -f /var/log/nginx/arcagents-access.log | grep '/api/'

# Top processes by memory
ps aux --sort=-%mem | head -10

# Disk usage by directory
du -sh /home/huicom/* | sort -h
```

### Test API quickly

```bash
# Health
curl -s https://arcagents.io/api/health | jq

# Live feed (Ctrl+C to stop)
curl -N https://arcagents.io/api/live

# Stats
curl -s https://arcagents.io/api/stats | jq '.totals'

# My agent
curl -s https://arcagents.io/api/agents/14176 | jq '.agent.reputationScore'
```

### Debug a specific tx

```bash
# Replace with actual tx hash
curl -s -X POST https://rpc.testnet.arc.network \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","method":"eth_getTransactionReceipt","params":["0x..."],"id":1}' \
  | jq '.result.logs'
```

---

## 📚 External Resources

### Documentation
- **Arc**: https://docs.arc.network
- **Arc Token Whitepaper**: https://www.arc.network/arc-token-whitepaper
- **ERC-8004 spec**: https://eips.ethereum.org/EIPS/eip-8004
- **ERC-8004 contracts**: https://github.com/erc-8004/erc-8004-contracts
- **Awesome ERC-8004**: https://github.com/sudeepb02/awesome-erc8004

### Tools
- **arcscan testnet**: https://testnet.arcscan.app
- **arcscan API** (if available): Check arcscan footer
- **Drizzle ORM docs**: https://orm.drizzle.team
- **viem docs**: https://viem.sh
- **Next.js 15 docs**: https://nextjs.org/docs
- **shadcn/ui**: https://ui.shadcn.com

### Community
- **Arc Discord**: https://discord.gg/buildonarc
- **Arc House Forum**: https://community.arc.io
- **8004scan Telegram**: https://t.me/ERC8004
- **Circle Twitter**: @circle
- **Arc Twitter**: @arc

### Comparisons
- **8004scan.io** — primary ERC-8004 explorer (AltLayer), 27 chains, not Arc
- **agentscan.info** — alternative explorer
- **erc-8004-explorer.vercel.app** — third option

---

## 🎯 Quick Reference Card

Print this and stick it on your wall:

```
┌─────────────────────────────────────────────────────────────┐
│  ARCAGENTS QUICK REFERENCE                                  │
├─────────────────────────────────────────────────────────────┤
│  URLs                                                       │
│    Site:        https://arcagents.io                        │
│    GitHub:      huicom/arc-agents-explorer                  │
│    Health:      /api/health                                 │
│    My Agent:    /agents/14176                               │
│    My Job:      /jobs/20049                                 │
├─────────────────────────────────────────────────────────────┤
│  Deploy                                                     │
│    git push && ssh vps "./deploy/deploy.sh"                 │
├─────────────────────────────────────────────────────────────┤
│  Restart                                                    │
│    sudo systemctl restart arc-agents-{web,indexer}          │
├─────────────────────────────────────────────────────────────┤
│  Logs                                                       │
│    journalctl -u arc-agents-{web,indexer} -f                │
├─────────────────────────────────────────────────────────────┤
│  Database                                                   │
│    docker exec -it arc-pg psql -U postgres -d arc_agents    │
├─────────────────────────────────────────────────────────────┤
│  Arc Testnet                                                │
│    Chain ID:    5042002                                     │
│    Block time:  ~1s                                         │
│    USDC:        0x3600...0000                               │
└─────────────────────────────────────────────────────────────┘
```

---

**You now have everything you need. Go build.**
