# @harness-fe/runtime

## 4.3.1

### Patch Changes

- ece3d4e: fix(runtime): bump rrweb to 2.1.0 — fixes recorder crash on non-Element mutation nodes when `blockSelector` is set (#183)

  `rrweb@2.0.0-alpha.4`'s `isBlocked()` called `node.matches(blockSelector)` on the raw mutation node instead of the already-resolved Element (`el`), so any Text/Comment node added to the DOM (extremely common — any reactive text update) threw `TypeError: node.matches is not a function`, flooding the console and dropping recorded mutations. This only triggered when `blockSelector` was configured — the exact option harness-fe recommends for skipping micro-frontend containers (e.g. wujie's `wujie-app`) it can't safely traverse. Fixed upstream in `rrweb@2.1.0`, which resolves the element correctly and wraps the check in a try/catch. No harness-fe API surface changed — `record()` options, event-type numeric constants (`FullSnapshot=2` etc.), and the FullSnapshot-baseline logic in `@harness-fe/core` are all unaffected.

  This release also re-resolves this package's `@harness-fe/sandbox` dependency to `^4.3.0` (previously frozen at `^4.0.0` since this package's last publish), which includes the #180 binary-WebSocket-frame fix. Apps still on `@harness-fe/runtime@4.1.0` that hit WebRTC/Agora signaling breakage (#184) should upgrade past this version — that issue's root cause was already fixed in `sandbox@4.3.0`, but this package's own published dependency range never moved to pick it up.

- Updated dependencies [3e0fe5a]
  - @harness-fe/sandbox@4.3.1

## 4.1.0

### Minor Changes

- 2a94faa: wujie/Electron issue cluster (#158–#162)

  - Unified `window.__HARNESS_FE__` injection behind a single builder so the Vite and webpack plugins no longer drift; webpack now injects `overlay`/`consent` too.
  - New build-time runtime knobs: `deferStart` (start after load + idle), `rrwebBlockSelector` (skip a subtree rrweb can't serialize, e.g. wujie's `wujie-app`), `idbThrottleMs` (sample IndexedDB telemetry), and `rrwebCheckoutEveryNms` (now reachable at build time).
  - First `hello.ack` no longer re-takes a FullSnapshot (the start() baseline is already delivered) — avoids serializing the DOM twice on first paint.
  - Recording retention default lowered to 30 min (`recordingRetentionMs`, configurable; legacy `recordingRetentionDays` still honored), and pruning is now baseline-aware so a short window stays replayable — the FullSnapshot the surviving chunks depend on is never evicted.
  - Console visibility fixes: a read token issued without an explicit `projects=` now sees all projects (the documented "undefined = all"); the session list no longer drops sessions whose project-owning participant is empty or not first (admin saw an empty list).

## 4.0.0

### Minor Changes

- 706ef1b: Browser Consent (4.0 · P2) — control commands now require in-page user
  approval before they run, once the daemon is exposed.

  - The daemon pushes a consent policy in `hello.ack`: `off` on loopback solo
    dev (zero-friction, unchanged) and `session` once auth is enabled
    (exposed). Override via `createDaemon({ consent: { mode } })`.
  - Control commands (`page.click/type/scroll/navigate/reload/set_html/
set_style/evaluate/wait_for`) are gated; read-only commands (screenshot,
    dom*query, *\_tail, project.\_) are not. `page.evaluate` always prompts.
  - The runtime client gates `handleCommand`: in `session` mode the first
    control command prompts and the rest of the pageload runs once granted;
    `always` prompts every time; `off` never prompts. No prompter registered ⇒
    fail-safe deny (a policy that can't ask must not silently allow).
  - The in-page overlay shows a consent modal (command preview + Allow once /
    Allow for session / Deny) and registers itself as the prompter.

  Client-side gate by design: consent is the browser-side user's real-time
  approval, closest to the user; it reuses the existing command→response round
  trip (a denied command returns `ok:false` / `CONSENT_DENIED`), so the daemon's
  `sendCommand` path is unchanged. Behaviour is unchanged on loopback (consent
  off). New `hello.ack.consent` field is optional.

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

- db9751f: Console: a real sign-in, a clean empty state, and an overlay shortcut that isn't an auth grant.

  - **Sign-in entry** — the console now has a unified sign-in: an **agent read token**
    (pasted, kept in sessionStorage, sent as Bearer → scoped to the token's projects)
    or an **admin** session (sees all). Under Open (solo) no sign-in is needed.
    New `GET /console/api/whoami` reports `{ mode, authenticated, kind, projects }`
    (never 401s) so the SPA gates on it.
  - **No more weird empty `/`** — a Governed viewer with no credential gets the
    sign-in screen instead of a raw 401; authenticated/Open viewers get the data.
  - **Overlay = pure shortcut** — `deriveDashboardUrl` no longer appends the
    runtime token; the "open dashboard" button is plain navigation to
    `/console/sessions/:id`. The viewer authorizes in the console itself (the
    runtime's write token could never read anyway). The console credential is read
    from sessionStorage, never the URL.

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

- d9e11b3: Runtime opt-in for agent control (4.0). The end-user can now actively allow or
  block in-page agent control per app from the overlay. The choice persists in
  localStorage (`__hfe_runtime_control__:{projectId}`) and **overrides** the app's
  `consent` default and the gateway's hello.ack default — closing the gap where a
  user had no way to refuse agent control. Exposed via
  `window.HarnessFE.getRuntimeControl()` / `setRuntimeControl()` and a one-tap
  toggle in the overlay info card. The app-level default remains the existing
  plugin `consent` option (no new redundant parameter).

  Also adds the missing `'deny'` value to the Next.js `HarnessScript` `consent`
  prop type, aligning it with the Vite/Webpack plugin and the runtime.

- fa12ebb: Version observability — surface the running version in both the dashboard and
  the in-page overlay, so you can tell at a glance which build is live.

  - **daemon** exposes `GET /api/meta` → `{ daemonVersion, protocolVersion }`
    (read from its own package.json at module load).
  - **dashboard-ui** header shows a `v<daemonVersion>` badge (protocol version on
    hover).
  - **runtime** overlay info card gains a `version` row showing the injected
    runtime's real version.
  - **Fix:** the runtime's `VERSION` was a hand-maintained constant stuck at
    `3.3.0` while the package was `4.0.0-next.x`. It is now generated from
    package.json at build time (`scripts/gen-version.mjs` → `src/version.ts`), so
    it can never drift again.

  Additive only — no behaviour change for existing callers.

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
  - @harness-fe/sandbox@4.0.0

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
  - @harness-fe/sandbox@4.0.0-next.8

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
  - @harness-fe/sandbox@4.0.0-next.6

## 4.0.0-next.5

### Minor Changes

- 68e4785: Console: a real sign-in, a clean empty state, and an overlay shortcut that isn't an auth grant.

  - **Sign-in entry** — the console now has a unified sign-in: an **agent read token**
    (pasted, kept in sessionStorage, sent as Bearer → scoped to the token's projects)
    or an **admin** session (sees all). Under Open (solo) no sign-in is needed.
    New `GET /console/api/whoami` reports `{ mode, authenticated, kind, projects }`
    (never 401s) so the SPA gates on it.
  - **No more weird empty `/`** — a Governed viewer with no credential gets the
    sign-in screen instead of a raw 401; authenticated/Open viewers get the data.
  - **Overlay = pure shortcut** — `deriveDashboardUrl` no longer appends the
    runtime token; the "open dashboard" button is plain navigation to
    `/console/sessions/:id`. The viewer authorizes in the console itself (the
    runtime's write token could never read anyway). The console credential is read
    from sessionStorage, never the URL.

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

## 4.0.0-next.4

### Minor Changes

- dbaf5ad: Version observability — surface the running version in both the dashboard and
  the in-page overlay, so you can tell at a glance which build is live.

  - **daemon** exposes `GET /api/meta` → `{ daemonVersion, protocolVersion }`
    (read from its own package.json at module load).
  - **dashboard-ui** header shows a `v<daemonVersion>` badge (protocol version on
    hover).
  - **runtime** overlay info card gains a `version` row showing the injected
    runtime's real version.
  - **Fix:** the runtime's `VERSION` was a hand-maintained constant stuck at
    `3.3.0` while the package was `4.0.0-next.x`. It is now generated from
    package.json at build time (`scripts/gen-version.mjs` → `src/version.ts`), so
    it can never drift again.

  Additive only — no behaviour change for existing callers.

### Patch Changes

- Updated dependencies [25a6106]
  - @harness-fe/protocol@4.0.0-next.4

## 4.0.0-next.0

### Minor Changes

- 9a3c5e1: Browser Consent (4.0 · P2) — control commands now require in-page user
  approval before they run, once the daemon is exposed.

  - The daemon pushes a consent policy in `hello.ack`: `off` on loopback solo
    dev (zero-friction, unchanged) and `session` once auth is enabled
    (exposed). Override via `createDaemon({ consent: { mode } })`.
  - Control commands (`page.click/type/scroll/navigate/reload/set_html/
set_style/evaluate/wait_for`) are gated; read-only commands (screenshot,
    dom*query, *\_tail, project.\_) are not. `page.evaluate` always prompts.
  - The runtime client gates `handleCommand`: in `session` mode the first
    control command prompts and the rest of the pageload runs once granted;
    `always` prompts every time; `off` never prompts. No prompter registered ⇒
    fail-safe deny (a policy that can't ask must not silently allow).
  - The in-page overlay shows a consent modal (command preview + Allow once /
    Allow for session / Deny) and registers itself as the prompter.

  Client-side gate by design: consent is the browser-side user's real-time
  approval, closest to the user; it reuses the existing command→response round
  trip (a denied command returns `ok:false` / `CONSENT_DENIED`), so the daemon's
  `sendCommand` path is unchanged. Behaviour is unchanged on loopback (consent
  off). New `hello.ack.consent` field is optional.

### Patch Changes

- Updated dependencies [9a3c5e1]
- Updated dependencies [a3bd7ea]
  - @harness-fe/protocol@4.0.0-next.0

## 3.4.1

### Patch Changes

- 4adb200: feat: hide report entry; add element info picker for agents

  - overlay: replace "Report a problem" button with "Copy element info" picker.
    Clicking enters picker mode; selecting any element copies a compact markdown
    block (component, source location, CSS path, session context) to the clipboard
    for pasting directly into an agent prompt.
  - mcp-server: temporarily disable `tasks.pending`, `tasks.claim`,
    `tasks.resolve`, and `tasks.get_attachment` MCP tools.

## 3.4.0

### Minor Changes

- ba8629b: **Overlay plugin API.** The in-page "H" overlay is now extensible. Register custom action buttons with `registerOverlayPlugin({ id, label, icon?, requiresElement?, onClick(ctx) })` — no fork, no published package needed. Use it to send the current scene + logs to a teammate or POST it into your own system (issue tracker / Slack / webhook).

  **Registration** works in any order (the registry buffers; the overlay re-renders when the set changes):

  - Typed import: `import { registerOverlayPlugin } from '@harness-fe/runtime'` (idempotent, full types).
  - Global: `window.HarnessFE.registerOverlayPlugin(...)`, or push to the pre-boot queue `window.__HARNESS_FE_PLUGINS__` for scripts that run before the runtime loads.

  **Context** handed to `onClick` is lazy + redaction-aware: `snapshotMarkdown()`, `snapshot()` (page/viewport/storage/performance), `getLogs()` (console/network/errors — network bodies + `authorization`/`cookie` headers stripped unless `redact:false`), `captureScreenshot()`, `selectedElement` (for `requiresElement` plugins), `query()` (daemon RPC), `copyToClipboard()`, `toast()`. New exports: `registerOverlayPlugin`, `getOverlayPlugins`, `subscribeOverlayPlugins`, and the `OverlayPlugin` / `OverlayPluginContext` types.

  MVP is action buttons only; first-class registered panels remain a future extension. A documented **Jira issue** example + proxy contract ships in `docs/overlay-plugins.md`.

  Also: the overlay info card now shows a small GitHub link to the project.

## 3.3.0

### Minor Changes

- 004e1fe: **Periodic rrweb baselines (default 30 min).** The runtime now passes `checkoutEveryNms: 30 * 60 * 1000` to rrweb's `record()`, so long-running sessions emit a fresh FullSnapshot baseline every 30 minutes on top of the existing start-of-session baseline and the per-reconnect baseline forced at each ws hello-ack.

  **Why:** previously, a session that never reconnected anchored every window-replay against the single baseline emitted at `record()` start. Mid-session "tail the last 5 minutes" replays had to roll forward potentially hours of incremental events to reach the window. Periodic baselines cap that distance to ≤ 30 min, making window replays cheaper and the worst-case "no baseline survived in outbox" scenario much less likely.

  **Cost:** ~16 extra FullSnapshots per 8-hour session. At a typical 100–500KB per snapshot this adds ~2–8 MB to each session's storage and a comparable bump to bridge bandwidth.

  **Override:** new `RuntimeClient` option:

  ```ts
  new RuntimeClient({
    projectId: "app",
    rrwebCheckoutEveryNms: 0, // disable periodic baselines
    // rrwebCheckoutEveryNms: 60_000, // 1 min — heavier, but tail replays snap fast
  });
  ```

  Set to `0` (or any non-positive value) to opt back into the prior single-baseline-per-connect behavior. Otherwise no migration required — the new default kicks in automatically.

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

- 422f9c6: **Fix:** `@harness-fe/sandbox` fetch channel now coerces non-string `init.method` and non-string header values through `String()` before downstream use. Sibling of the same-class storage `setItem` bug — native fetch ByteString-coerces these per spec, so business code occasionally relies on it (e.g. `fetch(url, { method: someEnum.toUpperCase() })` where `someEnum` is actually a number constant). Without this fix, `extractMeta` threw inside the patched fetch, turning a working native call into a rejected Promise.

  Internal-only: no API surface change. 2 regression tests pin the behaviour.

- Updated dependencies [422f9c6]
- Updated dependencies [2671c1c]
  - @harness-fe/sandbox@3.2.0
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

## 3.0.1

### Patch Changes

- 3cb3cc8: Add an "Open dashboard" button to the in-page overlay info card. The
  button derives the daemon's dashboard URL from the runtime's `mcpUrl`
  (swap `ws://`/`wss://` → `http://`/`https://`, point at `/dashboard/`,
  carry the token query), deep-links to the current session, and pops it
  in a new tab on click. Hidden when no `mcpUrl` is configured.

  If the host page blocks popups (sandboxed iframe, strict CSP), the
  button falls back to copying the URL so the user can paste it.

## 3.0.0

### Minor Changes

- 10d669c: Overlay UX + screenshot fixes:

  ### Draggable FAB with position persistence

  The floating "H" button can now be dragged anywhere on screen. The
  position is saved to `localStorage` (`__harness_fe_fab_pos__`) and
  clamped into the viewport on every load — resilient to monitor
  swaps, dev-tools panel changes, and viewport resizes. Follower cards
  (info / reports / question) anchor relative to the FAB and flip side
  based on available space, so they're always reachable no matter where
  you drop the button.

  A 5px movement threshold separates click from drag; clicking the FAB
  still opens the info card, dragging it never does.

  ### Dark, glass-style cards

  The info / reports / question panels switched to a dark theme with
  backdrop blur, matching the new dashboard SPA's Linear-style palette.
  Info pills, primary/secondary buttons, and status dots refreshed for
  contrast and clarity on both light and dark host pages.

  ### Screenshot fixes

  - **Overlay no longer bleeds into screenshots.** The "H" FAB and any
    open info card used to land in the corner of every shot. The
    `PAGE_SCREENSHOT` handler now flips `visibility: hidden` on the
    overlay host for the duration of the capture, restoring it
    (try/finally — survives capture errors) immediately after.
  - **Default to opaque background.** Captures were rendering blank for
    pages with no explicit body background. Default is now `#ffffff`;
    callers can pass `backgroundColor: '#0a0a0f'` (or any CSS color)
    for a dark backdrop, or `backgroundColor: null` to opt back into a
    transparent capture (PNG/WebP only — JPEG has no alpha).

  ### Tests

  9 new tests:

  - 4 in `overlay.test.ts` — default position, persisted restore, viewport clamp on shrink, malformed-storage fallback
  - 5 in `commands.test.ts` (new file) — default opaque background, transparent opt-in via null, custom color, overlay-hidden during capture, overlay restored on error

### Patch Changes

- 953339f: Fix: rrweb FullSnapshot baseline was silently dropped in the "record-first,
  upload-later" scenario, leaving sessions permanently unreplayable with
  `window contains no rrweb FullSnapshot (type:2) baseline, and no earlier
baseline could be found — replay would be blank`.

  ### Root cause

  Two compounding bugs:

  1. **Outbox FIFO eviction dropped the FullSnapshot first.** The outbox
     capped at 500 frames / 8 MB and evicted via `shift()` (oldest-first).
     rrweb emits the FullSnapshot at `record.start()` — making it the
     _oldest_ frame in the outbox. If the daemon was unreachable for any
     meaningful stretch (laptop sleep, daemon restart, slow first connect
     in dev), incremental snapshots filled the buffer and evicted the
     baseline before drain.
  2. **rrweb only emits FullSnapshot once.** After eviction, no later code
     path re-emitted it. WebSocket reconnects (incl. daemon restart) reused
     the existing `record()` lifecycle, which produces only incremental
     (type:3) events after the initial emit.

  ### Fix (two layers)

  - **Layer 1 — Re-baseline on every connection.** `client.onHelloAck` now
    calls `recorder.takeFullSnapshot()`, which wraps rrweb's
    `record.takeFullSnapshot(true)`. Every successful ack — first connect,
    reconnect after daemon restart, network blip recovery — gets a fresh
    type:2 baseline.
  - **Layer 2 — Outbox sticky protection.** Frames flagged `sticky` (today:
    any rrweb chunk containing a type:2 event) survive eviction even when
    the cap is busted. Non-sticky frames are evicted FIFO; if outbox is
    _all-sticky and still over cap_, the oldest sticky is dropped as a last
    resort (replay only needs the most recent baseline).

  Outbox logic is now extracted to `src/outbox.ts` with 9 unit tests pinning
  the eviction guarantees, including a regression test that reproduces the
  original bug shape and proves the sticky frame survives.

- Updated dependencies [65f2b96]
- Updated dependencies [88e41a2]
- Updated dependencies [10d669c]
  - @harness-fe/protocol@3.0.0

## 2.0.0

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

## 0.6.4

### Patch Changes

- 88af49d: UX: screenshots are now optional, with inline preview

  The "Report a problem" flow no longer auto-launches the annotate modal on every element pick. After locking an element the user goes straight to the question textarea; a "📷 Add screenshot" button is available if they want to attach an annotated PNG. When attached, the question panel shows a thumbnail preview with Edit + Remove controls. Esc inside annotate preserves any prior attachment and returns to the question step.

## 0.6.3

### Patch Changes

- Updated dependencies [c4a1f59]
  - @harness-fe/protocol@0.7.0
