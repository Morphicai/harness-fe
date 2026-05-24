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

- [ ] 8. Extract daemon bootstrap from `cli.ts` into `packages/mcp-server/src/daemon.ts` with a `createDaemon(opts)` factory and a `DaemonHandle` return type (`start`, `stop`, `middleware`, `handle`).
- [ ] 9. Define `DaemonOptions`: `port?`, `host?`, `httpServer?`, `mount?`, `store?`, `eventStore?`, `auth?`, `token?` (mutually exclusive with `auth`).
- [ ] 10. Route the existing token flag through `auth` internally so there is one auth pipeline, not two.
- [ ] 11. Rewrite `cli.ts` as a thin wrapper that maps CLI flags onto `DaemonOptions` and calls `createDaemon(...).start()`. Logs, defaults, and observable behaviour unchanged.
- [ ] 12. Re-export `createDaemon`, `DaemonOptions`, `DaemonHandle`, `IStore`, `EventStore`, `MemoryEventStore` from `packages/mcp-server/src/index.ts`.
- [ ] 13. Tests: factory boots in `httpServer`-attached mode; `middleware()` mode boots under a minimal Express host; the injected `auth` hook is invoked per request; a custom `IStore` receives writes; CLI smoke test still passes.
- [ ] 14. Add a `packages/mcp-server/examples/embed-express/` example wiring `createDaemon` into an Express app with a custom auth hook.
- [ ] 15. Update package README with the embedding section and a minimal snippet.

## Phase 3: Spec + docs

- [ ] 16. Update the `session-observability` spec delta under `specs/` to absorb the new event-replay contract and the embeddable-daemon surface.
- [ ] 17. Cross-link from `ROADMAP.md` (1.1.x) to the shipped change so the milestone reflects reality.
