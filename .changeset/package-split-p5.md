---
'@harness-fe/core': minor
'@harness-fe/gateway': minor
'@harness-fe/cli': minor
---

Package split (5.0 · P5) — the monolithic `@harness-fe/gateway` is split
into three packages along the architecture's layering, with **zero behaviour
change** and **no user-facing breakage**.

- **`@harness-fe/core`** (new) — the daemon core: capability API, event
  store, browser control, WS bridge, identity/auth/consent/scoping. Everything
  that touches data or the browser connection.
- **`@harness-fe/gateway`** — now a thin MCP protocol layer
  (`createMcpServer` + stdio/HTTP transports + `createDaemon`), depending on
  `@harness-fe/core`. Re-exports daemon's public API so existing imports keep
  working; keeps a `harness-fe` bin shim that forwards to dev-cli.
- **`@harness-fe/cli`** (new) — the solo-dev launcher (`harness-fe` bin):
  arg parsing, leader/follower, banner, open-browser. Glue over daemon +
  mcp-server.

Layering is single-directional (`dev-cli → mcp-server → daemon`, no cycles).
`createDaemon` stays in mcp-server (it orchestrates Bridge + MCP HTTP, so it
can't live in daemon without a cycle). `openBrowser` lives in daemon (the
`dashboard.open` tool needs it). Full suites green: daemon 282 + mcp-server 29
= the pre-split 311, plus runtime-client 110 — zero regression.
