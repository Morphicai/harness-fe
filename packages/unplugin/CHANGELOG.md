# @harness-fe/unplugin

## 4.0.0

### Minor Changes

- 7274a6c: New browser interaction commands, consent UI, overlay option, and full file upload pipeline.

  **New MCP tools (all control-scoped)**

  - `page.upload` — inject files into `<input type="file">` via DataTransfer; files provided as base64 by the agent
  - `page.select` — set `<select>` value and fire change/input events
  - `page.check` — set checkbox/radio `.checked` and fire change/input events
  - `page.paste` — dispatch ClipboardEvent with synthetic clipboard data (fire-and-forget, no dialog)
  - `page.set_dialog_handler` — pre-register return values for agent-triggered `alert`/`confirm`/`prompt` (read-scope)

  **Consent UI (runtime-only, modern design)**

  - New plugin option `consent?: 'off' | 'session' | 'always'` on `harnessFE()` / `<HarnessScript>`
  - Plugin config takes priority over gateway `hello.ack`; gateway/CLI unchanged
  - Permanent grant stored in `localStorage.__hfe_consent_grant__:<projectId>`; survives page refresh
  - Rebuilt consent panel: blur backdrop + card UI, four buttons (始终允许 / 本次会话 / 仅此次 / 拒绝)
  - Fixed: consent panel now shows `page.click(#submit-btn)` instead of `page.click([object Object])`

  **Overlay hide option**

  - New plugin option `overlay?: boolean` (default `true`) on `harnessFE()` / `<HarnessScript>`
  - `overlay: false` hides the "H" floating icon; data capture is unaffected

  **Sandbox: dialogs channel**

  - New `dialogs` sandbox channel intercepts `alert` / `confirm` / `prompt` / `print` / `beforeunload`
  - Only intercepts when agent is in progress (`__hfe_agent_in_progress__` flag); user calls pass through unchanged

  **Sandbox: forms channel**

  - New `forms` sandbox channel covers the full file upload pipeline to backend:
    - `HTMLInputElement.prototype.click` (file inputs): suppresses native picker when agent-triggered
    - `window.FormData` constructor: injects `__hfe_injected_files__` so `new FormData(form)` + fetch sends real files
    - `HTMLFormElement.prototype.submit`: converts to fetch when agent has injected files; fallback to native on error
  - `page.upload` sets `__hfe_injected_files__` on the input element (auto-cleared after 60s)

- b3ffe9d: Rebuild ⑤ — the runtime connects to the gateway `/ws` by default.

  - The default WebSocket target is now `ws://127.0.0.1:<port>/ws` (the gateway
    front door) instead of the daemon's root socket. Both the build plugin and the
    in-browser runtime client pick it up. The wire protocol is unchanged, so this
    is purely a target/path change.
  - `deriveDashboardUrl` now points at the gateway console (`/console`,
    `/console/session/:id`) instead of the old `/dashboard/`.
  - Token semantics: the injected token is now expected to be a **write-scope**
    gateway token. Core denies every read/control capability to a write-only
    principal, so extracting the token from `window.__HARNESS_FE__` only lets a
    page report events and be driven — never read or drive anyone else's data.
    Solo (loopback) stays token-free.

- ded521b: Shared auto-spawn gateway + unified console sign-in.

  - **cli**: `harness serve` (headless shared gateway) and `harness mcp` (stdio↔http proxy) subcommands; default-locate `@harness-fe/console-ui` dist so `/console` serves the real UI with no `--console-dir`.
  - **ensureSharedGateway**: a dev server (vite/unplugin and native webpack) or the mcp launcher — whoever starts first — auto-spawns one shared Open gateway; the other end reuses it. Team (explicit token) never spawns.
  - **gateway**: `startMcpStdioProxy`; removed the server-rendered `/admin` + `/admin/login` HTML pages — sign-in unified at `/console`.
  - **console-ui**: sign-in takes effect without a hard reload; governance tab admin-only.
  - **demo**: `demo.sh` reclaims a stale harness gateway instead of refusing to start.

### Patch Changes

- 704fb71: Align the linked package group onto a single 4.0.0-next line.

  The gateway/console work only touched some packages, so changesets left the linked
  group split — `log`/`react-jsx` were still 3.x, `next`/`node-runtime` on older 4.0
  prereleases, while gateway/runtime/etc were at next.5. This is a version-only bump
  (no code change) so consumers (morphix, tanka) can install ONE consistent
  4.0.0-next.x set without mixing `@harness-fe/protocol` majors.

- 2453e70: **consent `deny` mode + 1 GiB storage cap**

  - Add `consent: 'deny'` mode — all control commands (`page.click`, `page.type`, etc.) are rejected immediately without any user prompt. Safe default for production deployments.
  - **Change default consent from `off` to `deny`**. Previously unguarded control commands ran freely unless `--governed` was passed; now control is disabled by default and must be explicitly enabled.
  - Add `maxTotalBytes` to `RetentionPolicy` (default 1 GiB). After all other pruning passes, oldest sessions are evicted until the data directory falls below the cap.
  - Add `HARNESS_MAX_STORAGE_BYTES` environment variable and `--max-storage-bytes` support. Override the cap with `-e HARNESS_MAX_STORAGE_BYTES=<bytes>` in Docker. Set to `0` to disable.
  - Docker image now sets `ENV HARNESS_MAX_STORAGE_BYTES=1073741824` (1 GiB) by default.

- Updated dependencies [704fb71]
- Updated dependencies [706ef1b]
- Updated dependencies [7274a6c]
- Updated dependencies [7042d17]
- Updated dependencies [2453e70]
- Updated dependencies [344f806]
  - @harness-fe/protocol@4.0.0

## 4.0.0-next.12

### Patch Changes

- 2453e70: **consent `deny` mode + 1 GiB storage cap**

  - Add `consent: 'deny'` mode — all control commands (`page.click`, `page.type`, etc.) are rejected immediately without any user prompt. Safe default for production deployments.
  - **Change default consent from `off` to `deny`**. Previously unguarded control commands ran freely unless `--governed` was passed; now control is disabled by default and must be explicitly enabled.
  - Add `maxTotalBytes` to `RetentionPolicy` (default 1 GiB). After all other pruning passes, oldest sessions are evicted until the data directory falls below the cap.
  - Add `HARNESS_MAX_STORAGE_BYTES` environment variable and `--max-storage-bytes` support. Override the cap with `-e HARNESS_MAX_STORAGE_BYTES=<bytes>` in Docker. Set to `0` to disable.
  - Docker image now sets `ENV HARNESS_MAX_STORAGE_BYTES=1073741824` (1 GiB) by default.

- Updated dependencies [2453e70]
  - @harness-fe/protocol@4.0.0-next.12

## 4.0.0-next.11

## 4.0.0-next.8

### Minor Changes

- 7274a6c: New browser interaction commands, consent UI, overlay option, and full file upload pipeline.

  **New MCP tools (all control-scoped)**

  - `page.upload` — inject files into `<input type="file">` via DataTransfer; files provided as base64 by the agent
  - `page.select` — set `<select>` value and fire change/input events
  - `page.check` — set checkbox/radio `.checked` and fire change/input events
  - `page.paste` — dispatch ClipboardEvent with synthetic clipboard data (fire-and-forget, no dialog)
  - `page.set_dialog_handler` — pre-register return values for agent-triggered `alert`/`confirm`/`prompt` (read-scope)

  **Consent UI (runtime-only, modern design)**

  - New plugin option `consent?: 'off' | 'session' | 'always'` on `harnessFE()` / `<HarnessScript>`
  - Plugin config takes priority over gateway `hello.ack`; gateway/CLI unchanged
  - Permanent grant stored in `localStorage.__hfe_consent_grant__:<projectId>`; survives page refresh
  - Rebuilt consent panel: blur backdrop + card UI, four buttons (始终允许 / 本次会话 / 仅此次 / 拒绝)
  - Fixed: consent panel now shows `page.click(#submit-btn)` instead of `page.click([object Object])`

  **Overlay hide option**

  - New plugin option `overlay?: boolean` (default `true`) on `harnessFE()` / `<HarnessScript>`
  - `overlay: false` hides the "H" floating icon; data capture is unaffected

  **Sandbox: dialogs channel**

  - New `dialogs` sandbox channel intercepts `alert` / `confirm` / `prompt` / `print` / `beforeunload`
  - Only intercepts when agent is in progress (`__hfe_agent_in_progress__` flag); user calls pass through unchanged

  **Sandbox: forms channel**

  - New `forms` sandbox channel covers the full file upload pipeline to backend:
    - `HTMLInputElement.prototype.click` (file inputs): suppresses native picker when agent-triggered
    - `window.FormData` constructor: injects `__hfe_injected_files__` so `new FormData(form)` + fetch sends real files
    - `HTMLFormElement.prototype.submit`: converts to fetch when agent has injected files; fallback to native on error
  - `page.upload` sets `__hfe_injected_files__` on the input element (auto-cleared after 60s)

### Patch Changes

- Updated dependencies [7274a6c]
  - @harness-fe/protocol@4.0.0-next.8

## 4.0.0-next.6

### Patch Changes

- 46775be: Align the linked package group onto a single 4.0.0-next line.

  The gateway/console work only touched some packages, so changesets left the linked
  group split — `log`/`react-jsx` were still 3.x, `next`/`node-runtime` on older 4.0
  prereleases, while gateway/runtime/etc were at next.5. This is a version-only bump
  (no code change) so consumers (morphix, tanka) can install ONE consistent
  4.0.0-next.x set without mixing `@harness-fe/protocol` majors.

- Updated dependencies [46775be]
  - @harness-fe/protocol@4.0.0-next.6

## 4.0.0-next.5

### Minor Changes

- 2fa80f1: Rebuild ⑤ — the runtime connects to the gateway `/ws` by default.

  - The default WebSocket target is now `ws://127.0.0.1:<port>/ws` (the gateway
    front door) instead of the daemon's root socket. Both the build plugin and the
    in-browser runtime client pick it up. The wire protocol is unchanged, so this
    is purely a target/path change.
  - `deriveDashboardUrl` now points at the gateway console (`/console`,
    `/console/session/:id`) instead of the old `/dashboard/`.
  - Token semantics: the injected token is now expected to be a **write-scope**
    gateway token. Core denies every read/control capability to a write-only
    principal, so extracting the token from `window.__HARNESS_FE__` only lets a
    page report events and be driven — never read or drive anyone else's data.
    Solo (loopback) stays token-free.

- c7736ab: Shared auto-spawn gateway + unified console sign-in.

  - **cli**: `harness serve` (headless shared gateway) and `harness mcp` (stdio↔http proxy) subcommands; default-locate `@harness-fe/console-ui` dist so `/console` serves the real UI with no `--console-dir`.
  - **ensureSharedGateway**: a dev server (vite/unplugin and native webpack) or the mcp launcher — whoever starts first — auto-spawns one shared Open gateway; the other end reuses it. Team (explicit token) never spawns.
  - **gateway**: `startMcpStdioProxy`; removed the server-rendered `/admin` + `/admin/login` HTML pages — sign-in unified at `/console`.
  - **console-ui**: sign-in takes effect without a hard reload; governance tab admin-only.
  - **demo**: `demo.sh` reclaims a stale harness gateway instead of refusing to start.

## 4.0.0-next.4

### Patch Changes

- Updated dependencies [25a6106]
  - @harness-fe/protocol@4.0.0-next.4

## 4.0.0-next.0

### Patch Changes

- Updated dependencies [9a3c5e1]
- Updated dependencies [a3bd7ea]
  - @harness-fe/protocol@4.0.0-next.0

## 3.2.0

### Minor Changes

- 2671c1c: **New `@harness-fe/sandbox` package + runtime refactor + 3 new MCP tools.** The runtime's browser-API patching is now a standalone lib with observer + interceptor middleware across 9 channels.

  ## New package: `@harness-fe/sandbox`

  A reusable browser sandbox / interceptor framework. Used internally by `@harness-fe/runtime`, but standalone-usable in any project (Tanka MF, custom MorphixAI base, etc.).

  ### 9 channels

  | Channel            | Observe | Intercept                                                     |
  | ------------------ | ------- | ------------------------------------------------------------- |
  | `fetch`            | ✓       | onRequest / onResponse (async-aware)                          |
  | `xhr`              | ✓       | onRequest / onResponse                                        |
  | `ws`               | ✓       | onConstruct / onSend / onMessage / onClose                    |
  | `storage`          | ✓       | onGet / onSet / onRemove / onClear (local + session + cookie) |
  | `navigation` (new) | ✓       | onPush / onReplace / onAssign / onHash                        |
  | `console`          | ✓       | —                                                             |
  | `errors`           | ✓       | —                                                             |
  | `globals` (new)    | ✓       | onGet / onSet / onDelete (per-key watch list)                 |
  | `indexeddb` (new)  | ✓       | onOpen / onPut / onGet / onDelete / onClear                   |

  ### Safety properties

  - **Identity preserved.** typeof / instanceof / constructor / prototype chain / for...in / JSON.stringify all behave bit-identically to native.
  - **`.call()` bypass closed.** Proxy + prototype double patch on Storage / WebSocket / XHR — `Storage.prototype.setItem.call(...)` etc. route through the interceptor.
  - **`new.target` check.** `WebSocket(...)` without `new` throws TypeError (matches spec).
  - **Global reentry guard.** Consumer code recursively touching a patched API (e.g. `onSet: (k,v) => localStorage.setItem('echo:'+k, v)`) does NOT loop — inner calls bypass interceptors. Guard counter lives on `globalThis` so cross-module-instance installs (HMR dup) share it.
  - **Silent graceful degradation.** Every patch step in try/catch — if the engine refuses, the channel skips, business code never sees a sandbox error.

  ## `@harness-fe/runtime` consumes the sandbox

  - Deleted in-tree `fetchPatch.ts` / `xhrPatch.ts` / `wsPatch.ts` / `storagePatch.ts` / `initiator.ts` (1142 LOC of patch code).
  - `capture.ts` is now a thin adapter (~175 LOC) that maps `SandboxEvent` → `NetworkEntry / WsEntry / StorageEntry / ConsoleEntry / ErrorEntry / NavigationEntry / GlobalsEntry / IndexedDbEntry` and pushes through the existing bridge.
  - **Public API unchanged**: `RuntimeClient` + auto-start work exactly as before; this is a pure internal refactor.

  ## 3 new MCP tools

  | Tool              | Filters                       | Use case                                       |
  | ----------------- | ----------------------------- | ---------------------------------------------- |
  | `navigation.tail` | `kind`, `filter`              | track SPA route changes / `location.*` setters |
  | `globals.tail`    | `op`, `key`, `filter`         | detect global pollution / watch app state      |
  | `indexeddb.tail`  | `op`, `store`, `db`, `filter` | who reads/writes IDB                           |

  Each follows the existing `*.tail` family:

  - `filter` + `match` (contains / regex)
  - typed narrows
  - per-tab default with `tabId` override
  - `session.tail({ type: 'X' })` for cross-navigate history

  ## Protocol additions (all additive)

  - `NavigationEntry` / `GlobalsEntry` / `IndexedDbEntry` zod schemas + types
  - 3 new `COMMAND` codes
  - `EventType` union gains `'navigation' | 'globals' | 'indexeddb'` literals

  ## Bug fixes carried by the refactor

  - **`storage.setItem` no longer crashes when given non-string values.** The 3.1.x in-tree `storagePatch` forwarded raw values into a `clip(value).slice(...)` call and threw `TypeError: s.slice is not a function` for `setItem(key, Date.now())` / `setItem(key, true)` / `setItem(key, {...})` etc. Native Storage implicitly `ToString`s the value (Web Storage spec), and a lot of business code relies on that. The sandbox rewrite stringifies the value at every setItem entry (proxy method, proxy `set` trap, `Storage.prototype.setItem.call(...)` bypass path) before any clipping. 5 regression tests pin the behaviour.

  ## Tests

  - `@harness-fe/sandbox`: 84 unit / 2 skip / 86 total
  - `@harness-fe/runtime`: 84 / 84 (post-refactor, deleted patch tests migrated to sandbox)
  - `@harness-fe/mcp-server`: 265 / 265
  - Real-browser Playwright e2e: 26 / 26 in Chromium 1223 (V8/Blink)

### Patch Changes

- Updated dependencies [2671c1c]
  - @harness-fe/protocol@3.2.0

## 3.1.0

### Minor Changes

- b63c378: **Multi-tab observability** — fill the gaps that made Electron / multi-tab / WebSocket-driven bugs hard to diagnose. All schema changes are additive; existing jsonl data continues to work.

  ### New runtime captures

  - **WebSocket frame capture** (`wsPatch.ts`) — every `new WebSocket(...)` is wrapped to emit `open / send / recv / close` frames with payload (text/JSON auto-parsed, binary as size marker), connection id, and `initiator.stack` on open/send. The daemon URL itself is denylisted so the bridge ws does not self-loop.
  - **Storage trap** (`storagePatch.ts`) — `localStorage` / `sessionStorage` `setItem / removeItem / clear` and `document.cookie` mutations are intercepted with `initiator.stack`. Cross-tab events (native `storage` event) are tagged `crossTab: true`.
  - **REST initiator stack** — `fetchPatch` and `xhrPatch` now stamp each `req` entry with `initiator.stack` so "who issued this request" is answerable without a debugger.

  ### New MCP tools

  - `ws.tail` / `storage.tail` — same tail family as `network.tail` / `console.tail`.
  - `network.get({ reqId })` / `ws.get({ wsId })` — pull a single entry's full body when `*.tail` truncates.
  - `network.wait_for({ urlContains|urlRegex, method?, statusCode?, timeoutMs })` — Playwright-style request wait, baseline-anchored so pre-existing matches don't satisfy.
  - `network.wait_for_idle({ idleMs, timeoutMs })` — resolves after a quiet window.
  - `visitor.timeline({ visitorId, types?, tabIds?, sessionIds?, since?, until?, limit? })` — merge all sessions belonging to one visitor into one ascending event stream. Each event carries `tab` + `sessionId` so cross-tab causality (a ws frame in tab A causing a storage write in tab B) is visible in one call.

  ### Filter discoverability fix

  All `*.tail` tools now accept `filter` + `match: 'contains' | 'regex'`, plus narrow params (`level`, `urlContains`, `method`, `statusCode`, `phase`, `which`, `op`, `key`). Previously these were silently stripped by zod when not in the schema.

  ### Cross-reference docs

  `session.tail` description points users to `visitor.timeline` for cross-tab cases. The `*.tail` descriptions now mention that buffers clear on navigate, and `session.tail` is the persistent equivalent.

  ### Schema (additive only)

  - `EventType` union: `+ 'ws'`
  - `NetworkEntry`: `+ initiator?: { stack? }`
  - New `wsEntrySchema` / `storageEntrySchema`
  - `storagePayloadSchema`: `+ initiator?: { stack? }`
  - 6 new `COMMAND` codes; old codes unchanged.

  ### Tests

  +65 tests added across unit and E2E:

  - 9 wsPatch unit + 9 storagePatch unit + 12 filter unit + 8 visitor.timeline unit
  - 6 bridge-ingestion E2E (runtime → bridge → jsonl with real ws)
  - 6 MCP-protocol E2E (real `McpServer` + `Client` via `InMemoryTransport`)
  - 9 runtime command E2E (real async polling for `wait_for*` / `network.get` / `ws.get`)
  - 5 full-stack E2E (`RuntimeClient` + happy-dom + real Bridge + real `JsonlStore`)

  Zero regressions.

### Patch Changes

- Updated dependencies [b63c378]
  - @harness-fe/protocol@3.1.0

## 3.0.0

### Patch Changes

- Updated dependencies [65f2b96]
- Updated dependencies [88e41a2]
- Updated dependencies [10d669c]
  - @harness-fe/protocol@3.0.0

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
  - @harness-fe/protocol@2.0.0

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
  - @harness-fe/protocol@1.0.2

## 1.0.0

### Minor Changes

- 2019214: Version alignment: reset `@harness-fe/log` and `@harness-fe/next` to the 0.9.x line, locking all core packages together via `linked` in `.changeset/config.json`

  Background: `@harness-fe/log`'s initial Changesets minor bump took it to **1.0.0** (Changesets treats brand-new packages as starting at 1.0.0 unless explicitly minor-bumped from a prior 0.x), then the next minor pushed it to 2.0.0 — leaving the rest of the ecosystem at 0.6–0.9 while `log` and `next` (which transitively bumped) sat at 2.0. Functionally fine, but cosmetically off.

  With no public consumer of this package yet, accepting the inconvenience of a version downgrade is cheap. The previous `log@{1.0.0, 2.0.0, 2.0.1}` and `next@{1.0.0, 2.0.0}` releases will be deprecated on npmjs.com pointing to 0.9.x as the canonical line.

  This changeset bumps **every** core package by `minor` so they all land at the same 0.x.0 going forward, plus locks them via `linked` so future bumps stay in lockstep. Also includes the Turbopack-fix browser/node split for `@harness-fe/log` that was previously queued as a patch.

### Patch Changes

- Updated dependencies [2019214]
  - @harness-fe/protocol@1.0.0

## 0.6.3

### Patch Changes

- Updated dependencies [c4a1f59]
  - @harness-fe/protocol@0.7.0
