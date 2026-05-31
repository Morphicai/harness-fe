# Connecting your agent to harness-fe

harness-fe is driven by an AI agent (Claude Code, Cursor, Kiro). Two things make that work:

1. **The skill** — teaches the agent *how* to use harness-fe (which tool for which symptom).
2. **The MCP server** — gives the agent the actual tools (`page.*`, `*.tail`, `project.*`, `tasks.*`, …).

**Do the skill first.** It's the difference between "you spell out every tool call" and "you describe the bug, the agent drives."

---

## 1. Install the skill (recommended first)

```bash
npx @harness-fe/skill install        # auto-detects Claude Code / Cursor / Kiro
```

This drops a curated playbook into your IDE's skill / rules directory:

- **Mental model** — project / build / tab / session, and how they relate.
- **Tool catalog** — every MCP tool, grouped by job (drive the page, tail telemetry, read source, triage tasks).
- **Decision flows** — "visual bug", "wrong endpoint", "micro-frontend error", "what happened before the crash", task triage, and the fix → re-drive → verify loop.
- **Source-aware selectors** — how `data-morphix-loc` / `data-morphix-comp` jump from a DOM element straight to `file:line`.

Targets: `claude` (Claude Code), `cursor`, `kiro`, or `plain`. Inspect what's installed with `npx @harness-fe/skill print` or `npx @harness-fe/skill where`.

### Why the skill, not just the tools?

Without the skill, the agent sees a flat list of MCP tools and has to *guess* the workflow. With it, a plain-English report — *"the submit button does nothing"* — maps to a known flow: read console/network → find the component source → fix → re-drive → verify. **Lower cognitive load for you; fewer wrong turns for the agent.** You stop being the agent's tool-router.

---

## 2. Wire the MCP server

Pick the entry that matches your setup (see [the decision table in the README](../README.md#which-path-are-you-on)).

### Solo / local — zero config

```jsonc
{
  "mcpServers": {
    "harness-fe": { "type": "stdio", "command": "npx", "args": ["-y", "@harness-fe/dev-cli"] }
  }
}
```

The agent spawns the daemon itself over stdio. Loopback is fully trusted — **no token**. Multiple agent windows share one daemon (leader/follower), so they all see the same browser.

### Team / shared daemon — through the gateway

```jsonc
{
  "mcpServers": {
    "harness-fe": {
      "type": "http",
      "url": "http://127.0.0.1:47950/mcp",
      "headers": { "Authorization": "Bearer <gateway-token>" }
    }
  }
}
```

Agents reach a shared daemon **only** through the gateway, which enforces scope (RBAC) + project→agent binding + audit. Full guide: **[gateway-team-mode.md](./gateway-team-mode.md)**.

---

## 3. Make sure the app is instrumented

The agent can only see an app that loaded the runtime. Add the build plugin (`@harness-fe/vite` / `@harness-fe/webpack`) or, for Next.js, `@harness-fe/next` + `@harness-fe/react-jsx`. See [Getting Started](../README.md#getting-started).

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Agent: *"no runtime-client connected"* | The dev page isn't open, or its `mcpUrl` / token doesn't match the daemon you're querying. |
| Tools missing from the agent | Skill not installed, or `.mcp.json` not picked up — restart the IDE / reload MCP. |
| Team mode: agent sees no sessions | Its token isn't bound to that project — see [project→agent binding](./gateway-team-mode.md#project-agent-binding). |

More: [docs/troubleshooting.md](./troubleshooting.md).
