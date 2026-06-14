#!/usr/bin/env bash
#
# upgrade-arc-node-to-0.7.1.sh
#
# In-place upgrade of arc-node from v0.6.0 → v0.7.1 to clear the
# Osaka + Zero5/Zero6 hard-fork freeze (block 44,295,021, timestamp
# 1779894517 = 2026-05-27 15:08:37 UTC).
#
# Strategy: build first (services still running, no downtime), then
# stop in reverse dependency order, swap binaries, restart in
# forward order, verify forward progress past 44,295,020.
#
# Run STEP BY STEP. Each section is gated by a confirmation prompt
# so you can pause and inspect between steps.
#
# Fallback (if v0.7.1 still rejects 44,295,021): wipe and resync
# from snapshot. Separate script: snapshot-resync-arc-node.sh
# (write only if needed).

set -euo pipefail

# ────────────────────────────────────────────────────────────────────
# Configuration
# ────────────────────────────────────────────────────────────────────
ARC_SRC="$HOME/arc-node"
TARGET_TAG="v0.7.1"
CARGO_BIN="$HOME/.cargo/bin"
EXECUTION_DATADIR="$HOME/.arc/execution"
LAST_GOOD_BLOCK=44295020
FREEZE_BLOCK=44295021

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
# STEP 0 — Pre-flight checks (read-only)
# ────────────────────────────────────────────────────────────────────
hr
echo "STEP 0: Pre-flight checks"
hr

echo "Disk free in \$HOME (cargo build needs ~10 GB):"
df -h "$HOME" | head -2
echo

echo "Disk free in $EXECUTION_DATADIR (current chain data):"
du -sh "$EXECUTION_DATADIR" 2>/dev/null || echo "  (cannot read execution dir)"
echo

echo "Current binary versions:"
"$CARGO_BIN/arc-node-execution" --version | head -3
"$CARGO_BIN/arc-node-consensus" --version | head -3
echo

echo "Service states:"
( systemctl is-active arc-execution arc-consensus arc-indexer-live || true ) | paste <(printf 'arc-execution\narc-consensus\narc-indexer-live\n') -
echo

cd "$ARC_SRC"
echo "Arc source repo state:"
echo "  branch/tag: $(git describe --tags --always)"
echo "  uncommitted:"
git status --short | head -5
echo

pause "Review pre-flight output. Cargo build will need ~10 GB free in \$HOME and ~20 min on this machine."

# ────────────────────────────────────────────────────────────────────
# STEP 1 — Check out v0.7.1 + update submodules
# ────────────────────────────────────────────────────────────────────
hr
echo "STEP 1: Check out $TARGET_TAG"
hr

cd "$ARC_SRC"

if git diff-index --quiet HEAD --; then
    echo "Working tree clean."
else
    echo "Working tree has uncommitted changes:"
    git status --short
    echo
    echo "Stashing them so checkout doesn't conflict ..."
    git stash push -u -m "pre-v0.7.1-upgrade-$(date +%Y%m%d-%H%M%S)"
fi

git fetch --all --tags
git checkout "$TARGET_TAG"
git submodule update --init --recursive

echo
echo "Now on $(git describe --tags --always)"
echo "Submodules synced."
pause "Confirm we are on $TARGET_TAG before building."

# ────────────────────────────────────────────────────────────────────
# STEP 2 — Build new binaries WHILE old binaries still serve
# ────────────────────────────────────────────────────────────────────
# We use `cargo build --release` first (which writes to ./target)
# rather than `cargo install` (which would overwrite ~/.cargo/bin
# immediately). This way the running v0.6.0 binaries keep serving
# whatever requests come in until we explicitly swap.
hr
echo "STEP 2: Build new binaries (services keep running)"
hr

cd "$ARC_SRC"
echo "Building arc-node-execution (release mode) ..."
time cargo build --release --bin arc-node-execution

echo
echo "Building arc-node-consensus (release mode) ..."
time cargo build --release --bin arc-node-consensus

echo
echo "Building arc-snapshots (release mode) ..."
time cargo build --release --bin arc-snapshots

echo
echo "Verifying built binaries:"
"$ARC_SRC/target/release/arc-node-execution" --version | head -3
"$ARC_SRC/target/release/arc-node-consensus" --version | head -3
echo

pause "Build complete. Both binaries should report v0.7.x (commit 232a8f6 or descendant)."

# ────────────────────────────────────────────────────────────────────
# STEP 3 — Stop services in reverse dependency order
# ────────────────────────────────────────────────────────────────────
hr
echo "STEP 3: Stop services"
hr

echo "Stopping arc-indexer-live (downstream, no chain dependency) ..."
sudo systemctl stop arc-indexer-live

echo "Stopping arc-consensus (depends on arc-execution IPC) ..."
sudo systemctl stop arc-consensus

echo "Stopping arc-execution ..."
sudo systemctl stop arc-execution

sleep 2
echo
echo "Services after stop:"
( systemctl is-active arc-execution arc-consensus arc-indexer-live || true ) | paste <(printf 'arc-execution\narc-consensus\narc-indexer-live\n') -
echo

# Confirm there's no leftover IPC socket (else we may get conflicts)
ls -la /run/arc/ 2>/dev/null || echo "  /run/arc/ is empty or removed (good)"
pause "All three services should be 'inactive'. Confirm before swapping binaries."

# ────────────────────────────────────────────────────────────────────
# STEP 4 — Swap binaries
# ────────────────────────────────────────────────────────────────────
hr
echo "STEP 4: Swap binaries to v0.7.1"
hr

# Back up v0.6.0 binaries first
BACKUP_DIR="$HOME/arc-debug/v0.6.0-binaries-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"
cp -v "$CARGO_BIN/arc-node-execution" "$BACKUP_DIR/"
cp -v "$CARGO_BIN/arc-node-consensus" "$BACKUP_DIR/"
cp -v "$CARGO_BIN/arc-snapshots" "$BACKUP_DIR/" 2>/dev/null || true

echo "v0.6.0 binaries backed up to: $BACKUP_DIR"
echo

cp -v "$ARC_SRC/target/release/arc-node-execution" "$CARGO_BIN/arc-node-execution"
cp -v "$ARC_SRC/target/release/arc-node-consensus" "$CARGO_BIN/arc-node-consensus"
cp -v "$ARC_SRC/target/release/arc-snapshots"      "$CARGO_BIN/arc-snapshots"

echo
echo "New binary versions:"
"$CARGO_BIN/arc-node-execution" --version | head -3
"$CARGO_BIN/arc-node-consensus" --version | head -3
echo

pause "Confirm both binaries report v0.7.1."

# ────────────────────────────────────────────────────────────────────
# STEP 5 — Start services in forward dependency order
# ────────────────────────────────────────────────────────────────────
hr
echo "STEP 5: Start services"
hr

echo "Starting arc-execution ..."
sudo systemctl start arc-execution
echo "Waiting for IPC sockets to appear (max 30s) ..."
for i in $(seq 1 30); do
    if [ -S /run/arc/reth.ipc ] && [ -S /run/arc/auth.ipc ]; then
        echo "  IPC sockets ready after ${i}s"
        break
    fi
    sleep 1
done
echo

echo "Starting arc-consensus ..."
sudo systemctl start arc-consensus
echo "  Waiting 10s for consensus to initialize ..."
sleep 10
echo

# DO NOT start the indexer yet — we want to confirm the chain is moving first.
echo "Service states (indexer intentionally still stopped):"
( systemctl is-active arc-execution arc-consensus arc-indexer-live || true ) | paste <(printf 'arc-execution\narc-consensus\narc-indexer-live\n') -
echo

pause "Both Arc layers should be 'active'. Next step: watch consensus for forward progress past block $LAST_GOOD_BLOCK."

# ────────────────────────────────────────────────────────────────────
# STEP 6 — Verify forward progress past the fork block
# ────────────────────────────────────────────────────────────────────
hr
echo "STEP 6: Verify forward progress"
hr

echo "Will watch consensus journal for 60s for any 'Successfully committed' lines"
echo "at height ≥ $FREEZE_BLOCK. If none, the upgrade did NOT clear the freeze and"
echo "the fallback path is wipe+snapshot resync."
echo

echo "Streaming consensus logs (Ctrl-C to stop)..."
echo

sudo timeout 60 journalctl -u arc-consensus -f --no-pager 2>&1 \
    | grep --line-buffered -E "Successfully committed|invalid|ERROR|Decided|Height finalized" \
    | head -40 || true

echo
echo "Checking current block height on local node ..."
LOCAL_HEX=$(curl -s -X POST -H "Content-Type: application/json" \
    --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
    http://localhost:8545 | python3 -c "import sys,json; print(json.load(sys.stdin)['result'])" 2>/dev/null || echo "0x0")
LOCAL_DEC=$((LOCAL_HEX))
echo "  local head: $LOCAL_HEX = $LOCAL_DEC"

PUBLIC_HEX=$(curl -s -X POST -H "Content-Type: application/json" \
    --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
    https://rpc.testnet.arc.network | python3 -c "import sys,json; print(json.load(sys.stdin)['result'])" 2>/dev/null || echo "0x0")
PUBLIC_DEC=$((PUBLIC_HEX))
echo "  public head: $PUBLIC_HEX = $PUBLIC_DEC"

echo "  gap: $((PUBLIC_DEC - LOCAL_DEC)) blocks"
echo

if [ "$LOCAL_DEC" -gt "$LAST_GOOD_BLOCK" ]; then
    echo "✅ SUCCESS — local node has advanced past block $LAST_GOOD_BLOCK."
    echo "   Now catching up on ~$((PUBLIC_DEC - LOCAL_DEC)) blocks."
    echo "   Wait until gap < 10 before starting the indexer."
else
    echo "❌ STILL STUCK at $LOCAL_DEC. v0.7.1 did not accept block $FREEZE_BLOCK."
    echo "   The fallback path is wipe + snapshot resync."
    echo "   STOP HERE and ping the assistant before proceeding."
    exit 1
fi

pause "Once local head is within 10 blocks of public head, continue to start the indexer."

# ────────────────────────────────────────────────────────────────────
# STEP 7 — Start the indexer
# ────────────────────────────────────────────────────────────────────
hr
echo "STEP 7: Start the indexer"
hr

sudo systemctl start arc-indexer-live
sleep 3

echo "Service states:"
( systemctl is-active arc-execution arc-consensus arc-indexer-live || true ) | paste <(printf 'arc-execution\narc-consensus\narc-indexer-live\n') -
echo

echo "Indexer journal (last 20 lines):"
sudo journalctl -u arc-indexer-live --no-pager -n 20

echo
hr
echo "Upgrade complete. Watch /api/health for the indexer to catch up."
echo "  curl -s https://caliber.poko.blue/api/health | jq ."
hr
