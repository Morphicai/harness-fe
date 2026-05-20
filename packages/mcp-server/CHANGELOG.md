# @harnessa-fe/mcp-server

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
