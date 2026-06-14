#!/usr/bin/env bash
#
# snapshot-resync-arc-node.sh
#
# FALLBACK script for use IF AND ONLY IF the in-place upgrade
# (upgrade-arc-node-to-0.7.1.sh) failed — i.e., v0.7.1 still
# rejects block 44,295,021 as "invalid payload" because the local
# state DB is too corrupt to apply the fork rules cleanly.
#
# WHAT THIS DOES:
#   1. Stops all Arc services
#   2. MOVES (not deletes) the existing data dirs to backup paths
#   3. Downloads + extracts a fresh testnet snapshot via arc-snapshots
#   4. Restarts services and watches them catch up
#
# WHAT YOU NEED:
#   * v0.7.1 binaries already installed (run the upgrade script first)
#   * Free disk space: ~140 GB total
#       - ~84 GB during download (compressed snapshot)
#       - ~140 GB after extract (EL ~103 GB + CL ~36 GB)
#       - Existing data backed up (not freed until you delete .bak dirs)
#   * Time: 30 min on 100 Mbps; hours on slow links
#
# WHAT YOU LOSE:
#   * Local state history (rebuilt from snapshot — same chain, fresh DB)
#   * Anything that was in pending mempool (testnet — fine)
#
# WHAT YOU KEEP:
#   * Postgres indexer data (every event up to 44,295,020 stays)
#   * After indexer reconnects, it catches up from its checkpoint forward.

set -euo pipefail

ARC_EXECUTION="$HOME/.arc/execution"
ARC_CONSENSUS="$HOME/.arc/consensus"
BACKUP_SUFFIX=".broken-v0.6.0-$(date +%Y%m%d-%H%M%S)"

pause() {
    echo
    echo "──────────────────────────────────────────────────────────────────"
    echo "PAUSE: $*"
    echo "Press Enter to continue, Ctrl-C to abort."
    echo "──────────────────────────────────────────────────────────────────"
    read -r
}

hr() { printf '%.0s─' {1..70}; echo; }

# ────────────────────────────────────────────────────────────────────
# STEP 0 — Pre-flight checks
# ────────────────────────────────────────────────────────────────────
hr
echo "STEP 0: Pre-flight (snapshot resync fallback)"
hr

echo "Verify upgrade script ran and v0.7.1 binaries are in place:"
~/.cargo/bin/arc-node-execution --version | head -2
~/.cargo/bin/arc-node-consensus --version | head -2
~/.cargo/bin/arc-snapshots --version 2>&1 | head -2
echo

echo "Current disk usage:"
df -h "$HOME" | head -2
echo

echo "Existing Arc data dir sizes (these will be MOVED, not deleted):"
du -sh "$ARC_EXECUTION" 2>/dev/null || echo "  (no execution dir)"
du -sh "$ARC_CONSENSUS" 2>/dev/null || echo "  (no consensus dir)"
echo

echo "Snapshot will need ~140 GB free during extract."
echo "Backup of existing data uses ~$(du -sh $ARC_EXECUTION 2>/dev/null | cut -f1) until you delete it."
pause "Confirm you have enough free disk for snapshot + backup."

# ────────────────────────────────────────────────────────────────────
# STEP 1 — Stop services
# ────────────────────────────────────────────────────────────────────
hr
echo "STEP 1: Stop all Arc services"
hr

sudo systemctl stop arc-indexer-live
sudo systemctl stop arc-consensus
sudo systemctl stop arc-execution
sleep 2

echo "States:"
( systemctl is-active arc-execution arc-consensus arc-indexer-live || true ) \
    | paste <(printf 'arc-execution\narc-consensus\narc-indexer-live\n') -
pause "All three should be 'inactive'."

# ────────────────────────────────────────────────────────────────────
# STEP 2 — Move existing data dirs to backup paths (recoverable)
# ────────────────────────────────────────────────────────────────────
hr
echo "STEP 2: Move broken data dirs to backup paths"
hr

echo "Backing up execution data ..."
if [ -d "$ARC_EXECUTION" ]; then
    mv "$ARC_EXECUTION" "${ARC_EXECUTION}${BACKUP_SUFFIX}"
    echo "  $ARC_EXECUTION → ${ARC_EXECUTION}${BACKUP_SUFFIX}"
else
    echo "  no execution dir to move"
fi

echo "Backing up consensus data ..."
if [ -d "$ARC_CONSENSUS" ]; then
    mv "$ARC_CONSENSUS" "${ARC_CONSENSUS}${BACKUP_SUFFIX}"
    echo "  $ARC_CONSENSUS → ${ARC_CONSENSUS}${BACKUP_SUFFIX}"
else
    echo "  no consensus dir to move"
fi
echo

# Recreate empty dirs (arc-snapshots writes into these paths)
mkdir -p "$ARC_EXECUTION" "$ARC_CONSENSUS"

echo "Backups remain on disk until you delete them manually:"
ls -la ~/.arc/ | grep -E "execution|consensus"
echo
pause "Old data preserved. Ready to download fresh snapshot."

# ────────────────────────────────────────────────────────────────────
# STEP 3 — Download + extract the testnet snapshot
# ────────────────────────────────────────────────────────────────────
hr
echo "STEP 3: Download + extract latest arc-testnet snapshot"
hr
echo "This will take 10-15 minutes on 100 Mbps, longer on slower links."
echo "EL snapshot is ~68 GB compressed (~103 GB extracted),"
echo "CL snapshot is ~16 GB compressed (~36 GB extracted)."
echo

time arc-snapshots download \
    --chain=arc-testnet \
    --execution-path "$ARC_EXECUTION" \
    --consensus-path "$ARC_CONSENSUS"

echo
echo "Snapshot extracted. Sizes after extract:"
du -sh "$ARC_EXECUTION" "$ARC_CONSENSUS"
pause "Confirm both data dirs are populated."

# ────────────────────────────────────────────────────────────────────
# STEP 4 — Start services
# ────────────────────────────────────────────────────────────────────
hr
echo "STEP 4: Start services in dependency order"
hr

sudo systemctl start arc-execution
echo "Waiting for IPC sockets (max 30s)..."
for i in $(seq 1 30); do
    if [ -S /run/arc/reth.ipc ] && [ -S /run/arc/auth.ipc ]; then
        echo "  IPC sockets ready after ${i}s"
        break
    fi
    sleep 1
done

sudo systemctl start arc-consensus
echo "Waiting 10s for consensus init ..."
sleep 10

# Verify chain is advancing past the fork
echo
echo "Sampling local block height 3 times, 5s apart, to confirm advance:"
for i in 1 2 3; do
    H=$(curl -s -X POST -H "Content-Type: application/json" \
        --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
        http://localhost:8545 \
        | python3 -c "import sys,json; r=json.load(sys.stdin).get('result','0x0'); print(int(r,16))" 2>/dev/null || echo "?")
    echo "  sample $i: block $H"
    [ "$i" -lt 3 ] && sleep 5
done
echo

pause "Block height should be increasing. If still stuck, paste sample output back."

# ────────────────────────────────────────────────────────────────────
# STEP 5 — Start indexer + verify
# ────────────────────────────────────────────────────────────────────
hr
echo "STEP 5: Start arc-indexer-live"
hr

sudo systemctl start arc-indexer-live
sleep 3

( systemctl is-active arc-execution arc-consensus arc-indexer-live || true ) \
    | paste <(printf 'arc-execution\narc-consensus\narc-indexer-live\n') -
echo
echo "Indexer last 20 log lines:"
sudo journalctl -u arc-indexer-live --no-pager -n 20

echo
hr
echo "Snapshot resync complete."
echo
echo "Indexer will now catch up from its DB checkpoint at block 44,295,020"
echo "to the new local head. Watch progress via:"
echo "  watch -n 10 'curl -s https://caliber.poko.blue/api/health | jq .indexer'"
echo
echo "Backups still on disk (delete after you confirm everything works):"
echo "  ${ARC_EXECUTION}${BACKUP_SUFFIX}"
echo "  ${ARC_CONSENSUS}${BACKUP_SUFFIX}"
hr
