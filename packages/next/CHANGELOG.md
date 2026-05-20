# @harnessa-fe/next

## 1.0.0

### Minor Changes

- 2019214: Version alignment: reset `@harnessa-fe/log` and `@harnessa-fe/next` to the 0.9.x line, locking all core packages together via `linked` in `.changeset/config.json`

  Background: `@harnessa-fe/log`'s initial Changesets minor bump took it to **1.0.0** (Changesets treats brand-new packages as starting at 1.0.0 unless explicitly minor-bumped from a prior 0.x), then the next minor pushed it to 2.0.0 — leaving the rest of the ecosystem at 0.6–0.9 while `log` and `next` (which transitively bumped) sat at 2.0. Functionally fine, but cosmetically off.

  Since morphicai-web is the only consumer and hasn't shipped publicly, accepting the inconvenience of a version downgrade is cheap. The previous `log@{1.0.0, 2.0.0, 2.0.1}` and `next@{1.0.0, 2.0.0}` releases will be deprecated on npmjs.com pointing to 0.9.x as the canonical line.

  This changeset bumps **every** core package by `minor` so they all land at the same 0.x.0 going forward, plus locks them via `linked` so future bumps stay in lockstep. Also includes the Turbopack-fix browser/node split for `@harnessa-fe/log` that was previously queued as a patch.

### Patch Changes

- Updated dependencies [2019214]
  - @harnessa-fe/runtime@1.0.0
  - @harnessa-fe/node-runtime@1.0.0

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
