# Connecting your agent to harness-fe

harness-fe is driven by an AI agent (Claude Code, Cursor, Kiro). Two things make that work:

1. **The skill** — teaches the agent *how* to use harness-fe (which tool for which symptom).
2. **The MCP server** — gives the agent the actual tools (`page.*`, `*.tail`, `project.*`, `tasks.*`, …).

**Do the skill first.** It's the difference between "you spell out every tool call" and "you describe the bug, the agent drives."

---

## 1. Install the skill (recommended first)

```bash
npx @harness-fe/skill@latest install # auto-detects Claude Code / Cursor / Kiro
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

Pick the entry that matches your setup.

### Solo / local — zero config

```jsonc
{
  "mcpServers": {
    "harness-fe": { "type": "stdio", "command": "npx", "args": ["-y", "@harness-fe/cli@latest", "mcp"] }
  }
}
```

`harness mcp` auto-spawns a shared gateway (`harness serve`) on `127.0.0.1:47729` the first time, then proxies the agent's stdio MCP traffic to it. Subsequent IDE windows reuse the same gateway — all agents see the same browser state, no configuration needed.

Loopback is fully trusted — **no token**.

### Team / shared gateway

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

Agents connect to a shared `harness --governed` gateway, which enforces scope (RBAC) + project→agent binding + audit. Full guide: **[gateway-team-mode.md](gateway-team-mode.md)**.

---

## 3. Make sure the app is instrumented

The agent can only see an app that loaded the runtime. Add the build plugin (`@harness-fe/vite` / `@harness-fe/webpack`) or, for Next.js, `@harness-fe/next` + `@harness-fe/react-jsx`. See [Getting Started](../README.md#getting-started).

---

## Troubleshooting

### Upgrade an existing machine

Publishing a new npm version makes it available to new installations; existing
global installs, project lockfiles and running processes keep their old code.

```bash
# Inspect the installed package; this does not start a gateway
npx -y @harness-fe/cli@latest --version

# For an existing global install
npm install -g @harness-fe/cli@latest

# Install the agent playbook if it is absent
npx -y @harness-fe/skill@latest install
```

The skill installer refuses to overwrite an existing playbook. Update an
existing managed skill through its manager, or back it up and reconcile local
customizations with the new package's `SKILL.md` before replacing it.

Restart the managed gateway with the upgraded CLI, preserving its existing
`--core-data-dir`, `--data-dir`, port and policy options, then reload the agent's
MCP connection. The launcher reuses an existing shared gateway; reloading MCP
alone does not replace that process. Governed services should use their normal
service manager restart procedure.

Check `/console/api/meta`'s `gatewayVersion` or MCP initialization's
`serverInfo.version` to identify the **running** package version. `protocolVersion`
and the legacy `daemonVersion` identify the wire protocol, not the npm release.
For reproducible evaluations, pin the verified release in the MCP entry and
dependency lockfile instead of floating `@latest` during a run.

| Symptom | Likely cause |
|---|---|
| Agent: *"no runtime-client connected"* | The dev page isn't open, or its `mcpUrl` / token doesn't match the gateway you're querying. |
| Tools missing from the agent | Skill not installed, or `.mcp.json` not picked up — restart the IDE / reload MCP. |
| Team mode: agent sees no sessions | Its token isn't bound to that project — see [project→agent binding](gateway-team-mode.md). |

More: [docs/troubleshooting.md](troubleshooting.md).
