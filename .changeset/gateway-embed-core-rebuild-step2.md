---
"@harness-fe/gateway": minor
---

Rebuild ② — the gateway becomes the only front door, embedding `@harness-fe/core`
in-process instead of forwarding to a remote daemon.

- `/mcp` — hosts the MCP server directly against the core capability API (no
  HTTP forwarding). The session's `Principal` is resolved through the Policy and
  baked in, so `tools/list` is the scoped manifest (a read-only token never even
  sees `page.*`) and every call re-checks scope in core. Calls are audited.
- `/ws` — terminates the runtime WebSocket, resolves a write-scope principal,
  adapts the socket to core's `PeerSocket`, and hands it to `acceptPeer`.
- `/events` — HTTP-batch ingest → `core.handleHttpBatch`.
- `/console` — replay viewer + a capability-backed JSON data API + an SPA mount
  (the React console-ui lands in step ③). `/admin` governance panel kept.
- **Policy**: `Open` (loopback solo — no tokens, no audit) | `Governed` (team
  tokens → scoped principal + project grants + audit). A `write` token is just a
  scoped gateway token, so a leaked browser token can never read or drive.
- Auth + principal resolution now live in the gateway (`principal.ts` /
  `policy.ts`); core only consumes a resolved `Principal`.

The old forwarding `createGateway({ store })` shape is replaced by
`createGateway({ coreClient, policy, store })`. The old daemon / mcp-server /
dev-cli packages are untouched and still work until the later steps retire them.
