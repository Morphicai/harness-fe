# @harness-fe/core

## 4.0.0-next.8

### Patch Changes

- Updated dependencies [7274a6c]
  - @harness-fe/protocol@4.0.0-next.8

## 4.0.0-next.6

### Patch Changes

- 46775be: Align the linked package group onto a single 4.0.0-next line.

  The gateway/console work only touched some packages, so changesets left the linked
  group split — `log`/`react-jsx` were still 3.x, `next`/`node-runtime` on older 4.0
  prereleases, while gateway/runtime/etc were at next.5. This is a version-only bump
  (no code change) so consumers (morphix, tanka) can install ONE consistent
  4.0.0-next.x set without mixing `@harness-fe/protocol` majors.

- Updated dependencies [46775be]
  - @harness-fe/protocol@4.0.0-next.6

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
