# Team mode (gateway)

Solo dev runs a loopback gateway with no token — the agent auto-spawns it over
stdio and sees everything. Perfect for one person on one app. A **team** sharing
one gateway needs more: who sees which project, who may drive the browser, and an
audit trail. That's **governed mode**.

> New here? Start with the [Quickstart](./quickstart.md) (solo path). This page is
> the team / shared path, added in 4.0.

## How it works

`harness --governed` is a single process that combines the core (data + browser
bridge) and the governance layer (tokens, RBAC, audit) in one binary. There is no
separate daemon — the gateway *is* the data store.

```
  browsers (runtime) ──WS write token──┐
  app A, app B, app C …                ▼
                       harness --governed :47950
                       (/ws  — browser runtime, write-only tokens)
                       (/mcp — agents, RBAC + audit)
                       (/console — back-office UI)
                       (/admin   — token/server management)
                                    ▲
  agents ──HTTP-MCP + bearer token──┘
  (read+control, projects=…)
```

Each browser app connects over `/ws` with a write-scope token; it can only push
data, never read it. Agents connect over `/mcp` with a read+control token scoped
to specific projects.

## Run it

```bash
harness --governed \
  --port 47950 \
  --admin-user admin --admin-pass "$PW" \
  --issue-token name=runtime,scopes=write \
  --issue-token name=agentA,scopes=read+control,projects=my-app
```

Point agents at `/mcp` (`.mcp.json`):

```jsonc
{ "mcpServers": { "harness-fe": {
  "type": "http",
  "url": "http://127.0.0.1:47950/mcp",
  "headers": { "Authorization": "Bearer <agentA-token>" }
} } }
```

Point each app's build plugin at `/ws` with the runtime token:

```ts
// vite.config.ts
harnessFE({ mcpUrl: 'ws://127.0.0.1:47950/ws', token: '<runtime-token>', projectId: 'my-app' })

// next.config.mjs
withHarness({ /* …config… */ }, { mcpUrl: 'ws://127.0.0.1:47950/ws', token: '<runtime-token>', projectId: 'my-app' })
```

## Scopes (RBAC)

- **`write`** — event reporting by the browser runtime; **never** granted to agents.
- **`read`** — telemetry, sessions, recordings, source, tasks.
- **`control`** — drive the browser (`page.*`), gated by [Consent & runtime control](./consent.md).

`read + control` = a full agent token. The gateway **filters `tools/list` by scope**
(a `read`-only token never even sees `page.*`) and **denies out-of-scope
`tools/call`** (`-32001 scope denied`).

## Project → agent binding {#project-agent-binding}

A token carries `projects` — `['*']` (all) or a specific list. The gateway scopes
what the agent can see and drive to exactly those projects.

This is what makes a team agent actually see users' sessions: the runtime that
*creates* a session and the agent that *reads* it are different principals, so
binding by **project** — not by creator — is the unit of isolation.

```bash
# agentA sees/controls only my-app
harness --governed --issue-token name=agentA,scopes=read+control,projects=my-app
```

::: tip Default-deny (4.0)
A token with **no** `projects` grant now sees **zero** projects — it can't even
enumerate them. Visibility is opt-in by grant, not opt-out. `local` / loopback
solo is unaffected (sees everything).
:::

## Audit

Every MCP call is appended to `{data-dir}/audit.jsonl` (`tokenId`, `tool`, `ip`).
Manage tokens and view the audit log in the admin panel at `http://<gateway>/admin`.

## When to use team mode

- Multiple developers / agents sharing one gateway.
- A shared dev VM or public dev environment.
- You need project-level isolation or an audit trail.

Otherwise stay solo — loopback, zero config, no token. See the
[Quickstart](./quickstart.md).
