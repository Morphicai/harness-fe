# @harness-fe/core

## 4.0.0-next.5

### Minor Changes

- 2fa80f1: Rebuild ① — introduce `@harness-fe/core`, the transport-agnostic backend.

  `core` is a pure library (no HTTP/WS server, binds no port): the `Principal`
  identity model + `canSee`/`canSeeProject`/`projectGrant` visibility (now with a
  `scopes` field so a write-only runtime client is denied every read/control
  capability), the JSONL session / task / memory stores, the session router,
  visitor timeline + replay export, a `Bridge` decoupled from the socket via the
  `PeerSocket` abstraction (`acceptPeer(socket, principal)`), a scope- and
  visibility-enforced capability API, and the `CoreClient` interface with its
  in-process implementation. The gateway will own the front door and drive core
  through `CoreClient`.

  This is the foundation step of the architecture rebuild; the old
  `daemon`/`mcp-server` packages are untouched and continue to work until the
  later steps wire the gateway on top and retire them.
