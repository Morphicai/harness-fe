# Tasks: Embeddable Daemon + SSE Last-Event-ID Resumption

## Phase 1: SSE Last-Event-ID resumption (PR 1)

- [x] 1. Confirm the pinned `@modelcontextprotocol/sdk` version exposes the `eventStore` option on `StreamableHTTPServerTransport`; bump if needed. (Confirmed `1.29.0` installed, `eventStore` exposed on `StreamableHTTPServerTransportOptions`.)
- [x] 2. Re-export the SDK's `EventStore` / `StreamId` / `EventId` types from `packages/mcp-server/src/store/types.ts` so consumers can plug in without depending on the SDK directly.
- [x] 3. Implement `MemoryEventStore` (`packages/mcp-server/src/store/MemoryEventStore.ts`) — per-`streamId` bounded ring with configurable event-count and TTL caps and a global byte ceiling.
- [x] 4. Plumb an optional `eventStore` argument through `startMcpHttpServer` in `mcpHttp.ts`; default to `new MemoryEventStore()` when absent. `null` opts out of resumability.
- [x] 5. Unit tests for `MemoryEventStore`: append, replay-after, eviction by count, eviction by age, eviction by global byte cap, stream-id recovery, never-reuse-ids.
- [x] 6. Wiring test in `mcpHttp.test.ts`: custom `EventStore`, `null` opt-out, and explicit `MemoryEventStore` all mount cleanly. (Full drop-and-resume integration deferred — requires a real MCP session handshake; will land alongside the embeddable-daemon example in PR 2.)
- [ ] 7. Optional follow-up: `JsonlEventStore` for hosts that want durability across daemon restarts. Skip if PR 1 is already large; track as a separate task.

## Phase 2: `createDaemon` factory + embeddable surface (PR 2)

- [x] 8. Extract daemon bootstrap into `packages/mcp-server/src/daemon.ts`. `createDaemon(opts) -> DaemonHandle` with `start`, `stop`, `getBoundPort`, `getViewerBaseUrl`, `bridge`, `mcpPath`. Factory-mode only in v1 — `httpServer` injection and `middleware()` form deferred to a follow-up.
- [x] 9. `DaemonOptions` defined: `port?`, `host?`, `publicHost?`, `authorize?`, `store?`, `taskStore?`, `memoryStore?`, `eventStore?`, `dataDir?`, `label?`, `mcpPath?`, `mcpStateful?`.
- [x] 10. Single auth path: `AuthOptions.authorize?` added in `auth.ts`; `isAuthorized` consults the function when supplied, else falls back to token. The built-in login form is suppressed in custom-authorize mode.
- [x] 11. `cli.ts` rewritten as a thin wrapper around `createDaemon`. `--token` translates to a `tokenAuthorizer(token)` so the daemon has exactly one auth pipeline. `HARNESS_FE_DATA_DIR` / `HARNESS_FE_LABEL` / `defaultDataDir(port)` resolution stays in the CLI layer.
- [x] 12. `index.ts` re-exports `createDaemon`, `DaemonOptions`, `DaemonHandle`, `defaultDataDir`, `MemoryEventStore`, `MemoryEventStoreOptions`, `EventStore`/`EventId`/`StreamId` types, `startMcpHttpServer` types, and the additional store classes.
- [x] 13. `daemon.test.ts` covers: ephemeral-port boot, idempotent start/stop, `authorize` invoked + rejection, bridge escape hatch, custom `mcpPath`. Full suite 244/244 pass.
- [x] 14. `examples/embed-express/` ships a runnable Node example (no Express dep needed — uses node:http) wiring `createDaemon` next to a host HTTP server with custom Bearer auth.
- [x] 15. Package README gains an "Embedding the daemon programmatically" section with a minimal snippet and a scope note on v1 limits.

## Phase 3: Spec + docs

- [x] 16. `session-observability` spec delta already covers both resumable SSE and embeddable daemon contracts — final API matches; no further changes needed.
- [x] 17. ROADMAP 1.1.x ticks "Embeddable daemon (v1)" with a note that host-server attachment is a follow-up.
