# @harnessa-fe/mcp-server

## 0.7.2

### Patch Changes

- 0cd04d9: feat(log): new `@harnessa-fe/log` isomorphic logger package

  Introduces `@harnessa-fe/log` — a zero-config structured logger that works
  identically in Server Components, Route Handlers, Server Actions, Client
  Components, and shared utilities.

  - `log.info('msg', { meta })` from any environment lands in
    `~/.harnessa/data/sessions/{sid}/timeline.jsonl` as `t: 'app-log'`
  - Session identity is resolved fresh on every call (via React `cache()` /
    AsyncLocalStorage) — no cross-request contamination possible
  - No userId in payload — agents resolve user via `sessionId → visitor` lookup
  - Scope chaining: `log.scope('a').scope('b')` emits `scope='a.b'`
  - Silent on missing runtime (optional peer deps on node-runtime and runtime)

  **@harnessa-fe/node-runtime**: adds `reportAppLog()` method + `AppLogContext`
  type for the new explicit log path (distinct from auto-captured console).

  **@harnessa-fe/mcp-server**: adds `EventType = 'app-log'`, bridge now writes
  `t: 'app-log'` rows for `app.log` frames (previously would have stored `t:
'app.log'` — now consistent with `server-log` / `server-err` naming), and
  the dashboard renders app-log events with a distinct soft-purple tag.

## 0.7.1

### Patch Changes

- ff8cc7d: Fix: bridge now stamps `visitorId` on every event row

  Pre-fix, `~/.harnessa/data/sessions/{sid}/timeline.jsonl` rows carried `projectId` and `buildId` but not `visitorId`, even though the bridge knew the visitor identity from the peer's hello frame. As a result, agents could read the visitor's metadata (firstSeenAt / sessionCount / tabIds) and could enumerate the visitor's sessions via `visitor.journey`, but couldn't filter a single session's timeline rows to events from one specific visitor — important when the same session has parent + iframe child apps with separate visitors.

  The bridge now stamps `visitorId` from `frame.visitorId ?? peer.visitorId` on every `appendEvent` call. `StoreEvent.visitorId` is the new optional field.

## 0.7.0

### Minor Changes

- c4a1f59: feat: Edge Runtime HTTP transport (Phase 1)

  - `@harnessa-fe/protocol`: add `httpBatchSchema` / `HttpBatch` for stateless POST /events
  - `@harnessa-fe/mcp-server`: new `POST /events` + `GET /events/ping` HTTP endpoints; `Bridge.handleHttpBatch()` routes batches into the same session timeline as the WebSocket path
  - `@harnessa-fe/node-runtime`: `Transport` interface + `WsTransport` (existing behaviour) + `HttpBatchTransport` (fetch-based, 500ms flush, 50-event batching, 5xx retry, outbox cap); automatic selection via `NEXT_RUNTIME=edge` / `HARNESSA_FE_TRANSPORT=http`; `ws` moved to optional peer dependency; new `./auto-edge` export
  - `@harnessa-fe/next`: webpack plugin injects `@harnessa-fe/node-runtime/auto-edge` into edge-runtime bundles (webworker target)

### Patch Changes

- c4a1f59: chore: remove pre-1.0 read-compat shims (Phase 2)

  **Breaking change for on-disk data older than v0.4:**

  - Removed `LegacyBuildSessionMeta` and `LegacyLoadMeta` types
  - Removed `TailOptions.loadId` and `SearchOptions.loadId` deprecated fields
  - Removed `_detectLegacyLayout()` — replaced by per-chunk stderr warning when a recording chunk lacks `chunkId`
  - Removed 8 `load: loadId` double-stamp fields from bridge event rows

  If you have on-disk data from a daemon older than v0.4, run `rm -rf ~/.harnessa/data` to start fresh.

- Updated dependencies [c4a1f59]
  - @harnessa-fe/protocol@0.7.0
