---
'@harness-fe/mcp-server': patch
'@harness-fe/gateway': patch
---

Fix two governance bugs that blocked the multi-agent (team) path, found while
verifying the gateway end to end.

- **mcp-server: MCP HTTP is now per-session.** It used a single shared
  transport+server created once at mount, so the *second* `initialize` (a second
  agent through the gateway, or any reconnect) hit `-32600 "Server already
  initialized"` and locked out everyone but the first client. Now each
  `mcp-session-id` gets its own transport+server (the spec's stateful model),
  created on initialize and torn down on close; unknown session ids are rejected
  with 400. Multiple agents can now share one daemon concurrently.
- **gateway: dynamic manifest filtering now works over SSE.** `tools/list`
  replies come back as `text/event-stream`, and the proxy only filtered plain
  JSON — so a `read`-only token still saw every `control` tool (`page.click`,
  `page.type`, …). The proxy now rewrites the JSON-RPC payload inside each
  SSE `data:` line. Verified live: a `read` token's manifest drops from 11
  `page.*` tools to 2 (the read-only `page.dom_query` / `page.screenshot`),
  while `read,control` keeps all 11.

Both are bug fixes — no API change. Covered by a new per-session regression test
(two concurrent initializes get distinct session ids) plus the existing
filterManifest unit tests; manifest-over-SSE was confirmed with a live two-token
client run through the gateway.
