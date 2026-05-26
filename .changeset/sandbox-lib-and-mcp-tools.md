---
'@harness-fe/protocol': minor
'@harness-fe/mcp-server': minor
'@harness-fe/runtime': minor
'@harness-fe/node-runtime': minor
'@harness-fe/next': minor
'@harness-fe/log': minor
'@harness-fe/react-jsx': minor
'@harness-fe/sandbox': minor
'@harness-fe/vite': minor
'@harness-fe/webpack': minor
'@harness-fe/unplugin': minor
---

**New `@harness-fe/sandbox` package + runtime refactor + 3 new MCP tools.** The runtime's browser-API patching is now a standalone lib with observer + interceptor middleware across 9 channels.

## New package: `@harness-fe/sandbox`

A reusable browser sandbox / interceptor framework. Used internally by `@harness-fe/runtime`, but standalone-usable in any project (Tanka MF, custom MorphixAI base, etc.).

### 9 channels

| Channel | Observe | Intercept |
|---|---|---|
| `fetch` | ✓ | onRequest / onResponse (async-aware) |
| `xhr` | ✓ | onRequest / onResponse |
| `ws` | ✓ | onConstruct / onSend / onMessage / onClose |
| `storage` | ✓ | onGet / onSet / onRemove / onClear (local + session + cookie) |
| `navigation` (new) | ✓ | onPush / onReplace / onAssign / onHash |
| `console` | ✓ | — |
| `errors` | ✓ | — |
| `globals` (new) | ✓ | onGet / onSet / onDelete (per-key watch list) |
| `indexeddb` (new) | ✓ | onOpen / onPut / onGet / onDelete / onClear |

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

| Tool | Filters | Use case |
|---|---|---|
| `navigation.tail` | `kind`, `filter` | track SPA route changes / `location.*` setters |
| `globals.tail` | `op`, `key`, `filter` | detect global pollution / watch app state |
| `indexeddb.tail` | `op`, `store`, `db`, `filter` | who reads/writes IDB |

Each follows the existing `*.tail` family:
- `filter` + `match` (contains / regex)
- typed narrows
- per-tab default with `tabId` override
- `session.tail({ type: 'X' })` for cross-navigate history

## Protocol additions (all additive)

- `NavigationEntry` / `GlobalsEntry` / `IndexedDbEntry` zod schemas + types
- 3 new `COMMAND` codes
- `EventType` union gains `'navigation' | 'globals' | 'indexeddb'` literals

## Tests

- `@harness-fe/sandbox`: 84 unit / 2 skip / 86 total
- `@harness-fe/runtime`: 84 / 84 (post-refactor, deleted patch tests migrated to sandbox)
- `@harness-fe/mcp-server`: 265 / 265
- Real-browser Playwright e2e: 26 / 26 in Chromium 1223 (V8/Blink)
