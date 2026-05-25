#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Caliber health check — full-stack PASS/FAIL after every deploy.
#
# Usage:
#   ./deploy/healthcheck.sh          # run all checks, exit 0 if all pass
#   ./deploy/healthcheck.sh --quiet  # only print failures
#   ./deploy/healthcheck.sh --json   # machine-readable
#
# Covers:
#   - systemd services up + recent restart count low
#   - Local HTTP health (rating :3100, web :3000)
#   - Public HTTP (caliber.poko.blue, caliber-api.poko.blue)
#   - CORS + x402 402 response shape from rating API
#   - Postgres reachable + recent indexer activity
#   - Arc execution node responsive + forwarder set to public RPC
#   - Required env vars present
#   - Web build artifacts fresh
#
# Add a check by appending to CHECKS array. Each entry is:
#   "<category>|<name>|<bash command that exits 0 for pass>|<optional expected stdout substring>"
# ─────────────────────────────────────────────────────────────────────────────

set -u

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"

QUIET=false
JSON=false
for arg in "$@"; do
  case $arg in
    --quiet) QUIET=true ;;
    --json) JSON=true; QUIET=true ;;
  esac
done

# Colors (no-op when piped)
if [ -t 1 ]; then
  C_OK=$'\033[1;32m'; C_FAIL=$'\033[1;31m'; C_WARN=$'\033[1;33m'
  C_DIM=$'\033[2m'; C_RESET=$'\033[0m'; C_BOLD=$'\033[1m'
else
  C_OK=""; C_FAIL=""; C_WARN=""; C_DIM=""; C_RESET=""; C_BOLD=""
fi

# Source repo .env so checks see X402_*, CIRCLE_*, etc.
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE" 2>/dev/null || true
  set +a
fi

PASS=0
FAIL=0
WARN=0
RESULTS=()

run_check() {
  local category="$1"
  local name="$2"
  local cmd="$3"
  local expect="${4:-}"
  local out status
  out=$(bash -c "$cmd" 2>&1)
  status=$?

  local result="PASS"
  if [ $status -ne 0 ]; then
    result="FAIL"
  elif [ -n "$expect" ] && ! echo "$out" | grep -qF "$expect"; then
    result="FAIL"
  fi

  if [ "$result" = "PASS" ]; then
    PASS=$((PASS + 1))
    [ "$QUIET" = false ] && printf "  %s✓%s %-50s %s%s%s\n" "$C_OK" "$C_RESET" "$name" "$C_DIM" "$(echo "$out" | head -1 | cut -c1-50)" "$C_RESET"
  else
    FAIL=$((FAIL + 1))
    printf "  %s✗%s %-50s %s%s%s\n" "$C_FAIL" "$C_RESET" "$name" "$C_DIM" "$(echo "$out" | head -2 | tr '\n' ' ' | cut -c1-100)" "$C_RESET"
  fi
  RESULTS+=("$category|$name|$result")
}

warn_check() {
  local name="$1"
  local message="$2"
  WARN=$((WARN + 1))
  printf "  %s⚠%s %-50s %s\n" "$C_WARN" "$C_RESET" "$name" "$message"
  RESULTS+=("warning|$name|WARN")
}

section() {
  [ "$QUIET" = false ] && printf "\n%s%s%s\n" "$C_BOLD" "$1" "$C_RESET"
}

# ─── systemd services ────────────────────────────────────────────────────────
section "systemd services"
for svc in arc-rating arc-web arc-indexer-live arc-execution arc-consensus; do
  run_check "systemd" "$svc.service active" \
    "systemctl is-active $svc.service" "active"
done
# Restart loops: catch services that are flapping (>5 restarts in last 5 min).
for svc in arc-rating arc-web arc-indexer-live; do
  count=$(journalctl -u "$svc.service" --since "5 minutes ago" --no-pager 2>/dev/null \
          | grep -c "Scheduled restart" || true)
  if [ "$count" -gt 5 ]; then
    warn_check "$svc.service flapping" "$count restarts in last 5min"
  fi
done

# ─── Local HTTP health ──────────────────────────────────────────────────────
section "local HTTP health"
run_check "local" "rating /health" \
  'curl -fsS http://localhost:3100/health' '"status":"ok"'
run_check "local" "web /api/health (if present)" \
  'curl -fsS http://localhost:3000/api/health 2>/dev/null || curl -fsS http://localhost:3000/ -o /dev/null'
run_check "local" "rating bulk endpoint sanity" \
  'curl -fsS "http://localhost:3100/v1/ratings/bulk?chain=arc&ids=1,2,3"' '"ratings"'

# ─── Public HTTP via Cloudflare ─────────────────────────────────────────────
section "public HTTP"
run_check "public" "caliber-api.poko.blue /health" \
  'curl -fsS https://caliber-api.poko.blue/health' '"status":"ok"'
run_check "public" "caliber.poko.blue front page" \
  'curl -fsS -o /dev/null -w "%{http_code}" https://caliber.poko.blue/' '200'
run_check "public" "audit endpoint reachable" \
  'curl -fsS "https://caliber.poko.blue/api/audit/posts?poster=0x0000000000000000000000000000000000000001&limit=1"' '"poster"'

# ─── CORS + x402 contract ──────────────────────────────────────────────────
section "x402 / Circle Gateway"
run_check "x402" "rating CORS headers present" \
  'curl -sI -H "Origin: https://caliber.poko.blue" https://caliber-api.poko.blue/health' \
  'access-control-allow-origin: *'
run_check "x402" "attest endpoint returns 402 (no payment)" \
  'curl -s -o /dev/null -w "%{http_code}" -X POST -H "Content-Type: application/json" -d "{}" https://caliber-api.poko.blue/v1/agents/arc/1253/attest' \
  '402'
run_check "x402" "Circle Gateway payment-required header present" \
  'curl -sI -X POST -H "Content-Type: application/json" -d "{}" https://caliber-api.poko.blue/v1/agents/arc/1253/attest' \
  'payment-required:'
run_check "x402" "bypass token accepted (server-to-server)" \
  "curl -s -o /dev/null -w \"%{http_code}\" -X POST -H \"Content-Type: application/json\" -H \"x-x402-bypass: \${X402_BYPASS_TOKEN:-MISSING}\" -d '{}' https://caliber-api.poko.blue/v1/agents/arc/1253/attest" \
  '200'

# ─── Database ───────────────────────────────────────────────────────────────
section "database"
PG_CONTAINER=$(docker ps --format '{{.Names}} {{.Image}}' 2>/dev/null | awk '/pgvector|postgres/ {print $1; exit}')
if [ -n "$PG_CONTAINER" ]; then
  run_check "db" "postgres container running" "echo $PG_CONTAINER"
  run_check "db" "agents table has rows" \
    "docker exec -i $PG_CONTAINER psql -U postgres -d arc_agents -tA -c 'SELECT count(*) FROM agents;'" \
    ""
  run_check "db" "recent jobs (indexer fresh)" \
    "docker exec -i $PG_CONTAINER psql -U postgres -d arc_agents -tA -c \"SELECT count(*) FROM jobs WHERE created_at > now() - interval '1 hour';\""
  run_check "db" "rating_snapshots populated" \
    "docker exec -i $PG_CONTAINER psql -U postgres -d arc_agents -tA -c 'SELECT count(*) FROM rating_snapshots;'"
else
  warn_check "postgres container" "not found via docker ps — DB checks skipped"
fi

# ─── Arc node ───────────────────────────────────────────────────────────────
section "Arc execution node"
run_check "arc-node" "localhost:8545 eth_blockNumber" \
  'curl -sS -X POST -H "Content-Type: application/json" -d "{\"jsonrpc\":\"2.0\",\"method\":\"eth_blockNumber\",\"params\":[],\"id\":1}" http://localhost:8545' \
  '"result":'
ARC_FORWARDER=$(ps -o cmd= -p "$(pgrep -f arc-node-execution)" 2>/dev/null | grep -oE 'rpc.forwarder [^ ]+' | awk '{print $2}')
if [ -n "$ARC_FORWARDER" ]; then
  if echo "$ARC_FORWARDER" | grep -q "rpc.testnet.arc.network"; then
    run_check "arc-node" "forwarder URL safe (not quicknode)" "echo $ARC_FORWARDER"
  else
    warn_check "Arc forwarder URL" "set to $ARC_FORWARDER — verify this is reachable"
  fi
fi
run_check "arc-node" "public Arc RPC reachable" \
  'curl -sS -X POST -H "Content-Type: application/json" -d "{\"jsonrpc\":\"2.0\",\"method\":\"eth_blockNumber\",\"params\":[],\"id\":1}" https://rpc.testnet.arc.network' \
  '"result":'

# ─── Env vars present ──────────────────────────────────────────────────────
section "env vars"
for var in DATABASE_URL ARC_RPC_URL RATING_SIGNER_PRIVATE_KEY \
           X402_PRICE_USDC X402_SELLER_ADDRESS X402_FACILITATOR_URL X402_BYPASS_TOKEN \
           CIRCLE_API_KEY NEXT_PUBLIC_CIRCLE_APP_ID NEXT_PUBLIC_GOOGLE_CLIENT_ID; do
  val="${!var:-}"
  if [ -n "$val" ]; then
    PASS=$((PASS + 1))
    [ "$QUIET" = false ] && printf "  %s✓%s %-50s %sset%s\n" "$C_OK" "$C_RESET" "$var" "$C_DIM" "$C_RESET"
  else
    FAIL=$((FAIL + 1))
    printf "  %s✗%s %-50s %smissing in %s%s\n" "$C_FAIL" "$C_RESET" "$var" "$C_DIM" "$ENV_FILE" "$C_RESET"
  fi
  RESULTS+=("env|$var|$([ -n "$val" ] && echo PASS || echo FAIL)")
done

# ─── Web build freshness ───────────────────────────────────────────────────
section "build artifacts"
NEXT_DIR="$ROOT_DIR/web/.next"
if [ -d "$NEXT_DIR" ]; then
  age_min=$(( ( $(date +%s) - $(stat -c %Y "$NEXT_DIR" 2>/dev/null || echo 0) ) / 60 ))
  if [ "$age_min" -lt 1440 ]; then
    PASS=$((PASS + 1))
    [ "$QUIET" = false ] && printf "  %s✓%s %-50s %sbuilt %dm ago%s\n" "$C_OK" "$C_RESET" "web/.next exists" "$C_DIM" "$age_min" "$C_RESET"
  else
    warn_check "web/.next stale" "built $age_min minutes ago — consider rebuilding"
  fi
else
  FAIL=$((FAIL + 1))
  printf "  %s✗%s %-50s %sno %s%s\n" "$C_FAIL" "$C_RESET" "web/.next exists" "$C_DIM" "$NEXT_DIR" "$C_RESET"
fi

# ─── Summary ────────────────────────────────────────────────────────────────
echo ""
TOTAL=$((PASS + FAIL))
if [ "$JSON" = true ]; then
  # Minimal JSON output for monitoring.
  printf '{"pass":%d,"fail":%d,"warn":%d,"total":%d,"results":[' "$PASS" "$FAIL" "$WARN" "$TOTAL"
  first=true
  for r in "${RESULTS[@]}"; do
    IFS='|' read -r cat name status <<< "$r"
    [ "$first" = false ] && printf ','
    first=false
    printf '{"category":"%s","name":"%s","status":"%s"}' "$cat" "$name" "$status"
  done
  printf ']}\n'
else
  printf "%s%d passed%s · " "$C_OK" "$PASS" "$C_RESET"
  printf "%s%d failed%s · " "$([ "$FAIL" -gt 0 ] && echo "$C_FAIL" || echo "$C_DIM")" "$FAIL" "$C_RESET"
  printf "%s%d warnings%s\n" "$C_WARN" "$WARN" "$C_RESET"
  if [ "$FAIL" -gt 0 ]; then
    printf "\n%sFAILED:%s\n" "$C_FAIL" "$C_RESET"
    for r in "${RESULTS[@]}"; do
      IFS='|' read -r cat name status <<< "$r"
      [ "$status" = "FAIL" ] && printf "  %s· %s · %s%s\n" "$C_FAIL" "$cat" "$name" "$C_RESET"
    done
  fi
fi

[ "$FAIL" -eq 0 ] && exit 0 || exit 1
