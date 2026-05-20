# @harnessa-fe/mcp-server

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
