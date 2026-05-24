# @harness-fe/next

## 3.0.1

### Patch Changes

- Updated dependencies [3cb3cc8]
  - @harness-fe/runtime@3.0.1

## 3.0.0

### Patch Changes

- Updated dependencies [10d669c]
- Updated dependencies [953339f]
  - @harness-fe/runtime@3.0.0
  - @harness-fe/node-runtime@3.0.0

## 2.0.0

### Patch Changes

- @harness-fe/node-runtime@2.0.0
- @harness-fe/runtime@2.0.0

## 1.0.2

### Patch Changes

- 74be490: 1.0.2 — coordinated patch across the linked group

  **Functional changes:**

  - `@harness-fe/node-runtime` — auto-captured server-side `console.*` calls now inherit the request's `sessionId` automatically when used with `@harness-fe/next`. Previously they became orphans unless the handler was wrapped with `withHarnessTracing`. Mechanism: a new `setSessionIdProvider(fn)` dependency-injection setter; the Next adapter pushes its `cache()`-backed getter in on first render. ALS still wins when populated; orphan behaviour unchanged when no adapter is loaded.
  - `@harness-fe/log` — node-side emit path simplified to delegate sessionId resolution to `node-runtime.getRequestSessionId()`. Same observable behaviour; less duplicated logic. Peer-dependency declarations cleaned up — the dynamic-import contract is described in the README instead.
  - `@harness-fe/next` — `sessionId.ts` module side-effect-registers its `cache()` getter with node-runtime via `setSessionIdProvider`. No new exports.

  **Release plumbing:**

  - Republish `@harness-fe/log` after the 24-hour cooldown from a prior unpublish. Defensive listing covering all 10 linked packages so the bump is genuinely lockstep.
  - `scripts/release-publish.sh` handles the npm "Cannot implicitly apply latest tag to a version lower than current latest" case by publishing under a staging tag and then explicitly moving `latest` via `npm dist-tag add`.

  **Docs (shipping with the release):**

  - New READMEs for `packages/log`, `packages/next`, `packages/node-runtime`.
  - New `VISION.md` (three nested mission directions) and `docs/troubleshooting.md`.
  - `ARCHITECTURE.md` — new section explaining server-side sessionId resolution chain (ALS → adapter provider → orphan).
  - `ROADMAP.md` reframed around the three mission directions.

- Updated dependencies [74be490]
  - @harness-fe/runtime@1.0.2
  - @harness-fe/node-runtime@1.0.2

## 1.0.0

### Minor Changes

- 2019214: Version alignment: reset `@harness-fe/log` and `@harness-fe/next` to the 0.9.x line, locking all core packages together via `linked` in `.changeset/config.json`

  Background: `@harness-fe/log`'s initial Changesets minor bump took it to **1.0.0** (Changesets treats brand-new packages as starting at 1.0.0 unless explicitly minor-bumped from a prior 0.x), then the next minor pushed it to 2.0.0 — leaving the rest of the ecosystem at 0.6–0.9 while `log` and `next` (which transitively bumped) sat at 2.0. Functionally fine, but cosmetically off.

  With no public consumer of this package yet, accepting the inconvenience of a version downgrade is cheap. The previous `log@{1.0.0, 2.0.0, 2.0.1}` and `next@{1.0.0, 2.0.0}` releases will be deprecated on npmjs.com pointing to 0.9.x as the canonical line.

  This changeset bumps **every** core package by `minor` so they all land at the same 0.x.0 going forward, plus locks them via `linked` so future bumps stay in lockstep. Also includes the Turbopack-fix browser/node split for `@harness-fe/log` that was previously queued as a patch.

### Patch Changes

- Updated dependencies [2019214]
  - @harness-fe/runtime@1.0.0
  - @harness-fe/node-runtime@1.0.0

## 2.0.0

### Patch Changes

- Updated dependencies [d2b1733]
  - @harness-fe/node-runtime@0.9.0

## 1.0.0

### Patch Changes

- Updated dependencies [0cd04d9]
  - @harness-fe/node-runtime@0.8.0

## 0.8.0

### Minor Changes

- 044d2d7: `<HarnessScript>` auto-boots `@harness-fe/node-runtime` on first server render

  Previously, getting server-side capture (Server Component errors, Route Handler / Server Action durations, uncaught Node exceptions) required users to write an `instrumentation.ts` file by hand AND enable `experimental.instrumentationHook`. With Turbopack, even `withHarness()`'s webpack-plugin injection silently no-ops — leaving Turbopack users with no path other than the manual instrumentation file.

  Now: the Server Component `<HarnessScript>` itself triggers `register()` on its very first server render, behind a process-level `globalThis` singleton so HMR module reloads don't re-init. Works identically on webpack and Turbopack because it doesn't rely on bundler-plugin hooks. Edge Runtime is supported via the `@harness-fe/node-runtime/auto-edge` entry, which is selected automatically when `NEXT_RUNTIME === 'edge'`.

  `@harness-fe/node-runtime` is now an optional peer dependency of `@harness-fe/next` — apps that don't want server-side capture can omit it; the auto-boot will log a warning and skip. `instrumentation.ts` continues to work for users who need precise control over boot ordering (e.g. registering before other middleware).

## 0.7.1

### Patch Changes

- Updated dependencies [88af49d]
  - @harness-fe/runtime@0.6.4

## 0.7.0

### Minor Changes

- c4a1f59: feat: Edge Runtime HTTP transport (Phase 1)

  - `@harness-fe/protocol`: add `httpBatchSchema` / `HttpBatch` for stateless POST /events
  - `@harness-fe/mcp-server`: new `POST /events` + `GET /events/ping` HTTP endpoints; `Bridge.handleHttpBatch()` routes batches into the same session timeline as the WebSocket path
  - `@harness-fe/node-runtime`: `Transport` interface + `WsTransport` (existing behaviour) + `HttpBatchTransport` (fetch-based, 500ms flush, 50-event batching, 5xx retry, outbox cap); automatic selection via `NEXT_RUNTIME=edge` / `HARNESS_FE_TRANSPORT=http`; `ws` moved to optional peer dependency; new `./auto-edge` export
  - `@harness-fe/next`: webpack plugin injects `@harness-fe/node-runtime/auto-edge` into edge-runtime bundles (webworker target)

### Patch Changes

- @harness-fe/runtime@0.6.3
