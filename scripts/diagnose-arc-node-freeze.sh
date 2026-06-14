#!/usr/bin/env bash
#
# diagnose-arc-node-freeze.sh
#
# Investigates the arc-consensus / arc-execution freeze that started
# at 2026-05-27 15:08:37 UTC. Saves logs to ~/arc-debug/ and prints
# the highest-signal output inline at the end.
#
# Usage:  ./scripts/diagnose-arc-node-freeze.sh
# Needs:  sudo (will prompt once and cache).
# Output: ~/arc-debug/*.log + inline summary
#
# Read-only. Does NOT restart anything.

set -euo pipefail

FREEZE_START="2026-05-27 15:08:00"
FREEZE_END="2026-05-27 15:09:00"
FREEZE_MOMENT="2026-05-27 15:08:37"
HOST_WIN_START="2026-05-27 15:05"
HOST_WIN_END="2026-05-27 15:15"

OUTDIR="$HOME/arc-debug"
mkdir -p "$OUTDIR"
cd "$OUTDIR"

echo "==> Caching sudo timestamp (one prompt) ..."
sudo -v

# Keep sudo alive while the script runs.
( while true; do sudo -n true; sleep 50; kill -0 $$ 2>/dev/null || exit; done ) &
SUDO_KEEPALIVE_PID=$!
trap 'kill $SUDO_KEEPALIVE_PID 2>/dev/null || true' EXIT

echo "==> [1/5] 60-second freeze window (consensus)"
sudo journalctl -u arc-consensus \
    --since "$FREEZE_START" --until "$FREEZE_END" \
    --no-pager > 1-consensus-freeze-window.log 2>&1 || true

echo "==> [2/5] First 3000 lines after the freeze (consensus)"
sudo journalctl -u arc-consensus --since "$FREEZE_MOMENT" --no-pager 2>/dev/null \
    | head -3000 > 2-consensus-post-freeze-head3000.log || true

echo "==> [3/5] Unique log-line SHAPES since freeze (the star file)"
sudo journalctl -u arc-consensus --since "$FREEZE_MOMENT" --no-pager 2>/dev/null \
    | sed -E '
        s/^[A-Z][a-z]{2} [0-9]+ [0-9:]+ arc arc-consensus\[[0-9]+\]: //
        s/[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z//
        s/height=[0-9]+/height=N/g
        s/sync_height=[0-9]+/sync_height=N/g
        s/peer_height=[0-9]+/peer_height=N/g
        s/tip_height=[0-9]+/tip_height=N/g
        s/round=[0-9]+/round=N/g
        s/0x[a-fA-F0-9]+/0xHASH/g
        s/peer_id=[A-Za-z0-9]+/peer_id=ID/g
        s/[0-9]+ms/Nms/g
        s/pending_requests=[0-9]+/pending_requests=N/g
        s/max_parallel_requests=[0-9]+/max_parallel_requests=N/g
    ' \
    | sort | uniq -c | sort -rn > 3-consensus-uniq-by-shape.log || true

echo "==> [4/5] Kernel events in the freeze window (OOM, disk, NIC)"
sudo journalctl --since "$HOST_WIN_START" --until "$HOST_WIN_END" \
    --no-pager -k > 4-kernel-freeze-window.log 2>&1 || true

echo "==> [5/5] High-priority host errors in the freeze window"
sudo journalctl --since "$HOST_WIN_START" --until "$HOST_WIN_END" \
    --no-pager -p err > 5-host-errors-freeze-window.log 2>&1 || true

echo
echo "==> Files written:"
ls -lh "$OUTDIR"/*.log
echo

# ----------------------------------------------------------------------
# Inline summary
# ----------------------------------------------------------------------
hr() { printf '%.0s─' {1..78}; echo; }

hr
echo "FILE 3 — Unique log-line shapes since freeze (THIS IS THE KEY FILE)"
echo "If only the 4-6 repeating shapes appear, the freeze was a SILENT stall."
echo "Anything with count = 1 is a one-off line and likely the smoking gun."
hr
cat 3-consensus-uniq-by-shape.log
echo

hr
echo "FILE 1 — Exact 60-second freeze boundary"
echo "Look for the LAST 'decided{height=…}' line + the FIRST 'SYNC REQUIRED'."
hr
cat 1-consensus-freeze-window.log
echo

hr
echo "FILE 2 — Grep for error/warn/fail/timeout/drop in first 3000 post-freeze lines"
hr
grep -iE "error|warn|fail|timeout|drop|reqwest|hyper|connection|reset|closed|abort" \
    2-consensus-post-freeze-head3000.log | head -50 || echo "(no matches found)"
echo

hr
echo "FILE 4 — Kernel events in the freeze window"
hr
if [[ -s 4-kernel-freeze-window.log ]]; then
    cat 4-kernel-freeze-window.log
else
    echo "(empty — kernel is innocent)"
fi
echo

hr
echo "FILE 5 — High-priority host errors in the freeze window"
hr
if [[ -s 5-host-errors-freeze-window.log ]]; then
    cat 5-host-errors-freeze-window.log
else
    echo "(empty — no host-wide errors)"
fi
echo

hr
echo "DONE. All files in: $OUTDIR"
echo "Paste the output above (or zip $OUTDIR and share) for analysis."
hr
