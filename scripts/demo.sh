#!/usr/bin/env bash
#
# demo.sh — bring up the WHOLE harness-fe demo spectrum on this machine, in one
# command, all on the latest local build (workspace:* packages + the dist that
# `pnpm build` just produced):
#
#   SOLO (zero-config, one app)         vue-demo ──stdio──> loopback daemon 47729
#
#   TEAM (governed, ONE shared service, MANY projects)
#       react-demo ──────────WS──┐
#       webpack-demo ────────WS──┤
#       webpack5-vue3-demo ──WS──┼─> central daemon :47900 (token, HTTP-MCP)
#       iframe parent+child ─WS──┘            ▲
#                                             │
#       agent ─HTTP-MCP + multi-project token─┴─> gateway :47950 ─(inject caller)
#
# Every TEAM app reports into the SAME central daemon as a DISTINCT project; one
# multi-project agent token (issued by the gateway) lets the agent see/control
# all of them at once. The single SOLO app stays on the friction-free loopback
# path (no token, no gateway) to show the other end of the spectrum.
#
# The root .mcp.json is wired with BOTH servers, so one agent sees:
#   • harness-solo  (stdio  → loopback daemon, vue-demo)
#   • harness-team  (http   → gateway → central daemon, all team projects)
#
# All dev servers are driven by ONE `turbo run` so you get unified, prefixed,
# live logs (and a single Ctrl-C stops them). The shell script only stands up
# the daemon + gateway + tokens; turbo owns the apps.
#
# Ports live in a dedicated 478xx band, deliberately off the common 5173/3000/
# 8080 defaults so the demo never fights another dev server for a port:
#   infra  loopback 47729 · central daemon 47900 · gateway 47950
#   apps   47810 vue(solo) · 47811 react · 47812 webpack · 47813 webpack5-vue3
#          47814 iframe-parent · 47815 iframe-child
#
# Ctrl-C tears everything down.
set -euo pipefail

# ── Fixed demo credentials ────────────────────────────────────────────────────
# These are throwaway *test* values, deliberately fixed (not random) so the
# topology is stable across runs and the wired .mcp.json never churns. Override
# the daemon token with HARNESS_TEAM_TOKEN if you like.
#   • central daemon token — browsers use it to reach the shared daemon
#   • admin panel login     — http://127.0.0.1:<gw>/admin
#   • agent gateway tokens  — issued ONCE on first run, then cached + reused
#     (the gateway stores only a scrypt hash, so the raw token can't be
#      recovered later; we persist it in the git-ignored gateway dir).
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEAM_TOKEN="${HARNESS_TEAM_TOKEN:-team-secret-demo}"
ADMIN_USER=admin
ADMIN_PASS=demopass
DAEMON_PORT=47900
GW_PORT=47950
CENTRAL_URL="ws://127.0.0.1:${DAEMON_PORT}"
GW_DIR="${ROOT}/.demo-gateway"
TOKENS_ENV="${GW_DIR}/agent-tokens.env"   # cached raw agent tokens (git-ignored)
DAEMON_CLI="${ROOT}/packages/dev-cli/dist/cli.js"
GATEWAY_CLI="${ROOT}/packages/gateway/dist/cli.js"
LOG_DIR=/tmp/harness-demo
DAEMON_LOG="${LOG_DIR}/daemon.log"
GW_LOG="${LOG_DIR}/gateway.log"

# Every TEAM app, by reported projectId. The gateway token is scoped to exactly
# this set, and each app's plugin config pins the matching projectId.
TEAM_PROJECTS="react-demo+webpack-demo+webpack5-vue3-demo+iframe-parent+iframe-child"

if [[ ! -f "$DAEMON_CLI" || ! -f "$GATEWAY_CLI" ]]; then
    echo "✗ Built CLIs not found. Run \`pnpm build\` first (or use \`pnpm demo\`)." >&2
    exit 1
fi

mkdir -p "$LOG_DIR"
# Only the daemon + gateway are tracked here; turbo owns the dev servers and
# cleans them up itself when it exits. kill_tree handles any grandchild procs.
PIDS=()
kill_tree() {
    local pid="$1" child
    for child in $(pgrep -P "$pid" 2>/dev/null); do kill_tree "$child"; done
    kill "$pid" 2>/dev/null || true
}
cleanup() {
    echo ""
    echo "[demo] shutting down (turbo + daemon + gateway)…"
    for pid in "${PIDS[@]:-}"; do
        [[ -n "$pid" ]] && kill_tree "$pid"
    done
}
# Run cleanup exactly once: INT/TERM just exit, the EXIT trap does the teardown.
trap cleanup EXIT
trap 'exit 130' INT TERM

# Preflight: every port the demo uses must be free, so the central daemon comes
# up as the HTTP-MCP *leader* (a stale daemon silently demotes it to a follower
# with no HTTP upstream) and every app binds its advertised port. A leftover
# process from a previous run is the usual cause — abort with a clear hint
# rather than booting a half-broken topology.
for spec in "central daemon:${DAEMON_PORT}" "gateway:${GW_PORT}" \
            "vue-demo (solo):47810" "react-demo:47811" "webpack-demo:47812" \
            "webpack5-vue3-demo:47813" "iframe parent:47814" "iframe child:47815"; do
    name="${spec%%:*}"; port="${spec##*:}"
    holder="$(lsof -nP -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
    if [[ -n "$holder" ]]; then
        echo "✗ port ${port} (${name}) is already in use by PID ${holder}." >&2
        echo "  A previous demo is probably still running. Free it with:  kill ${holder}" >&2
        exit 1
    fi
done

# ── 1. Shared service: central daemon (token, HTTP-MCP upstream for the gateway).
HARNESS_FE_LABEL=team-central node "$DAEMON_CLI" --port "$DAEMON_PORT" --token "$TEAM_TOKEN" \
    --mcp-transport http > "$DAEMON_LOG" 2>&1 &
DAEMON_PID=$!
PIDS+=("$DAEMON_PID")
sleep 1.5
if ! kill -0 "$DAEMON_PID" 2>/dev/null; then
    echo "✗ central daemon failed to start. Log:" >&2; cat "$DAEMON_LOG" >&2; exit 1
fi

# ── 2. Gateway: PERSISTENT store so the issued tokens are stable across runs.
# First run: start fresh, issue the two multi-project tokens, cache the raw
# strings (the gateway keeps only a scrypt hash — unrecoverable afterwards).
# Later runs: reuse the store and the cached tokens, and DON'T re-issue (the
# gateway's --issue-token isn't idempotent — it would pile up duplicates).
# admin + server registration are idempotent, so they're passed every time.
if [[ -f "$TOKENS_ENV" ]]; then
    node "$GATEWAY_CLI" --port "$GW_PORT" --data-dir "$GW_DIR" \
        --admin-user "$ADMIN_USER" --admin-pass "$ADMIN_PASS" \
        --add-server "name=team,endpoint=http://127.0.0.1:${DAEMON_PORT},token=${TEAM_TOKEN}" \
        > "$GW_LOG" 2>&1 &
else
    rm -rf "$GW_DIR"   # ensure store + token cache are consistent on a fresh issue
    node "$GATEWAY_CLI" --port "$GW_PORT" --data-dir "$GW_DIR" \
        --admin-user "$ADMIN_USER" --admin-pass "$ADMIN_PASS" \
        --add-server "name=team,endpoint=http://127.0.0.1:${DAEMON_PORT},token=${TEAM_TOKEN}" \
        --issue-token "name=agentA,server=team,scopes=read+control,projects=${TEAM_PROJECTS}" \
        --issue-token "name=agentB,server=team,scopes=read,projects=${TEAM_PROJECTS}" \
        > "$GW_LOG" 2>&1 &
fi
GW_PID=$!
PIDS+=("$GW_PID")
sleep 1.5
if ! kill -0 "$GW_PID" 2>/dev/null; then
    echo "✗ gateway failed to start. Log:" >&2; cat "$GW_LOG" >&2; exit 1
fi

if [[ -f "$TOKENS_ENV" ]]; then
    # shellcheck disable=SC1090
    source "$TOKENS_ENV"                       # → AGENT_A, AGENT_B (stable)
else
    AGENT_A="$(grep 'token "agentA"' "$GW_LOG" | awk '{print $NF}')"
    AGENT_B="$(grep 'token "agentB"' "$GW_LOG" | awk '{print $NF}')"
    printf 'AGENT_A=%s\nAGENT_B=%s\n' "$AGENT_A" "$AGENT_B" > "$TOKENS_ENV"
fi

# ── 3. Wire the root .mcp.json: one agent, both ends of the spectrum.
#   harness-solo → loopback daemon over stdio (latest local-built dev-cli)
#   harness-team → gateway (RBAC, multi-project), agentA = read+control
cat > "${ROOT}/.mcp.json" <<JSON
{
  "mcpServers": {
    "harness-solo": {
      "type": "stdio",
      "command": "node",
      "args": ["${DAEMON_CLI}"]
    },
    "harness-team": {
      "type": "http",
      "url": "http://127.0.0.1:${GW_PORT}/mcp",
      "headers": { "Authorization": "Bearer ${AGENT_A}" }
    }
  }
}
JSON

# ── 4. Summary, then hand the dev servers to turbo.
cat <<EOF

  ┌──────────────────────────────────────────────────────────────────────┐
  │  harness-fe demo — SOLO + TEAM (one shared service, many projects)     │
  └──────────────────────────────────────────────────────────────────────┘

  SHARED SERVICE
    central daemon   ${CENTRAL_URL}   (token: ${TEAM_TOKEN})
    gateway (agents) http://127.0.0.1:${GW_PORT}/mcp
    admin panel      http://127.0.0.1:${GW_PORT}/admin   (${ADMIN_USER} / ${ADMIN_PASS})
    agent tokens     agentA [read,control]  → ${AGENT_A}
                     agentB [read only]     → ${AGENT_B}
                     (fixed across runs — cached in ${TOKENS_ENV};
                      both scoped to: ${TEAM_PROJECTS//+/, })

  TEAM apps  (each a distinct project in the ONE central daemon)
    react-demo          http://localhost:47811
    webpack-demo        http://localhost:47812
    webpack5-vue3-demo  http://localhost:47813
    iframe parent       http://localhost:47814   (child 47815 proxied under /child)

  SOLO app  (zero-config, loopback daemon 47729, no token/gateway)
    vue-demo            http://localhost:47810

  AGENT CONFIG  → ${ROOT}/.mcp.json
    harness-solo (stdio → loopback, vue-demo)
    harness-team (http  → gateway, all team projects, agentA)

  AUDIT ${GW_DIR}/audit.jsonl
  INFRA LOGS  daemon → ${DAEMON_LOG} · gateway → ${GW_LOG}

  Below are turbo's live, per-app compile logs — wait for each app's "ready"
  line, then open the URLs (several browser windows each = distinct visitors).
  Ctrl-C in THIS terminal stops everything; nothing exits on its own.

EOF

# turbo drives all six dev servers as persistent tasks: react/vue/webpack* expose
# `dev`, iframe exposes `dev:parent` + `dev:child`. The team apps read the daemon
# token from HARNESS_TEAM_TOKEN (their configs hard-code the 47900 target); the
# solo app's config ignores it, so no env leaks the team target into solo.
# --ui=stream keeps the summary above visible (the default tui would clear it).
export HARNESS_TEAM_TOKEN="$TEAM_TOKEN"
cd "$ROOT"
turbo run dev dev:parent dev:child --filter='./examples/*' --ui=stream &
PIDS+=("$!")   # tracked so cleanup (kill_tree) stops turbo's vite/webpack children
# Block until interrupted; INT/TERM → exit → EXIT trap tears everything down.
wait || true
