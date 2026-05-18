# Tasks: Add Load-Scoped Capture

## Phase 1: loadId protocol skeleton

- [x] 1. Extend `helloFrameSchema` with a `loadId: z.string().optional()` field (required at runtime for `role === 'runtime-client'`) and add `EVENT_NAME.PAGE_LOAD` / `EVENT_NAME.STORAGE` constants.
- [x] 2. Generate `loadId` in the `RuntimeClient` constructor (`crypto.randomUUID()`, never persisted) and include it in the `hello` frame.
- [x] 3. Reject runtime-client `hello` frames missing `loadId` with an explicit `hello.ack` error so misconfigurations surface immediately.
- [x] 4. Make `StoreEvent.load` required (when `tab` is set) in the store type, update `JsonlStore.append` to validate it, and stamp `load` from the connection registry inside the bridge before appending.
- [x] 5. Update existing `JsonlStore.test.ts`, `bridge.test.ts`, and protocol round-trip tests to cover the new required field.

## Phase 2: PAGE_LOAD event and loads.jsonl

- [x] 6. Add a runtime helper that collects the initial snapshot (page metadata, viewport, `localStorage` / `sessionStorage` full contents capped at 32 KB per value and 256 KB per snapshot, raw `document.cookie`).
- [x] 7. Send the snapshot as a `PAGE_LOAD` event immediately after `hello.ack` and before any capture installs other events.
- [x] 8. Persist the snapshot in two places: as a `t: 'load'` timeline event and as a new `LoadMeta` row appended to `tabs/{tabId}/loads.jsonl`; rewrite the prior open `LoadMeta` row's `endedAt` when a new load begins or the tab disconnects.
- [x] 9. Add `IStore.listLoads`, `IStore.getLoad`, and `IStore.sliceRecordingsByLoad` along with `TailOptions.loadId` / `SearchOptions.loadId` filters in `JsonlStore`.
- [x] 10. Cover the new APIs with tests asserting that listed loads roll back / forward correctly across multiple refreshes and tab close.

## Phase 3: fetch capture rewrite

- [ ] 11. Replace `installFetch` with a named-function patch that preserves `name`, `length`, `toString`, returns the original Promise unchanged, and exposes a dispose function.
- [ ] 12. Read response bodies via `response.clone()` on a side branch, applying the 256 KB cap, content-type routing (json / text / SSE / binary), and `truncated` flagging.
- [ ] 13. Capture and redact request and response headers (`Authorization` / `Cookie` / `x-api-key` / `x-auth-*` replaced with `[redacted <length>]`).
- [ ] 14. Emit two store events per request (`t: 'req'` and `t: 'res'`) keyed by a generated `id`, with the `req` event sent eagerly so long SSE responses are visible before completion.
- [ ] 15. Skip self-traffic via an `init.__hfeInternal` flag and a URL denylist for HMR / dev-server internals.
- [ ] 16. Add tests covering: business `instanceof Response` is preserved, `fetch.name === 'fetch'`, body truncation, SSE pump termination on cap, header redaction, and the dispose path restores the original `fetch`.

## Phase 4: XHR prototype patch

- [ ] 17. Replace the constructor-wrapping XHR patch with `XMLHttpRequest.prototype` patches for `open`, `setRequestHeader`, and `send`, storing per-instance metadata via a non-enumerable symbol.
- [ ] 18. Apply the same body / header / cap / redaction rules as fetch and emit the same `req` / `res` event pair.
- [ ] 19. Add tests proving `xhr instanceof XMLHttpRequest` holds for business code and that `addEventListener('loadend', …)` continues to fire without modification.

## Phase 5: Storage capture

- [ ] 20. Patch `Storage.prototype.setItem` / `removeItem` / `clear` to emit `EVENT_NAME.STORAGE` events for same-tab mutations, branching on `this === localStorage`.
- [ ] 21. Subscribe to `window.addEventListener('storage', …)` for cross-tab mutations.
- [ ] 22. Subscribe to `cookieStore.addEventListener('change', …)`; fall back to a 1 s polling `document.cookie` diff when `cookieStore` is unavailable.
- [ ] 23. Add tests covering each mutation path emits exactly one event with the expected shape.

## Phase 6: PerformanceObserver resource entries

- [ ] 24. Register a buffered `PerformanceObserver({ type: 'resource' })` that emits resource events for assets fetch / XHR cannot observe (img, css, font, worker, prefetch).
- [ ] 25. Add a test asserting same-document resource entries flow through with `loadId` stamped by the bridge.

## Phase 7: Dashboard load scoping

- [ ] 26. Add a load selector to the session detail view, defaulting to the newest load and offering an "All loads" aggregate.
- [ ] 27. Render the selected load's `LoadMeta.initial` snapshot summary (URL, viewport, storage key counts) at the top of the tab column.
- [ ] 28. Pass `loadId` through to `tail` / `search` / `sliceRecordingsByLoad` so timeline and recording playback are scoped to the selected load; tag each row in the "All loads" view with a load badge.

## Phase 8: MCP surface and spec archive

- [ ] 29. Expose new MCP tools `session.loads` (list) and `session.load` (get) so external agents can query loads, mirroring the existing recording tool naming.
- [ ] 30. Update the `session-observability` spec delta and archive the change once all phases are complete.

## Phase 9: Validation

- [ ] 31. Run `pnpm --filter @morphixai/harnessa-fe.protocol test` and `pnpm --filter @morphixai/harnessa-fe.mcp-server test`; both should be green.
- [ ] 32. Manually exercise the example page: refresh three times, confirm three loads appear in the dashboard with snapshots matching the actual browser state.
- [ ] 33. Issue a POST `fetch` with a JSON body and confirm the dashboard shows matching `req` / `res` entries with body content and a redacted `Authorization` header.
- [ ] 34. Trigger an SSE response and confirm the body cap kicks in with `truncated: true`.
- [ ] 35. Confirm `instanceof Response`, `instanceof XMLHttpRequest`, and `fetch.name === 'fetch'` all hold in a smoke test page that also uses axios.
