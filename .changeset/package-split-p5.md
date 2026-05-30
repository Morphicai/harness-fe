---
'@harness-fe/daemon': minor
'@harness-fe/mcp-server': minor
'@harness-fe/dev-cli': minor
---

Package split (5.0 · P5) — the monolithic `@harness-fe/mcp-server` is split
into three packages along the architecture's layering, with **zero behaviour
change** and **no user-facing breakage**.

- **`@harness-fe/daemon`** (new) — the daemon core: capability API, event
  store, browser control, WS bridge, identity/auth/consent/scoping. Everything
  that touches data or the browser connection.
- **`@harness-fe/mcp-server`** — now a thin MCP protocol layer
  (`createMcpServer` + stdio/HTTP transports + `createDaemon`), depending on
  `@harness-fe/daemon`. Re-exports daemon's public API so existing imports keep
  working; keeps a `harness-fe` bin shim that forwards to dev-cli.
- **`@harness-fe/dev-cli`** (new) — the solo-dev launcher (`harness-fe` bin):
  arg parsing, leader/follower, banner, open-browser. Glue over daemon +
  mcp-server.

Layering is single-directional (`dev-cli → mcp-server → daemon`, no cycles).
`createDaemon` stays in mcp-server (it orchestrates Bridge + MCP HTTP, so it
can't live in daemon without a cycle). `openBrowser` lives in daemon (the
`dashboard.open` tool needs it). Full suites green: daemon 282 + mcp-server 29
= the pre-split 311, plus runtime-client 110 — zero regression.
