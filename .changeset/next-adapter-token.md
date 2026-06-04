---
"@harness-fe/next": minor
---

`HarnessScript` and `withHarness` now accept a `token` for governed (team)
gateways. It's appended to the gateway URL as `?token=` for BOTH the browser
runtime (via `window.__HARNESS_FE__.mcpUrl`) and the server node-runtime (via
`HARNESS_FE_TOKEN` → the auto entry's `withToken`). Previously the Next adapter
only wired the solo (no-token) path, so apps couldn't connect to a governed
gateway without hand-appending the token to `mcpUrl`.
