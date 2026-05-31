# Team / gateway mode

Solo dev runs a loopback daemon with no token — the agent spawns it over stdio and sees everything. Perfect for one person on one app. A **team** sharing one daemon needs more: who sees which project, who may drive the browser, and an audit trail. That's the **gateway**.

> New here? Start with [agent-setup.md](./agent-setup.md). This page is the team/shared path.

## daemon vs gateway

|  | `@harness-fe/daemon` (always) | `@harness-fe/gateway` (team only) |
|---|---|---|
| Role | capabilities + data + browser connection | the front door / governance |
| Holds | tools, event store, recording/replay, browser WS | token lifecycle, RBAC, routing, audit, admin |
| Identity | **consumes** it (tags `createdBy` / `agentId`) | **produces** it (token → caller) |
| Who needs it | everyone | teams / shared / public dev |

The gateway never implements tools or holds data — it sits **in front of** one or more daemons and forwards MCP requests, injecting the verified caller.

## Topology

```
  browsers (runtime) ──WS + write──┐
  app A, app B, app C …            ▼
                       central daemon :47900  (token, HTTP-MCP upstream)
                                    ▲
  agent ──HTTP-MCP + gateway token──┘ via  gateway :47950  ─(inject caller + projects)─┘
         (read+control, projects=…)        token → scope (RBAC) → route → audit
```

Each browser app reports into the **same** daemon as a distinct project. Agents reach it **only** through the gateway.

## Run it

```bash
# 1. central daemon — token-secured, HTTP-MCP transport
harness-fe --port 47900 --token "$SECRET" --mcp-transport http

# 2. gateway — admin + upstream daemon + a scoped agent token
harness-gateway --port 47950 --data-dir ~/.harness-fe/gateway \
  --admin-user admin --admin-pass "$PW" \
  --add-server  name=team,endpoint=http://127.0.0.1:47900,token="$SECRET" \
  --issue-token name=agentA,server=team,scopes=read+control,projects=my-app
```

Or bring up the whole spectrum (solo + team, several apps) in one command: `bash scripts/demo.sh` — see [examples/DEMO.md](../examples/DEMO.md).

Then point the agent at the gateway (`.mcp.json`):

```jsonc
{ "mcpServers": { "harness-fe": {
  "type": "http",
  "url": "http://127.0.0.1:47950/mcp",
  "headers": { "Authorization": "Bearer <agentA-token>" }
} } }
```

## Scopes (RBAC)

- **`write`** — event reporting by the browser runtime; **never** granted to agents.
- **`read`** — telemetry, sessions, recordings, source, tasks.
- **`control`** — drive the browser (`page.*`), gated by [Browser Consent](#browser-consent).

`read + control` = a full agent token. The gateway **filters `tools/list` by scope** (a `read`-only token never even sees `page.*`) and **denies out-of-scope `tools/call`** (`-32001 scope denied`).

## project→agent binding {#project-agent-binding}

A token carries `projects` — `['*']` (all) or a specific list. The gateway forwards the grants to the daemon (`x-harness-projects` header); the daemon then shows a **bound** agent the project's *whole* data set and lets it drive that project's tabs — **regardless of who created each row** (creator ≠ consumer). Without grants, visibility falls back to creator-based ownership (the solo / single-token case, where they coincide).

This is what makes a team agent actually see users' sessions: the runtime that *creates* a session and the agent that *reads* it are different principals, so binding by **project** — not by creator — is the unit of isolation.

```bash
# scope agentA to one project; it sees/controls that project only
harness-gateway --issue-token name=agentA,server=team,scopes=read+control,projects=my-app
```

## Browser Consent

With the daemon behind a token (team), `control` commands require in-page user approval before they run — the overlay shows a consent prompt (Allow once / Allow for session / Deny). Read-only tools are never gated. On loopback (solo) consent is off.

## Audit

Every gateway call is appended to `{data-dir}/audit.jsonl` (`tokenId`, `tool`, `serverId`, `ip`). Manage servers / tokens / audit in the admin panel at `http://<gateway>/admin`.

## When to use team mode

- Multiple developers / agents sharing one dev daemon.
- A shared dev VM or public dev environment.
- You need project-level isolation or an audit trail.

Otherwise stay solo — loopback, zero config, no token. See [agent-setup.md](./agent-setup.md).
