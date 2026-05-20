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
#
# Kill strategy (in order, all attempted):
#   1. PID file ($HARNESSA_PID_FILE, default ~/.harnessa/mcp.pid)
#   2. Whatever is listening on the bridge port (parsed from $HARNESSA_FE_URL,
#      default 47729) — catches leaders spawned by Kiro/Claude/Codex as stdio
#      children, which the PID file does not track.
#   3. Any `node …/mcp-server/dist/cli.js` orphan by full path match.
# Each step is best-effort; failures are non-fatal.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_FILE="${HARNESSA_PID_FILE:-$HOME/.harnessa/mcp.pid}"
LOG_FILE="${HARNESSA_LOG_FILE:-$HOME/.harnessa/mcp.log}"
# Parse port from HARNESSA_FE_URL (e.g. ws://host:47729/) — fallback 47729.
# Bash regex instead of sed because BSD sed (macOS default) chokes on the
# `; t; ` test/branch idiom GNU sed handles fine.
URL_VAR="${HARNESSA_FE_URL:-ws://127.0.0.1:47729}"
if [[ "$URL_VAR" =~ ^[a-z]+://[^:/]+:([0-9]+) ]]; then
    PORT="${BASH_REMATCH[1]}"
else
    PORT=47729
fi
CLI_PATH="$REPO_ROOT/packages/mcp-server/dist/cli.js"

# ── 1. Build ──────────────────────────────────────────────────────────────────
echo "[restart-mcp] building mcp-server..."
pnpm --filter @harnessa-fe/mcp-server build
echo "[restart-mcp] build succeeded"

# ── 2. Kill any previous instance ─────────────────────────────────────────────

# Helper: wait up to 5s for pid to exit; SIGKILL if still alive.
wait_then_kill() {
    local pid="$1"
    for _ in $(seq 1 10); do
        kill -0 "$pid" 2>/dev/null || return 0
        sleep 0.5
    done
    if kill -0 "$pid" 2>/dev/null; then
        echo "[restart-mcp]   pid $pid did not exit, sending SIGKILL"
        kill -9 "$pid" 2>/dev/null || true
    fi
}

# Collect candidate PIDs from all three sources, dedupe, then kill each.
declare -a CANDIDATES=()

# (a) PID file
if [[ -f "$PID_FILE" ]]; then
    OLD_PID="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [[ -n "${OLD_PID:-}" ]] && kill -0 "$OLD_PID" 2>/dev/null; then
        CANDIDATES+=("$OLD_PID")
    fi
    rm -f "$PID_FILE"
fi

# (b) Whatever is listening on the bridge port
if command -v lsof >/dev/null 2>&1; then
    while IFS= read -r pid; do
        [[ -n "$pid" ]] && CANDIDATES+=("$pid")
    done < <(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null || true)
fi

# (c) Any `node …/mcp-server/dist/cli.js` orphan, by full path match
if command -v pgrep >/dev/null 2>&1; then
    while IFS= read -r pid; do
        [[ -n "$pid" ]] && CANDIDATES+=("$pid")
    done < <(pgrep -f "$CLI_PATH" 2>/dev/null || true)
fi

# Dedupe + skip our own PID just in case. Plain-string seen-set for bash 3.2 compat (macOS).
SELF_PID=$$
SEEN=" "
declare -a TO_KILL=()
for pid in "${CANDIDATES[@]+"${CANDIDATES[@]}"}"; do
    [[ -z "$pid" || "$pid" == "$SELF_PID" ]] && continue
    case "$SEEN" in *" $pid "*) continue ;; esac
    SEEN="$SEEN$pid "
    TO_KILL+=("$pid")
done

if (( ${#TO_KILL[@]} == 0 )); then
    echo "[restart-mcp] no previous instance found"
else
    echo "[restart-mcp] killing previous instance(s): ${TO_KILL[*]}"
    for pid in "${TO_KILL[@]}"; do
        kill "$pid" 2>/dev/null || true
    done
    for pid in "${TO_KILL[@]}"; do
        wait_then_kill "$pid"
    done
fi

# Sanity check: confirm the port is free before starting.
if command -v lsof >/dev/null 2>&1; then
    if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t >/dev/null 2>&1; then
        echo "[restart-mcp] ERROR: port $PORT still in use after cleanup — aborting"
        lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >&2 || true
        exit 1
    fi
fi

# ── 3. Start new instance ─────────────────────────────────────────────────────
mkdir -p "$(dirname "$PID_FILE")" "$(dirname "$LOG_FILE")"

echo "[restart-mcp] starting mcp-server on port $PORT..."
nohup node "$CLI_PATH" \
    >> "$LOG_FILE" 2>&1 &
NEW_PID=$!
echo "$NEW_PID" > "$PID_FILE"
echo "[restart-mcp] started (pid $NEW_PID), log → $LOG_FILE"
