# @harness-fe/core

## 4.0.0-next.12

### Patch Changes

- 2453e70: **consent `deny` mode + 1 GiB storage cap**

  - Add `consent: 'deny'` mode — all control commands (`page.click`, `page.type`, etc.) are rejected immediately without any user prompt. Safe default for production deployments.
  - **Change default consent from `off` to `deny`**. Previously unguarded control commands ran freely unless `--governed` was passed; now control is disabled by default and must be explicitly enabled.
  - Add `maxTotalBytes` to `RetentionPolicy` (default 1 GiB). After all other pruning passes, oldest sessions are evicted until the data directory falls below the cap.
  - Add `HARNESS_MAX_STORAGE_BYTES` environment variable and `--max-storage-bytes` support. Override the cap with `-e HARNESS_MAX_STORAGE_BYTES=<bytes>` in Docker. Set to `0` to disable.
  - Docker image now sets `ENV HARNESS_MAX_STORAGE_BYTES=1073741824` (1 GiB) by default.

- Updated dependencies [2453e70]
  - @harness-fe/protocol@4.0.0-next.12

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
