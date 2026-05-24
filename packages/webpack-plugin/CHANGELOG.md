# @harness-fe/webpack

## 3.0.0

### Patch Changes

- Updated dependencies [65f2b96]
- Updated dependencies [88e41a2]
- Updated dependencies [10d669c]
  - @harness-fe/protocol@3.0.0
  - @harness-fe/unplugin@3.0.0

## 2.1.0

### Minor Changes

- 538e8b1: `@harness-fe/webpack` is now a native webpack plugin. The
  `@harness-fe/unplugin/webpack` subpath export is removed.

  API surface is unchanged — `harnessFE()` still takes the same options and
  returns a plugin instance you can drop into `plugins: [...]`. The package
  just stops going through unplugin's webpack adapter under the hood.

  ### Why

  unplugin's webpack adapter passes the plugin instance through a loader's
  `options` field. The plugin instance closes over `compiler` (via the
  `webpack(compiler)` hook), and `compiler.root` self-references the compiler.
  JSON.stringify chokes on the cycle, which crashes any project that uses
  **thread-loader** anywhere in the resolved loader chain.

  This bites Vue 2 + TypeScript projects in particular: vue-loader inlines
  the user's `.ts` rule loaders for `<script lang="ts">` virtual sub-modules,
  so even projects that never put thread-loader on `.vue` directly end up
  with `[thread-loader, harness-loader]` chains and crash with:

  ```
  Converting circular structure to JSON
    --> starting at object with constructor 'Compiler'
    |   property 'root' closes the circle
  ```

  ### What changed

  - `@harness-fe/webpack` is now a hand-written webpack plugin with an
    independent loader file whose options are pure JSON-serializable data.
    Worker processes forward collected component locations back to the main
    process via `module.buildMeta.harnessCollected`, which the main-process
    plugin aggregates in `compilation.succeedModule`.
  - `@harness-fe/unplugin` removes the `./webpack` subpath export.
    Importing it directly will fail at resolve time. Vite / Rspack / esbuild
    / Rollup adapters are unchanged.

  ### Migration

  If you previously imported from `@harness-fe/unplugin/webpack`:

  ```diff
  - import { harnessFE } from '@harness-fe/unplugin/webpack'
  + import { harnessFE } from '@harness-fe/webpack'
  ```

  The call signature is identical. Any code already using
  `@harness-fe/webpack` directly just needs the dep bump — no source change.

### Patch Changes

- Updated dependencies [538e8b1]
  - @harness-fe/unplugin@2.1.0

## 2.0.0

### Minor Changes

- 5d02bbf: LAN-friendly daemon with token auth, MCP-over-HTTP transport, and Vue 2
  syntax hardening.

  **Daemon (`@harness-fe/mcp-server`)**

  - New CLI flags: `--host`, `--port`, `--token [value|auto]`,
    `--mcp-transport <stdio|http>`, `--mcp-path`, `--public-host`. Matching
    env vars: `HARNESS_FE_HOST`, `HARNESS_FE_TOKEN`, etc.
  - Refuses to bind a non-loopback host without `--token` to prevent
    accidental LAN exposure of console / network / DOM recordings.
  - Token auth is enforced once at the bridge HTTP/WS edge, so the
    dashboard, replay viewer, events handler, and MCP HTTP transport all
    share the same gate. Browsers get an HTML login form; agents/CLIs use
    `Authorization: Bearer`. Cookie, query, and WS subprotocol carriers
    are also accepted.
  - MCP-over-HTTP transport via `StreamableHTTPServerTransport`, mounted
    on the bridge HTTP server at `--mcp-path` (default `/mcp`). Lets a
    remote Claude Code / Cursor share one daemon with the dev machine.
  - `npx @harness-fe/mcp-server` now works (shebang fixed, postbuild
    chmod, `engines.node >= 18`).

  **Protocol (`@harness-fe/protocol`)**

  - Added `DEFAULT_HOST`, `isLoopbackHost`, `buildWsUrl`, `buildHttpUrl`.

  **Plugin (`@harness-fe/unplugin` + vite/webpack wrappers)**

  - `HarnessFEOptions.token` — appended to the daemon WS URL and threaded
    through `__HARNESS_FE__` so the runtime client connects under LAN
    mode.
  - `HarnessFEOptions.safeMode` (default `true`) — Vue SFC transform
    now strict-downgrades on `compiler-sfc` errors, wraps walk in
    try/catch, and re-parses its own output. Legacy Vue 2 syntax (filters,
    `<template functional>`, …) is silently skipped instead of risking a
    corrupt template fed downstream.
  - `HARNESS_FE_DRY_RUN=1` builds without injecting, then prints a
    coverage report (files attempted/injected, skip counts, first 20
    skipped paths) on process exit. Use it to scope adoption in legacy
    Vue projects.

  See `docs/lan-mode.md` and `docs/vue2-compat.md` for the developer
  guides.

### Patch Changes

- Updated dependencies [5d02bbf]
  - @harness-fe/unplugin@2.0.0

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
  - @harness-fe/unplugin@1.0.2

## 1.0.0

### Minor Changes

- 2019214: Version alignment: reset `@harness-fe/log` and `@harness-fe/next` to the 0.9.x line, locking all core packages together via `linked` in `.changeset/config.json`

  Background: `@harness-fe/log`'s initial Changesets minor bump took it to **1.0.0** (Changesets treats brand-new packages as starting at 1.0.0 unless explicitly minor-bumped from a prior 0.x), then the next minor pushed it to 2.0.0 — leaving the rest of the ecosystem at 0.6–0.9 while `log` and `next` (which transitively bumped) sat at 2.0. Functionally fine, but cosmetically off.

  With no public consumer of this package yet, accepting the inconvenience of a version downgrade is cheap. The previous `log@{1.0.0, 2.0.0, 2.0.1}` and `next@{1.0.0, 2.0.0}` releases will be deprecated on npmjs.com pointing to 0.9.x as the canonical line.

  This changeset bumps **every** core package by `minor` so they all land at the same 0.x.0 going forward, plus locks them via `linked` so future bumps stay in lockstep. Also includes the Turbopack-fix browser/node split for `@harness-fe/log` that was previously queued as a patch.

### Patch Changes

- Updated dependencies [2019214]
  - @harness-fe/unplugin@1.0.0

## 0.6.3

### Patch Changes

- @harness-fe/unplugin@0.6.3
