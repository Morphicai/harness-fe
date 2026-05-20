# @harnessa-fe/next

## 2.0.0

### Patch Changes

- Updated dependencies [d2b1733]
  - @harnessa-fe/node-runtime@0.9.0

## 1.0.0

### Patch Changes

- Updated dependencies [0cd04d9]
  - @harnessa-fe/node-runtime@0.8.0

## 0.8.0

### Minor Changes

- 044d2d7: `<HarnessaScript>` auto-boots `@harnessa-fe/node-runtime` on first server render

  Previously, getting server-side capture (Server Component errors, Route Handler / Server Action durations, uncaught Node exceptions) required users to write an `instrumentation.ts` file by hand AND enable `experimental.instrumentationHook`. With Turbopack, even `withHarnessa()`'s webpack-plugin injection silently no-ops — leaving Turbopack users with no path other than the manual instrumentation file.

  Now: the Server Component `<HarnessaScript>` itself triggers `register()` on its very first server render, behind a process-level `globalThis` singleton so HMR module reloads don't re-init. Works identically on webpack and Turbopack because it doesn't rely on bundler-plugin hooks. Edge Runtime is supported via the `@harnessa-fe/node-runtime/auto-edge` entry, which is selected automatically when `NEXT_RUNTIME === 'edge'`.

  `@harnessa-fe/node-runtime` is now an optional peer dependency of `@harnessa-fe/next` — apps that don't want server-side capture can omit it; the auto-boot will log a warning and skip. `instrumentation.ts` continues to work for users who need precise control over boot ordering (e.g. registering before other middleware).

## 0.7.1

### Patch Changes

- Updated dependencies [88af49d]
  - @harnessa-fe/runtime@0.6.4

## 0.7.0

### Minor Changes

- c4a1f59: feat: Edge Runtime HTTP transport (Phase 1)

  - `@harnessa-fe/protocol`: add `httpBatchSchema` / `HttpBatch` for stateless POST /events
  - `@harnessa-fe/mcp-server`: new `POST /events` + `GET /events/ping` HTTP endpoints; `Bridge.handleHttpBatch()` routes batches into the same session timeline as the WebSocket path
  - `@harnessa-fe/node-runtime`: `Transport` interface + `WsTransport` (existing behaviour) + `HttpBatchTransport` (fetch-based, 500ms flush, 50-event batching, 5xx retry, outbox cap); automatic selection via `NEXT_RUNTIME=edge` / `HARNESSA_FE_TRANSPORT=http`; `ws` moved to optional peer dependency; new `./auto-edge` export
  - `@harnessa-fe/next`: webpack plugin injects `@harnessa-fe/node-runtime/auto-edge` into edge-runtime bundles (webworker target)

### Patch Changes

- @harnessa-fe/runtime@0.6.3
