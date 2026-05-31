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
#       webpack-demo ───────WS──┼─> team gateway :47950  /ws (write token) · /mcp · /console + /admin
#       webpack5-vue3-demo ─WS──┤            (agentA read+control · agentB read)
#       iframe parent+child WS──┘
#
#       vue-demo ───────────WS──┬─> solo gateway :47951  (Open, AUTO-SPAWNED + shared)
#       harness-solo (mcp) ─────┘            /ws + /mcp + /console
#
# The 4 team apps report as DISTINCT projects; one multi-project agent token lets
# the agent see/control them all. vue-demo is the SOLO example: its dev server (or
# the `harness-solo` mcp launcher — whoever starts first) AUTO-SPAWNS one shared
# Open gateway on :47951; the other end reuses it. No manual solo start.
#
# All dev servers are driven by ONE `turbo run` (unified live logs, single
# Ctrl-C). This script stands up the TEAM gateway + tokens; turbo owns the apps;
# the SOLO gateway (:47951) is auto-spawned by vue-demo / the mcp launcher.
#
# Ports: team gateway 47950 · solo gateway 47951 · apps 47810 vue · 47811 react ·
#        47812 webpack · 47813 webpack5-vue3 · 47814 iframe-parent · 47815 iframe-child.
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
# The SOLO gateway (Open — no token/RBAC/audit; one trusted `local` principal)
# hosts the single zero-config example app (vue-demo). It is NOT started here —
# whoever comes up first AUTO-SPAWNS it: vue-demo's dev server (via the build
# plugin) or the `harness-solo` mcp launcher. Both pin the same port + data dirs
# below so they reuse ONE shared gateway. Separate core/port from the team gateway.
SOLO_PORT=47951
SOLO_CORE_DIR="${ROOT}/.demo-solo-core"        # solo (Open) core sessions (git-ignored)
SOLO_GW_DIR="${ROOT}/.demo-solo-gateway"       # solo (Open) gateway store (git-ignored)

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
    echo "[demo] shutting down (turbo + gateways)…"
    for pid in "${PIDS[@]:-}"; do
        [[ -n "$pid" ]] && kill_tree "$pid"
    done
    # The solo gateway is auto-spawned detached (not in PIDS) — free its port too.
    local solo; solo="$(lsof -nP -tiTCP:"$SOLO_PORT" -sTCP:LISTEN 2>/dev/null || true)"
    [[ -n "$solo" ]] && kill $solo 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 130' INT TERM

# Preflight. A gateway port (team + solo) may legitimately be held by a stale
# harness gateway from a previous run that didn't shut down cleanly — that's a
# *service*, not a conflict, so reclaim it (kill + wait) instead of bailing. A
# non-harness process on the port, or any app-port clash, IS a real conflict.
reclaim_gateway_port() {
    local port="$1" name="$2" holder
    holder="$(lsof -nP -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
    [[ -z "$holder" ]] && return 0
    if curl -sf --max-time 1 "http://127.0.0.1:${port}/console/api/meta" >/dev/null 2>&1; then
        echo "[demo] ${name} :${port} held by a stale harness gateway (PID ${holder}) — reclaiming."
        kill $holder 2>/dev/null || true
        for _ in 1 2 3 4 5 6 7 8 9 10; do
            lsof -nP -tiTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1 || return 0
            sleep 0.3
        done
        echo "✗ ${name} :${port} still held after kill (PID ${holder})." >&2; exit 1
    fi
    echo "✗ port ${port} (${name}) is in use by a non-harness process (PID ${holder})." >&2
    echo "  Free it with:  kill ${holder}" >&2
    exit 1
}
reclaim_gateway_port "$GW_PORT" "team gateway"
reclaim_gateway_port "$SOLO_PORT" "solo gateway"

# App ports must be free — a clash there is a real conflict (another dev server).
for spec in "vue-demo:47810" "react-demo:47811" "webpack-demo:47812" \
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

# ── 1b. The SOLO gateway is NOT started here — it's auto-spawned on demand by
# whoever comes up first (vue-demo's dev server via the build plugin, or the
# `harness-solo` mcp launcher). Clear its data dirs so each run starts clean.
rm -rf "$SOLO_CORE_DIR" "$SOLO_GW_DIR"

# ── 2. Wire the root .mcp.json: one agent, both ends of the spectrum.
#   harness-solo → `harness mcp`: reuses (or auto-spawns) the shared solo gateway
#                  on :47951 and proxies stdio MCP to its /mcp (sees vue-demo).
#   harness-team → gateway /mcp (RBAC, multi-project), agentA = read+control
cat > "${ROOT}/.mcp.json" <<JSON
{
  "mcpServers": {
    "harness-solo": {
      "type": "stdio",
      "command": "node",
      "args": ["${CLI}", "mcp", "--port", "${SOLO_PORT}", "--core-data-dir", "${SOLO_CORE_DIR}", "--data-dir", "${SOLO_GW_DIR}"]
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

  SOLO GATEWAY (Open — auto-spawned + shared; hosts the one zero-config app)
    (started on demand by vue-demo's dev server OR the harness-solo mcp launcher)
    ws  (runtime)  ws://127.0.0.1:${SOLO_PORT}/ws
    mcp (agent)    http://127.0.0.1:${SOLO_PORT}/mcp
    console        http://127.0.0.1:${SOLO_PORT}/console   (vue-demo; live once it or the agent starts)

  APPS
    vue-demo            http://localhost:47810   → SOLO gateway :${SOLO_PORT} (auto-spawned)
    react-demo          http://localhost:47811   → team gateway :${GW_PORT}
    webpack-demo        http://localhost:47812   → team gateway :${GW_PORT}
    webpack5-vue3-demo  http://localhost:47813   → team gateway :${GW_PORT}
    iframe parent       http://localhost:47814   (child 47815 proxied under /child)

  AGENT CONFIG  → ${ROOT}/.mcp.json
    harness-solo (stdio → \`harness mcp\`: reuses/auto-spawns the shared :${SOLO_PORT} solo gateway)
    harness-team (http  → team gateway :${GW_PORT}, all projects, agentA)

  AUDIT ${GW_DIR}/audit.jsonl
  GATEWAY LOG  ${GW_LOG}

  Below are turbo's live, per-app compile logs — wait for each app's "ready"
  line, then open the URLs (several browser windows each = distinct visitors).
  Ctrl-C in THIS terminal stops everything.

EOF

# turbo drives all dev servers as persistent tasks. The four governed apps read the
# runtime WRITE token from HARNESS_TEAM_TOKEN and connect to the team gateway /ws.
# vue-demo (solo, no token) auto-spawns the shared :47951 gateway via the build
# plugin; HARNESS_CORE_DATA_DIR / HARNESS_GATEWAY_DATA_DIR point that spawned
# gateway at the demo's isolated dirs (not the user's global ~/.harness-fe).
export HARNESS_TEAM_TOKEN="$RUNTIME_TOKEN"
export HARNESS_CORE_DATA_DIR="$SOLO_CORE_DIR"
export HARNESS_GATEWAY_DATA_DIR="$SOLO_GW_DIR"
cd "$ROOT"
turbo run dev dev:parent dev:child --filter='./examples/*' --ui=stream &
PIDS+=("$!")
wait || true
