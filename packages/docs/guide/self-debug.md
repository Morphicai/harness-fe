# Self-debug: drive the dashboard with itself

Sometimes the thing you want to debug is the dashboard itself —
a layout bug, a chart that won't render, a WS subscriber that
stops re-fetching. The harness can drive the dashboard the same
way it drives any other host app: this guide turns that on.

## One-liner

```bash
pnpm dev:self-debug
```

That starts two processes:

| Process | What it does | Port |
|---------|--------------|------|
| mcp-server | Dedicated daemon for self-debug. Stores in `~/.harness-dev` so it doesn't touch your normal session history | **47730** |
| dashboard-ui (vite) | Dev server with `HARNESS_FE_SELF_DEBUG=1` — injects `@harness-fe/runtime` so the FAB shows up on the dashboard page | **5174** |

Open: `http://127.0.0.1:5174/dashboard/?token=dev`

Connect your agent to the dev daemon (separate from any user-project
daemon on the default 47729):

```jsonc
// claude_desktop_config.json / .cursor/mcp.json
{
  "mcpServers": {
    "harness-fe-dev": {
      "command": "npx",
      "args": ["-y", "@harness-fe/mcp-server"],
      "env": {
        "HARNESS_FE_PORT": "47730",
        "HARNESS_FE_TOKEN": "dev"
      }
    }
  }
}
```

Now the agent's `page.click` / `page.screenshot` / `project.where_is`
tools target the dashboard SPA. `project.where_is "SessionDetail"` will
jump straight to `packages/dashboard-ui/src/routes/SessionDetail.tsx`.

## Why a separate port

Your user-project daemon (the one running for your day-to-day app
dev) sits on **47729**. The self-debug daemon sits on **47730**. They
don't conflict; you can restart either without disturbing the other.
Sessions captured in each are stored in separate data dirs:

```
~/.harness       — your user-project daemon (default)
~/.harness-dev   — self-debug daemon
```

If you want different paths, override at launch:

```bash
HARNESS_FE_PORT=47731 HARNESS_FE_DATA_DIR=/tmp/harness-dev pnpm dev:self-debug
```

## Why no circular dependency

The dependency graph stays a DAG:

```
mcp-server  ──→  dashboard-ui  ──→  vite (devDep)  ──→  runtime
     │                                                     │
     └──→  protocol  ←──────────────────────────────────── ┘
```

`mcp-server` does NOT depend on `runtime` (runtime is browser-only,
daemon is Node-only). `dashboard-ui` only pulls `@harness-fe/vite`
as a **devDependency**, so the published `@harness-fe/dashboard-ui`
tarball that mcp-server serves has zero runtime code in it. Self-debug
mode lives entirely in the dev-server pipeline.

## Behavior loop

The dashboard now records itself. That's intentional — the agent can
see what the user saw. Two things keep it from getting weird:

1. Every page navigation closes the old session and opens a new one,
   so sessions don't grow without bound.
2. The dashboard's project list shows the self-debug session under
   `projectId: '@harness-fe/dashboard'`. You can recognize and
   filter it visually.

If you want the agent's clicks to NOT be recorded into your dashboard's
own session, just don't connect the agent at all — the dev mcp-server
also serves the dashboard SPA so you can use it as a plain UI.

## Disabling

Production builds (`pnpm build` → `dist/`) **never** include the
runtime, regardless of env vars — the vite config short-circuits on
`command === 'build'`. The published `@harness-fe/dashboard-ui` is
plain React. There is no way for a published dashboard to accidentally
become self-debug; you have to be running the local source tree.

## Common workflows

**Iterating on a dashboard UI change while an agent watches:**
```bash
pnpm dev:self-debug
# edit src/routes/SessionDetail.tsx
# vite HMR reloads
# ask agent: "click the 'Create replay' button on the first session row"
```

**Inspecting why a re-fetch didn't happen:**
```bash
# in dev shell:
pnpm dev:self-debug
# in agent:
> page.evaluate { expr: "Array.from(document.querySelectorAll('[data-live]')).length" }
> errors.tail { n: 20 }
```

**Recording a repro of a layout bug for a teammate:**
```bash
pnpm dev:self-debug
# open browser, reproduce
# click the FAB → "Open dashboard"
# in the new tab, click the bugged session → Create replay
# share the /replay/<exportId> link
```
