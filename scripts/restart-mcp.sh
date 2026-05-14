#!/usr/bin/env bash
# restart-mcp.sh — build the mcp-server package, kill any running instance,
# then start a fresh one in the background.
#
# Usage:
#   pnpm restart:mcp
#   # or directly:
#   bash scripts/restart-mcp.sh
#
# The script writes a PID file to ~/.harnessa/mcp.pid so subsequent runs
# can reliably kill the previous process.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_FILE="${HARNESSA_PID_FILE:-$HOME/.harnessa/mcp.pid}"
LOG_FILE="${HARNESSA_LOG_FILE:-$HOME/.harnessa/mcp.log}"

# ── 1. Build ──────────────────────────────────────────────────────────────────
echo "[restart-mcp] building mcp-server..."
pnpm --filter @morphixai/harnessa-fe.mcp-server build
echo "[restart-mcp] build succeeded"

# ── 2. Kill previous instance ─────────────────────────────────────────────────
if [[ -f "$PID_FILE" ]]; then
    OLD_PID=$(cat "$PID_FILE")
    if kill -0 "$OLD_PID" 2>/dev/null; then
        echo "[restart-mcp] killing previous process (pid $OLD_PID)..."
        kill "$OLD_PID"
        # Wait up to 5 s for it to exit
        for i in $(seq 1 10); do
            kill -0 "$OLD_PID" 2>/dev/null || break
            sleep 0.5
        done
        if kill -0 "$OLD_PID" 2>/dev/null; then
            echo "[restart-mcp] process did not exit cleanly, sending SIGKILL..."
            kill -9 "$OLD_PID" 2>/dev/null || true
        fi
    else
        echo "[restart-mcp] stale pid file (process $OLD_PID not running), ignoring"
    fi
    rm -f "$PID_FILE"
fi

# ── 3. Start new instance ─────────────────────────────────────────────────────
mkdir -p "$(dirname "$PID_FILE")" "$(dirname "$LOG_FILE")"

echo "[restart-mcp] starting mcp-server..."
nohup node "$REPO_ROOT/packages/mcp-server/dist/cli.js" \
    >> "$LOG_FILE" 2>&1 &
NEW_PID=$!
echo "$NEW_PID" > "$PID_FILE"
echo "[restart-mcp] started (pid $NEW_PID), log → $LOG_FILE"
