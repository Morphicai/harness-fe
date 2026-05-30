---
'@harness-fe/mcp-server': minor
---

Per-call caller identity for MCP tools (4.0 · P4) — the MCP layer now
identifies *which* caller made each tool call instead of collapsing every
agent to one principal.

Rather than rebuild the HTTP transport per-session, this uses the MCP SDK's
per-request `extra.requestInfo` (the originating HTTP request's headers),
which every tool handler already receives. A new `identifyPrincipal(headers,
auth)` *identifies* (never re-authorizes — the request already cleared the
bridge auth wrapper) the caller: token mode reads the `Authorization` header
into a `token:` principal; stdio (no requestInfo) and loopback resolve to
`local`; custom-authorize resolves to `host`.

`tasks.claim` / `tasks.resolve` now stamp `Task.agentId` with this per-call
principal (falling back to the daemon's local principal for stdio). This
unblocks P3 tenant filtering, which needs a real per-call principal at the
MCP layer to be meaningful. Behaviour is unchanged for solo/stdio dev.
