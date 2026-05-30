#!/usr/bin/env bash
#
# demo-multiuser.sh — boot the TEAM (multi-user, governed) topology on this
# machine so you can verify harness-fe is production-shaped end to end:
#
#   browsers (react-demo runtime) ──WS + team token──┐
#                                                     ▼
#                          central daemon :47900  (token, HTTP-MCP upstream)
#                                                     ▲
#   agent ──HTTP-MCP + gateway token (RBAC)──> gateway :47950 ─(inject caller)─┘
#
# Starts the central daemon + the gateway, issues two scoped agent tokens
# (agentA = read+control, agentB = read-only), and wires examples/react-demo/
# .mcp.json with agentA's token. Then open react-demo in several browser
# windows to simulate multiple users. Ctrl-C tears everything down.
#
# Ports are fixed and distinct (see README): daemon 47900, gateway 47950,
# react-demo vite 5173. The solo counterpart (vue-demo) is independent on
# 5174 / loopback 47729 — run `cd examples/vue-demo && pnpm dev` separately.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEAM_TOKEN="${HARNESS_TEAM_TOKEN:-team-secret-demo}"
DAEMON_PORT=47900
GW_PORT=47950
GW_DIR="${ROOT}/.demo-gateway"
DAEMON_CLI="${ROOT}/packages/dev-cli/dist/cli.js"
GATEWAY_CLI="${ROOT}/packages/gateway/dist/cli.js"
DAEMON_LOG=/tmp/harness-team-daemon.log
GW_LOG=/tmp/harness-gateway.log

if [[ ! -f "$DAEMON_CLI" || ! -f "$GATEWAY_CLI" ]]; then
    echo "✗ Built CLIs not found. Run \`pnpm build\` first." >&2
    exit 1
fi

DAEMON_PID="" GW_PID=""
cleanup() {
    echo ""
    echo "[demo] shutting down…"
    [[ -n "$GW_PID" ]] && kill "$GW_PID" 2>/dev/null || true
    [[ -n "$DAEMON_PID" ]] && kill "$DAEMON_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# 1. Central daemon — token-secured, HTTP-MCP transport (the gateway's upstream).
HARNESS_FE_LABEL=team-central node "$DAEMON_CLI" --port "$DAEMON_PORT" --token "$TEAM_TOKEN" \
    --mcp-transport http > "$DAEMON_LOG" 2>&1 &
DAEMON_PID=$!
sleep 1.5
if ! kill -0 "$DAEMON_PID" 2>/dev/null; then
    echo "✗ central daemon failed to start. Log:" >&2; cat "$DAEMON_LOG" >&2; exit 1
fi

# 2. Gateway — fresh store each run (clean demo), admin + server + two tokens.
rm -rf "$GW_DIR"
node "$GATEWAY_CLI" --port "$GW_PORT" --data-dir "$GW_DIR" \
    --admin-user admin --admin-pass demopass \
    --add-server "name=team,endpoint=http://127.0.0.1:${DAEMON_PORT},token=${TEAM_TOKEN}" \
    --issue-token "name=agentA,server=team,scopes=read+control" \
    --issue-token "name=agentB,server=team,scopes=read" \
    > "$GW_LOG" 2>&1 &
GW_PID=$!
sleep 1.5
if ! kill -0 "$GW_PID" 2>/dev/null; then
    echo "✗ gateway failed to start. Log:" >&2; cat "$GW_LOG" >&2; exit 1
fi

# 3. Extract the issued tokens and wire react-demo's .mcp.json with agentA.
AGENT_A="$(grep 'token "agentA"' "$GW_LOG" | awk '{print $NF}')"
AGENT_B="$(grep 'token "agentB"' "$GW_LOG" | awk '{print $NF}')"
cat > "${ROOT}/examples/react-demo/.mcp.json" <<JSON
{
  "mcpServers": {
    "harness-team": {
      "type": "http",
      "url": "http://127.0.0.1:${GW_PORT}/mcp",
      "headers": { "Authorization": "Bearer ${AGENT_A}" }
    }
  }
}
JSON

# 4. Summary + next steps.
cat <<EOF

  ┌──────────────────────────────────────────────────────────────────────┐
  │  harness-fe — TEAM (multi-user, governed) topology is UP               │
  └──────────────────────────────────────────────────────────────────────┘

  central daemon   ws://127.0.0.1:${DAEMON_PORT}   (token: ${TEAM_TOKEN})
  gateway (agents) http://127.0.0.1:${GW_PORT}/mcp
  admin panel      http://127.0.0.1:${GW_PORT}/admin   (admin / demopass)

  agent tokens (scoped):
    agentA [read,control]  ${AGENT_A}
    agentB [read only]     ${AGENT_B}

  → examples/react-demo/.mcp.json wired with agentA (read+control).

  Next:
    1. Start the team app:   cd examples/react-demo && pnpm dev   (→ :5173)
    2. Open http://localhost:5173 in 2-3 browser windows = multiple users.
    3. Each window's overlay reports into the ONE central daemon; agents
       reach it only through the gateway, scoped + audited.
    4. Solo counterpart (independent):  cd examples/vue-demo && pnpm dev (→ :5174)

  Verify governance:
    • agentA can drive the browser (page.*); agentB (read) cannot — manifest
      is filtered and tools/call is scope-denied at the gateway.
    • audit log:  ${GW_DIR}/audit.jsonl
    • versions:   dashboard header badge + in-page overlay "version" row.

  Ctrl-C to tear everything down.

EOF

wait
