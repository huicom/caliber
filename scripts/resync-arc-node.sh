#!/usr/bin/env bash
#
# resync-arc-node.sh
#
# Recovers the self-hosted Arc node from the consensus value-sync deadlock
# (stuck at a fixed height with `max_parallel_requests=5 pending_requests=5`
# while peers are far ahead — see docs.arc.io run-an-arc-node "node stuck /
# far behind").
#
# Two-part fix, per Arc's own docs:
#   1. Snapshot resync — jump the node to a recent height so it never runs the
#      long value-sync that deadlocks (a plain restart just re-deadlocks).
#   2. Add the backpressure throttle the docs prescribe for stuck nodes:
#        --execution-persistence-backpressure
#        --execution-persistence-backpressure-threshold=10   (10 = aggressive)
#      It's currently absent from arc-consensus.service.
#
# Execution layer is left as-is (the deadlock is consensus-side).
#
# Run interactively:  bash scripts/resync-arc-node.sh
# Needs sudo (stop/start services + edit the consensus unit). Prompts once.
# Safe: backs up the CL validator key + the unit file before touching anything.

set -euo pipefail

EXEC_DIR="$HOME/.arc/execution"
CONS_DIR="$HOME/.arc/consensus"
CONS_CFG="$CONS_DIR/config"
UNIT="/etc/systemd/system/arc-consensus.service"
BACKUP="$HOME/arc-node-backup/$(date +%Y%m%d-%H%M%S)"
RPC_LOCAL="http://localhost:8545"
RPC_PUB="https://rpc.testnet.arc.network"
SNAP="$HOME/.cargo/bin/arc-snapshots"
STUCK_AT=46863016   # the height it's frozen at; success = climbs past this

hr() { printf '%.0s─' {1..68}; echo; }
pause() { echo; read -rp "▶  $1  [enter to continue, Ctrl-C to abort] "; echo; }
blk() { cast block-number --rpc-url "$1" 2>/dev/null || echo "?"; }

echo "Caching sudo (one prompt)…"; sudo -v
( while true; do sudo -n true; sleep 50; kill -0 $$ 2>/dev/null || exit; done ) &
trap 'kill %1 2>/dev/null || true' EXIT

# ───────────────────────────────────────────────────────────── pre-flight
hr; echo "STEP 0 · pre-flight (read-only)"; hr
echo "node version:    $($HOME/.cargo/bin/arc-node-consensus --version 2>/dev/null | head -1)"
echo "local height:    $(blk "$RPC_LOCAL")   (stuck near $STUCK_AT)"
echo "network head:    $(blk "$RPC_PUB")"
echo
echo "disk + current data sizes (snapshot extracts ~103G EL + ~36G CL):"
df -h "$HOME/.arc" | tail -1 | awk '{print "  free:", $4, "of", $2}'
du -sh "$EXEC_DIR" "$CONS_DIR/store.db" 2>/dev/null | sed 's/^/  /' || true
echo
echo "We will: stop the node → back up the CL key → clear stale data →"
echo "snapshot-resync → add backpressure flags → restart → verify."
pause "Review the above. Continue?"

# ────────────────────────────────────────────────────────── 1 · stop + backup
hr; echo "STEP 1 · stop services + back up key & unit"; hr
sudo systemctl stop arc-consensus arc-execution
mkdir -p "$BACKUP"
cp -av "$CONS_CFG" "$BACKUP/config" 2>/dev/null || true            # validator key, genesis
sudo cp -v "$UNIT" "$BACKUP/arc-consensus.service.bak"
echo "backup → $BACKUP"
pause "Services stopped, key + unit backed up. Continue to clear stale data?"

# ──────────────────────────────────────────────────── 2 · clear stale data
hr; echo "STEP 2 · clear stale chain data (frees disk; CL config preserved)"; hr
# EL: the whole reth datadir is snapshot-replaceable.
rm -rf "${EXEC_DIR:?}/"* 2>/dev/null || true
# CL: drop the deadlocked store + wal, KEEP config/ (the validator key) + .snapshot-url.
rm -rf "$CONS_DIR/store.db" "$CONS_DIR/wal" 2>/dev/null || true
df -h "$HOME/.arc" | tail -1 | awk '{print "free now:", $4}'
pause "Stale data cleared. Continue to download the snapshot (~84G, 10–15 min)?"

# ─────────────────────────────────────────────────── 3 · snapshot resync
hr; echo "STEP 3 · snapshot download + extract"; hr
"$SNAP" download --chain arc-testnet \
  --execution-path "$EXEC_DIR" \
  --consensus-path "$CONS_DIR"
# Make sure the validator key survived the extract; restore from backup if not.
if [ ! -f "$CONS_CFG/priv_validator_key.json" ] && [ -f "$BACKUP/config/priv_validator_key.json" ]; then
  echo "Restoring validator key from backup…"
  mkdir -p "$CONS_CFG"
  cp -av "$BACKUP/config/." "$CONS_CFG/"
fi
echo "validator key present: $([ -f "$CONS_CFG/priv_validator_key.json" ] && echo yes || echo NO)"
pause "Snapshot extracted + key verified. Continue to add the backpressure throttle?"

# ──────────────────────────────────────────── 4 · add backpressure flags
hr; echo "STEP 4 · patch arc-consensus.service (add backpressure)"; hr
if grep -q 'execution-persistence-backpressure' "$UNIT"; then
  echo "backpressure flags already present — skipping."
else
  # Insert the two flags (with line-continuation) right before the --metrics line.
  sudo sed -i '/--metrics 127.0.0.1:29000/i\  --execution-persistence-backpressure \\\n  --execution-persistence-backpressure-threshold=10 \\' "$UNIT"
  echo "added:"
  echo "  --execution-persistence-backpressure"
  echo "  --execution-persistence-backpressure-threshold=10"
fi
echo "--- new ExecStart (consensus) ---"
sudo awk '/^ExecStart=/{f=1} f{print} /29000/{f=0}' "$UNIT"
sudo systemctl daemon-reload
pause "Unit patched + daemon-reloaded. Continue to start the node?"

# ──────────────────────────────────────────────────────── 5 · start + verify
hr; echo "STEP 5 · start services + verify it advances past the freeze"; hr
sudo systemctl start arc-execution
echo "waiting for EL sockets…"; sleep 6
sudo systemctl start arc-consensus
echo "watching local height for ~90s (success = climbs past $STUCK_AT):"
for i in $(seq 1 9); do
  sleep 10
  H=$(blk "$RPC_LOCAL")
  echo "  +$((i*10))s  local=$H"
done
FINAL=$(blk "$RPC_LOCAL")
hr
if [ "$FINAL" != "?" ] && [ "$FINAL" -gt "$STUCK_AT" ]; then
  echo "✅ node advancing past the freeze ($STUCK_AT → $FINAL). It will keep"
  echo "   catching up to head. Recheck in ~30 min: cast block-number --rpc-url $RPC_LOCAL"
else
  echo "⚠️  still at/near $STUCK_AT. Check logs:  sudo journalctl -u arc-consensus -n 50 -f"
  echo "    If it re-deadlocks, the snapshot may need re-running, or escalate to Circle"
  echo "    with the 'pending_requests=5' value-sync signature."
fi
echo "backup kept at: $BACKUP"
