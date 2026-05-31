---
"@harness-fe/cli": minor
---

Rebuild ④ — introduce `@harness-fe/cli`, the single launcher (`harness`).

- `harness` (solo, zero-config): Open policy. Boots an in-process core + a
  loopback gateway (serving `/ws` for the browser runtime and `/console`) and an
  MCP server over **stdio** for the agent that spawned it. This is what an
  `mcp.json` `command` points at — no tokens, no audit.
- `harness --governed` (team): Governed policy over HTTP — `/mcp` (agents, RBAC +
  audit), `/ws` (write tokens), `/console` + `/admin`. Bootstraps an admin and
  issues tokens from flags.

Replaces `@harness-fe/dev-cli` (retired in the final step). Multi-window solo
(several IDE windows sharing one core via leader/follower) needs the remote
CoreClient and is intentionally deferred — run one solo instance per machine.
