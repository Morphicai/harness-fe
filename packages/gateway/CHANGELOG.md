# @harness-fe/gateway

## 4.0.0-next.3

### Minor Changes

- 44a7cc7: Publish @harness-fe/gateway (5.0 · P6 · C6) — the governance gateway is now
  functionally complete and verified end-to-end, so it leaves `private`.

  End-to-end: a real daemon (createDaemon + token + HTTP MCP) behind the gateway;
  an MCP `initialize` flows agent → gateway → daemon — exercising routing,
  daemon-token auth, `x-harness-caller` injection, and `mcp-session-id`
  passthrough (fixed a gap where stateful MCP sessions weren't forwarded).

  Complete feature set: argon2-free scrypt token lifecycle, token→server
  routing + MCP forwarding, scope RBAC + dynamic manifest, append-only audit,
  and a plain-HTML admin panel. Zero native deps (JSON store + node:crypto).
