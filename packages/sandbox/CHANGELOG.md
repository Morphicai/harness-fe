# @harness-fe/sandbox

## 4.3.0

### Patch Changes

- e4edbf5: fix(sandbox): never replace outgoing binary WebSocket frames with their timeline marker (#180)

  The WS `send` patch fed the lossy serialized frame (e.g. `"[binary ArrayBuffer 123B]"`, used only for the timeline) back onto the wire for binary payloads, because it inferred "an interceptor rewrote this" from `current !== data` — always true for binary. This corrupted every binary WebSocket protocol (Agora RTM/RTC, LiveKit, Twilio, protobuf-over-ws), e.g. RTM login failing with `-10023`, hang-ups not dismissing, and lost in-call signaling. Now an explicit `rewritten` flag gates the override: the original `data` is always transmitted untouched unless an `onSend` interceptor explicitly returns a replacement string. Observation/timeline behaviour is unchanged.

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

### Patch Changes

- 704fb71: Align the linked package group onto a single 4.0.0-next line.

  The gateway/console work only touched some packages, so changesets left the linked
  group split — `log`/`react-jsx` were still 3.x, `next`/`node-runtime` on older 4.0
  prereleases, while gateway/runtime/etc were at next.5. This is a version-only bump
  (no code change) so consumers (morphix, tanka) can install ONE consistent
  4.0.0-next.x set without mixing `@harness-fe/protocol` majors.

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

## 4.0.0-next.6

### Patch Changes

- 46775be: Align the linked package group onto a single 4.0.0-next line.

  The gateway/console work only touched some packages, so changesets left the linked
  group split — `log`/`react-jsx` were still 3.x, `next`/`node-runtime` on older 4.0
  prereleases, while gateway/runtime/etc were at next.5. This is a version-only bump
  (no code change) so consumers (morphix, tanka) can install ONE consistent
  4.0.0-next.x set without mixing `@harness-fe/protocol` majors.

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
