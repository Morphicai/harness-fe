# `@harness-fe/sandbox` — architecture

> The browser-API patching layer powering `@harness-fe/runtime` and any other
> consumer that needs observable / interceptable behavior on `fetch`, `xhr`,
> `WebSocket`, `Storage`, `history` / `location`, `IndexedDB`, `console`,
> error events, or watched window globals.

## Why a separate package

Before 3.2.0 these patches lived inside `@harness-fe/runtime`. Two pressures pushed them out:

1. **Reuse beyond harness-fe.** The same patching is useful in micro-frontend bases, custom debug overlays, MorphixAI runtime, etc. — none of which need the rest of the runtime (rrweb, overlay UI, daemon bridge).
2. **Capability gap.** The previous patches were observer-only and used per-instance `defineProperty`, which both gave noisy double-emission with consumer code and were trivially bypassed by `Storage.prototype.setItem.call(...)`-style code.

Splitting out the lib let us:
- Switch from observer-only to **observer + interceptor** middleware.
- Use **Proxy + prototype double patch** for `.call()`-resistant interception.
- Add **new channels** (navigation / globals / indexeddb) without forking the runtime.
- Test the patching layer in isolation across 86 unit tests + 26 real-browser e2e cases.

## Channel matrix

| Channel | Native API surface | Patch strategy | New in 3.2? |
|---|---|---|---|
| `fetch` | `window.fetch` | Function replacement, `name`/`length`/`toString` preserved | no |
| `xhr` | `XMLHttpRequest.prototype.{open, setRequestHeader, send}` | Prototype patch + per-instance meta map | no |
| `ws` | `window.WebSocket` constructor + `WebSocket.prototype.send` | Constructor wrap (preserves `instanceof` via prototype) + prototype patch on `send` so `.call()` routes through interceptor. `new.target` check throws on bare call | no (existed in runtime) |
| `storage` | `window.localStorage` / `sessionStorage` instance + `Storage.prototype.{setItem, getItem, removeItem, clear}` + `document.cookie` | **Proxy** on each Storage instance (intercepts both method calls AND `proxy[key] = v` via `set` trap) + prototype patch (intercepts `.call()`). Cookie via `Document.prototype` descriptor. Cross-tab via `storage` window event | reworked |
| `navigation` | `History.prototype.{pushState, replaceState}`, `window.location.{href, hash, assign, replace}`, popstate / hashchange events | Prototype patch on history; `defineProperty` on location (degrades silently when unforgeable) | **yes** |
| `console` | `console.{log, info, warn, error, debug}` | Function replacement, calls original via captured `bind` | no |
| `errors` | `error` + `unhandledrejection` window events | Pure listener (no patch) | no |
| `globals` | Per-key `Object.defineProperty(window, key, accessor)` for keys in `watch` list | Lazy per-entry hook — adds keys when an `installSandbox({ globals: { watch } })` adds the entry, removes on dispose | **yes** |
| `indexeddb` | `IDBFactory.prototype.open` + `IDBObjectStore.prototype.{put, add, get, getAll, delete, clear, openCursor}` | Prototype patch + synthetic `IDBRequest` for short-circuit / block results | **yes** |

## Layered model

```
                         consumer code (app / harness-fe runtime / MF base)
                                    │
                          installSandbox(opts) ──┐
                                                 ▼
                               ┌─────────────────────────────────┐
                               │   per-channel chain (chain.ts)   │
                               │  • addEntry / removeEntry        │
                               │  • emit  (observer fanout)       │
                               │  • runGuarded (reentry guard)    │
                               └────────────────────┬─────────────┘
                                                    │
            ┌──────────────────────┬─────────────┬──┴───────────┬──────────────┐
            ▼                      ▼             ▼              ▼              ▼
        fetch ch.            storage ch.    ws ch.         navigation ch.   ...
     (channels/fetch.ts)  (Proxy on Storage   (Patched ctor + (History proto +
                          + proto patch)      proto.send)     location descrs)
            │                      │             │              │
            ▼                      ▼             ▼              ▼
        window.fetch       window.localStorage  window.WebSocket  window.history /
                                                                   window.location
```

## Reentry guard

```ts
let _depth = (globalThis as any).__hfeSandboxReentryDepth__ ?? 0;
```

Stored on `globalThis` deliberately so cross-module-instance installs (HMR
re-import, accidental double-import) share the same counter — preventing
stacked-patches from re-observing each other.

Every patched entry point does:

```ts
if (isInSandbox()) return native(args);   // recursive: bypass interceptors
enterSandbox();
try {
    // interceptor chain + emit + native
} finally { exitSandbox(); }
```

A consumer's `onSet` writing back to storage runs as native at depth=1 — the
write still happens, it just isn't observed. No infinite loop.

## Identity contract

The lib's correctness target is "consumer code can't tell the page is being
observed by inspecting types / prototypes / enumeration". Specifically:

| Check | Passes? |
|---|---|
| `typeof window.fetch === 'function'` | ✓ |
| `typeof window.WebSocket === 'function'` | ✓ |
| `localStorage instanceof Storage` | ✓ (Proxy target preserves prototype) |
| `Object.getPrototypeOf(localStorage) === Storage.prototype` | ✓ |
| `localStorage.constructor === Storage` | ✓ |
| `for (k in localStorage)` yields only stored keys | ✓ (install-time `defineProperty` re-defines `Storage.prototype` members as `enumerable: false`) |
| `JSON.stringify(localStorage)` matches native | ✓ |
| `new WebSocket() instanceof WebSocket` | ✓ |
| `WebSocket('wss://x')` without `new` throws TypeError | ✓ |
| `Storage.prototype.setItem.call(localStorage, k, v)` routes through interceptor | ✓ (closes `.call()` bypass) |
| `WebSocket.prototype.send.call(ws, data)` routes through interceptor (and respects `selfUrls`) | ✓ |

These are pinned by 22 identity tests in unit + 24 real-browser cases in the
react-demo e2e.

## Failure mode

Every patch step is wrapped in `try / catch`. If the engine refuses
(non-configurable descriptor, locked native, embedded webview without
`Storage.prototype` exposure), the channel:

1. Silently skips installation
2. Reports `handle.enabled[channel] === false`
3. **Never throws an error to business code**

The principle is encoded in [`docs/architecture/sandbox-lib-phase-notes.md`](./sandbox-lib-phase-notes.md#%E8%AE%BE%E8%AE%A1%E5%8E%9F%E5%88%99%E8%B4%AF%E7%A9%BF%E6%89%80%E6%9C%89-channel) as the project rule "fail-safe".

## What's deliberately NOT in the runtime lib

| Out of scope | Why |
|---|---|
| Build-time integration (vite / webpack plugin to inject module IDs / sandbox bootstrap) | Future companion package `@harness-fe/sandbox-plugin-*`. Lib reserves `ctx.moduleId` for it |
| Worker / ServiceWorker / cross-origin iframe sandbox propagation | Each context has its own JS realm. The lib installs in the current realm only; build-time plugin will inject into worker entries |
| Anti-fingerprint masking (faking native code strings, etc.) | Targeting our own apps, not stealth |
| Async hooks for navigation `popstate` / `hashchange` interception | Native events; observable only |

## Consumer matrix

| Consumer | Status (as of 3.2.0) | How it uses sandbox |
|---|---|---|
| `@harness-fe/runtime` | ✅ in-tree, see [runtime CHANGELOG](../../packages/runtime-client/CHANGELOG.md) 3.2.0 | Single `installSandbox({ selfUrls: [daemonUrl], onEvent: adaptToProtocol })`. Adapts `SandboxEvent` → `NetworkEntry` / `WsEntry` / etc. and ships via existing bridge |
| Tanka MF runtime | Planned | Per-remote interceptor chain to track which remote wrote to globals / IDB |
| MorphixAI base | Planned | Audit + selective override of fetch / storage for embedded mini-apps |
| Custom debug overlay | Possible | Observer-only mode; show recent network / errors / writes in a dev panel |

## File map

```
packages/sandbox/
├─ src/
│  ├─ index.ts                 # public exports: installSandbox + types
│  ├─ install.ts               # SandboxHandle, chain entry wiring
│  ├─ types.ts                 # SandboxOptions, SandboxEvent, interceptor interfaces
│  ├─ chain.ts                 # per-channel install registry + reentry guard + emit
│  ├─ initiator.ts             # captureInitiator() — best-effort caller stack
│  └─ channels/
│     ├─ fetch.ts              # window.fetch wrap
│     ├─ xhr.ts                # XMLHttpRequest.prototype patch
│     ├─ ws.ts                 # WebSocket constructor + prototype.send
│     ├─ storage.ts            # Proxy + Storage.prototype + cookie
│     ├─ navigation.ts         # History.prototype + window.location
│     ├─ console.ts            # console.{log,...}
│     ├─ errors.ts             # error / unhandledrejection listeners
│     ├─ globals.ts            # per-key window.X defineProperty
│     └─ indexeddb.ts          # IDBFactory + IDBObjectStore.prototype
└─ src/__tests__/              # 86 unit tests (happy-dom)
```

## Tests

| Suite | Where | Count |
|---|---|---|
| Identity contract | `__tests__/identity.test.ts` | 22 cases (2 happy-dom env-skip; verified in real-browser e2e) |
| Per-channel interceptor | `__tests__/interceptor.test.ts` | 32 cases |
| Chain composition + multi-install | `__tests__/chain.test.ts` | 8 cases |
| Reentry guard | `__tests__/reentry.test.ts` | 5 cases |
| Globals | `__tests__/globals.test.ts` | 8 cases |
| IndexedDB | `__tests__/indexeddb.test.ts` (uses `fake-indexeddb`) | 6 cases |
| Real-browser end-to-end | `examples/react-demo/e2e/sandbox.e2e.ts` (Playwright + Chromium 1223) | 26 cases |
| **Total** | | **107** |

## See also

- [`packages/sandbox/README.md`](../../packages/sandbox/README.md) — usage & API
- [`docs/architecture/sandbox-lib-phase-notes.md`](./sandbox-lib-phase-notes.md) — execution log + design decisions during the lib's first release
- [`docs/architecture/sandbox-lib-phase0-redlist.md`](./sandbox-lib-phase0-redlist.md) — the 7-item red list that drove the refactor (now all green)
