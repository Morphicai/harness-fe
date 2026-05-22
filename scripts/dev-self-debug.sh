#!/usr/bin/env bash
# Spin up a self-debug environment for the dashboard SPA:
#
#   1. A dedicated mcp-server daemon on port 47730 (separate from the
#      default 47729 so user-project daemons keep working alongside)
#   2. dashboard-ui's vite dev server with HARNESS_FE_SELF_DEBUG=1, so
#      the page injects our runtime + source-aware transform
#
# An agent connected to the dev-port daemon can drive the dashboard
# itself — click around, capture sessions, exercise the new code while
# we're building it. Ctrl-C tears both down.
set -euo pipefail

cleanup() {
  if [[ -n "${DAEMON_PID-}" ]]; then
    kill "$DAEMON_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Dedicated dev token + data dir so we don't pollute the user's
# default ~/.harness store.
export HARNESS_FE_PORT="${HARNESS_FE_PORT-47730}"
export HARNESS_FE_TOKEN="${HARNESS_FE_TOKEN-dev}"
export HARNESS_FE_DATA_DIR="${HARNESS_FE_DATA_DIR-$HOME/.harness-dev}"
export HARNESS_FE_SELF_DEBUG=1
export HARNESS_FE_SELF_DEBUG_URL="ws://127.0.0.1:${HARNESS_FE_PORT}?token=${HARNESS_FE_TOKEN}"

echo "[self-debug] starting mcp-server on :${HARNESS_FE_PORT} (token=${HARNESS_FE_TOKEN})"
pnpm -F @harness-fe/mcp-server start &
DAEMON_PID=$!

# Wait briefly for the daemon to bind so the SPA's first WS connect succeeds.
sleep 2

echo "[self-debug] starting dashboard-ui dev server (vite)"
echo "[self-debug] open http://127.0.0.1:5174/dashboard/?token=${HARNESS_FE_TOKEN}"
echo "[self-debug] agent MCP URL: ${HARNESS_FE_SELF_DEBUG_URL}"
pnpm -F @harness-fe/dashboard-ui dev:self-debug
