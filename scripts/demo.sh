#!/usr/bin/env bash
#
# demo.sh — bring up the harness-fe demo on this machine, in one command, on the
# latest local build (workspace:* packages + the dist that `pnpm build` just
# produced).
#
# Rebuilt architecture: ONE gateway with an in-process core is the only front
# door. Every app's in-page runtime connects to the gateway's `/ws` with a
# write-scope token; agents reach it through `/mcp` with scoped tokens; humans
# use `/console` (+ `/admin`).
#
#       react-demo ─────────WS──┐
#       webpack-demo ───────WS──┤
#       webpack5-vue3-demo ─WS──┼─> gateway :47950  /ws  (write token)
#       iframe parent+child WS──┤            /mcp  (agentA read+control · agentB read)
#       vue-demo ───────────WS──┘            /console + /admin
#
# Each app reports as a DISTINCT project; one multi-project agent token lets the
# agent see/control them all. The solo (zero-config stdio) path is shown by the
# `harness-solo` entry in .mcp.json — an agent spawns `harness`, which serves its
# own loopback /ws + stdio MCP.
#
# All dev servers are driven by ONE `turbo run` (unified live logs, single
# Ctrl-C). This script only stands up the gateway + tokens; turbo owns the apps.
#
# Ports: gateway 47950 · apps 47810 vue · 47811 react · 47812 webpack ·
#        47813 webpack5-vue3 · 47814 iframe-parent · 47815 iframe-child.
#
# Ctrl-C tears everything down.
set -euo pipefail

# ── Fixed demo credentials (throwaway test values, deliberately stable) ────────
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ADMIN_USER=admin
ADMIN_PASS=demopass
GW_PORT=47950
GW_DIR="${ROOT}/.demo-gateway"          # governance store (git-ignored, persistent)
CORE_DIR="${ROOT}/.demo-core"           # core sessions/events (git-ignored)
CONSOLE_DIR="${ROOT}/packages/console-ui/dist"
TOKENS_ENV="${GW_DIR}/agent-tokens.env" # cached raw tokens (git-ignored)
CLI="${ROOT}/packages/cli/dist/cli.js"
LOG_DIR=/tmp/harness-demo
GW_LOG="${LOG_DIR}/gateway.log"
# The SOLO gateway: an Open-policy `harness` (no token / RBAC / audit; one trusted
# `local` principal) that hosts the single zero-config example app (vue-demo).
# Separate core + port from the team gateway.
SOLO_PORT=47951
SOLO_CORE_DIR="${ROOT}/.demo-solo-core"  # solo (Open) core sessions (git-ignored)
SOLO_LOG="${LOG_DIR}/solo.log"

# The GOVERNED projects, by reported projectId. The agent tokens are scoped to this
# set; each app's plugin config pins the matching projectId. vue-demo is NOT here —
# it's the solo example and connects to the Open gateway (no token, no scope).
PROJECTS="react-demo+webpack-demo+webpack5-vue3-demo+iframe-parent+iframe-child"

if [[ ! -f "$CLI" ]]; then
    echo "✗ Built CLI not found ($CLI). Run \`pnpm build\` first (or use \`pnpm demo\`)." >&2
    exit 1
fi

mkdir -p "$LOG_DIR"
PIDS=()
kill_tree() {
    local pid="$1" child
    for child in $(pgrep -P "$pid" 2>/dev/null); do kill_tree "$child"; done
    kill "$pid" 2>/dev/null || true
}
cleanup() {
    echo ""
    echo "[demo] shutting down (turbo + gateway)…"
    for pid in "${PIDS[@]:-}"; do
        [[ -n "$pid" ]] && kill_tree "$pid"
    done
}
trap cleanup EXIT
trap 'exit 130' INT TERM

# Preflight: the gateway port + every app port must be free.
for spec in "gateway:${GW_PORT}" "solo-gateway:${SOLO_PORT}" \
            "vue-demo:47810" "react-demo:47811" "webpack-demo:47812" \
            "webpack5-vue3-demo:47813" "iframe parent:47814" "iframe child:47815"; do
    name="${spec%%:*}"; port="${spec##*:}"
    holder="$(lsof -nP -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
    if [[ -n "$holder" ]]; then
        echo "✗ port ${port} (${name}) is already in use by PID ${holder}." >&2
        echo "  A previous demo is probably still running. Free it with:  kill ${holder}" >&2
        exit 1
    fi
done

# ── 1. The gateway (in-process core). PERSISTENT store → stable tokens across runs.
# First run: start fresh, issue the three tokens (runtime[write], agentA, agentB),
# cache the raw strings (the gateway keeps only a scrypt hash — unrecoverable
# afterwards). Later runs: reuse the store + cached tokens, DON'T re-issue.
#
# The cache is trusted ONLY if it carries all three tokens. A partial/stale cache
# (e.g. one written before `runtime` existed) forces a clean re-issue — otherwise
# a missing token would surface much later as an `unbound variable` in the summary.
RUNTIME_TOKEN=""; AGENT_A=""; AGENT_B=""
if [[ -f "$TOKENS_ENV" ]]; then
    # shellcheck disable=SC1090
    source "$TOKENS_ENV"                        # → RUNTIME_TOKEN, AGENT_A, AGENT_B
fi
if [[ -n "$RUNTIME_TOKEN" && -n "$AGENT_A" && -n "$AGENT_B" ]]; then
    node "$CLI" --governed --port "$GW_PORT" --data-dir "$GW_DIR" --core-data-dir "$CORE_DIR" \
        --console-dir "$CONSOLE_DIR" --admin-user "$ADMIN_USER" --admin-pass "$ADMIN_PASS" \
        > "$GW_LOG" 2>&1 &
    FRESH=0
else
    rm -rf "$GW_DIR" "$CORE_DIR"   # absent/partial cache → consistent fresh issue
    node "$CLI" --governed --port "$GW_PORT" --data-dir "$GW_DIR" --core-data-dir "$CORE_DIR" \
        --console-dir "$CONSOLE_DIR" --admin-user "$ADMIN_USER" --admin-pass "$ADMIN_PASS" \
        --issue-token "name=runtime,scopes=write,projects=${PROJECTS}" \
        --issue-token "name=agentA,scopes=read+control,projects=${PROJECTS}" \
        --issue-token "name=agentB,scopes=read,projects=${PROJECTS}" \
        > "$GW_LOG" 2>&1 &
    FRESH=1
fi
GW_PID=$!
PIDS+=("$GW_PID")
sleep 1.5
if ! kill -0 "$GW_PID" 2>/dev/null; then
    echo "✗ gateway failed to start. Log:" >&2; cat "$GW_LOG" >&2; exit 1
fi

if [[ "$FRESH" -eq 1 ]]; then
    RUNTIME_TOKEN="$(grep 'token "runtime"' "$GW_LOG" | awk '{print $NF}')"
    AGENT_A="$(grep 'token "agentA"' "$GW_LOG" | awk '{print $NF}')"
    AGENT_B="$(grep 'token "agentB"' "$GW_LOG" | awk '{print $NF}')"
    if [[ -z "$RUNTIME_TOKEN" || -z "$AGENT_A" || -z "$AGENT_B" ]]; then
        echo "✗ failed to capture issued tokens from gateway log. Log:" >&2; cat "$GW_LOG" >&2; exit 1
    fi
    printf 'RUNTIME_TOKEN=%s\nAGENT_A=%s\nAGENT_B=%s\n' "$RUNTIME_TOKEN" "$AGENT_A" "$AGENT_B" > "$TOKENS_ENV"
fi

# ── 1b. The SOLO gateway — Open policy (no token, no RBAC, no audit; one trusted
# `local` principal). vue-demo connects HERE instead of the governed gateway,
# demonstrating the zero-config end of the spectrum. Serves the same console SPA.
rm -rf "$SOLO_CORE_DIR"
node "$CLI" --port "$SOLO_PORT" --core-data-dir "$SOLO_CORE_DIR" --console-dir "$CONSOLE_DIR" \
    > "$SOLO_LOG" 2>&1 &
SOLO_PID=$!
PIDS+=("$SOLO_PID")
sleep 1
if ! kill -0 "$SOLO_PID" 2>/dev/null; then
    echo "✗ solo gateway failed to start. Log:" >&2; cat "$SOLO_LOG" >&2; exit 1
fi

# ── 2. Wire the root .mcp.json: one agent, both ends of the spectrum.
#   harness-solo → `harness` over stdio (Open, zero-config, its own loopback /ws)
#   harness-team → gateway /mcp (RBAC, multi-project), agentA = read+control
cat > "${ROOT}/.mcp.json" <<JSON
{
  "mcpServers": {
    "harness-solo": {
      "type": "stdio",
      "command": "node",
      "args": ["${CLI}"]
    },
    "harness-team": {
      "type": "http",
      "url": "http://127.0.0.1:${GW_PORT}/mcp",
      "headers": { "Authorization": "Bearer ${AGENT_A}" }
    }
  }
}
JSON

# ── 3. Summary, then hand the dev servers to turbo.
cat <<EOF

  ┌──────────────────────────────────────────────────────────────────────┐
  │  harness-fe demo — one gateway (in-process core), many projects        │
  └──────────────────────────────────────────────────────────────────────┘

  GATEWAY (the only front door)
    mcp (agents)   http://127.0.0.1:${GW_PORT}/mcp
    ws  (runtimes) ws://127.0.0.1:${GW_PORT}/ws        (write token)
    console        http://127.0.0.1:${GW_PORT}/console
    admin panel    http://127.0.0.1:${GW_PORT}/admin   (${ADMIN_USER} / ${ADMIN_PASS})
    tokens         runtime [write]        → ${RUNTIME_TOKEN}
                   agentA  [read,control] → ${AGENT_A}
                   agentB  [read only]    → ${AGENT_B}
                   (fixed across runs — cached in ${TOKENS_ENV};
                    all scoped to: ${PROJECTS//+/, })

  SOLO GATEWAY (Open — no token/RBAC/audit; hosts the one zero-config app)
    ws  (runtime)  ws://127.0.0.1:${SOLO_PORT}/ws
    console        http://127.0.0.1:${SOLO_PORT}/console   (vue-demo only)

  APPS
    vue-demo            http://localhost:47810   → SOLO gateway :${SOLO_PORT}
    react-demo          http://localhost:47811   → team gateway :${GW_PORT}
    webpack-demo        http://localhost:47812   → team gateway :${GW_PORT}
    webpack5-vue3-demo  http://localhost:47813   → team gateway :${GW_PORT}
    iframe parent       http://localhost:47814   (child 47815 proxied under /child)

  AGENT CONFIG  → ${ROOT}/.mcp.json
    harness-solo (stdio → a fresh \`harness\`, Open/zero-config)
    harness-team (http  → gateway, all projects, agentA)

  AUDIT ${GW_DIR}/audit.jsonl
  GATEWAY LOG  ${GW_LOG}
  SOLO LOG     ${SOLO_LOG}

  Below are turbo's live, per-app compile logs — wait for each app's "ready"
  line, then open the URLs (several browser windows each = distinct visitors).
  Ctrl-C in THIS terminal stops everything.

EOF

# turbo drives all dev servers as persistent tasks. The four governed apps read the
# runtime WRITE token from HARNESS_TEAM_TOKEN and connect to the team gateway /ws;
# vue-demo ignores the token and connects to the solo gateway /ws (its config pins
# 47951). Each app's config pins its /ws target + projectId.
export HARNESS_TEAM_TOKEN="$RUNTIME_TOKEN"
cd "$ROOT"
turbo run dev dev:parent dev:child --filter='./examples/*' --ui=stream &
PIDS+=("$!")
wait || true
