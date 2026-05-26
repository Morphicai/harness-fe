# @harness-fe/sandbox

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
