# `@harness-fe/sandbox`

> Browser sandbox + interceptor middleware. Observe and customize the runtime
> behavior of `fetch` / `XMLHttpRequest` / `WebSocket` / `Storage` / `history` /
> `location` / `IndexedDB` / `console` / global window keys — all from a single
> ergonomic API.

Used internally by [`@harness-fe/runtime`](../runtime-client/README.md). Also
works standalone in any browser code where you want to instrument or alter
these APIs (micro-frontend base, debug overlay, MorphixAI runtime, etc.).

## Install

```bash
pnpm add @harness-fe/sandbox
```

## When does it actually hijack?

**Importing the package does NOT touch the page.** It only fills internal
maps so the lib knows how to install each channel later.

**Patches only engage when `installSandbox(opts)` is called** — and only for
the channels you enable. Calling `handle.dispose()` unwinds them.

## Selective hijacking

Three opt-in modes, ordered by intent:

```ts
// 1. Default — engages ALL 9 channels.
installSandbox({});

// 2. Allowlist — engages ONLY the listed channels; others fully uninstalled.
installSandbox({ only: ['fetch', 'storage'] });

// 3. Denylist — engages all channels EXCEPT the listed ones.
installSandbox({ observe: { storage: false, indexeddb: false } });
```

`only` and `observe` are mutually exclusive; when both are set, `only` wins.

`handle.enabled.X` is a runtime check for which channels are actually patched.
A `false` value means either you opted out (via `only` / `observe`) OR the
engine refused to patch (silent graceful degradation, see "Safety properties").

## 60-second example

```ts
import { installSandbox } from '@harness-fe/sandbox';

const handle = installSandbox({
    // Pure cross-channel observer.
    onEvent: (e) => console.log('[sandbox]', e.source, e.kind, e.data),

    // Per-channel interceptors.
    fetch: {
        onRequest: (req) => ({ ...req, headers: { ...req.headers, 'x-trace': '1' } }),
    },
    storage: {
        onSet: (key, value) => {
            if (key === 'password') return false;          // block
            if (key.startsWith('__secret_')) return false; // block
            return undefined;                              // pass through
        },
    },
    navigation: {
        onAssign: (url) => url.startsWith('//external') ? false : undefined,
    },
});

// later
handle.pause();   // suspend event delivery, keep patches
handle.resume();
handle.dispose(); // unwind patches in LIFO order
```

## Channels & interceptors

| Channel | Observe | Intercept |
|---|---|---|
| `fetch` | ✓ | `onRequest`(async-aware) / `onResponse` — can rewrite, block, short-circuit with a `Response` |
| `xhr` | ✓ | `onRequest` / `onResponse` — same semantics, sync-only (XHR `send` is sync) |
| `ws` | ✓ | `onConstruct` (rewrite url / block) / `onSend` (drop / rewrite) / `onMessage` / `onClose` |
| `storage` | ✓ | `onGet` / `onSet` / `onRemove` / `onClear` — covers `localStorage`, `sessionStorage`, `document.cookie`; cross-tab `storage` events too |
| `navigation` | ✓ | `onPush` / `onReplace` (history) / `onAssign` (`location.href` / `assign` / `replace`) / `onHash` |
| `console` | ✓ | — |
| `errors` | ✓ | — (`error` + `unhandledrejection`) |
| `globals` | ✓ | `onGet` / `onSet` / `onDelete` for keys you list in `watch: ['MY_KEY', ...]` |
| `indexeddb` | ✓ | `onOpen` / `onPut` / `onGet` / `onDelete` / `onClear` |

### Return-value semantics for interceptors

- `undefined` / `void` → pass through unchanged.
- A new value object → use the new value.
- `false` → block the operation entirely. Observer still sees a "blocked" observation.
- A short-circuit value (channel-specific, e.g. a `Response` for fetch) → skip native, use this result.

```ts
fetch: {
    onRequest: (req) => {
        if (req.url.includes('/analytics')) return false;          // block
        if (cache.has(req.url)) return cache.get(req.url)!;        // short-circuit Response
        return { ...req, headers: { ...req.headers, 'x-uid': '1' } }; // rewrite
    },
}
```

## Safety properties (don't break the page)

| Property | What it means |
|---|---|
| **Identity preservation** | `typeof fetch === 'function'`, `localStorage instanceof Storage`, `Object.getPrototypeOf(localStorage) === Storage.prototype`, `for (k in localStorage)` yields only stored keys — all hold post-install |
| **`.call()` bypass closed** | `Storage.prototype.setItem.call(localStorage, k, v)` and `WebSocket.prototype.send.call(ws, data)` route through the interceptor (Proxy + prototype double patch) |
| **`new.target` enforced** | `WebSocket(...)` without `new` throws `TypeError` matching spec |
| **Reentry guard** | Consumer code that recursively touches a patched API inside an interceptor or observer does NOT loop. The recursive call STILL works (writes still land), it just isn't observed |
| **Silent graceful degradation** | Every patch step in `try/catch`. If the engine refuses (locked native, embedded webview), the channel skips, **business code never sees a sandbox error** |
| **Multi-install onion** | Multiple `installSandbox()` calls chain. Each interceptor sees the result of the previous one. `dispose()` LIFO restores |

## API reference

### `installSandbox(opts: SandboxOptions): SandboxHandle`

```ts
interface SandboxOptions {
    onEvent?: (event: SandboxEvent) => void;

    fetch?: FetchInterceptor;
    xhr?: XhrInterceptor;
    ws?: WsInterceptor;
    storage?: StorageInterceptor;
    navigation?: NavigationInterceptor;
    globals?: GlobalsInterceptor;
    indexeddb?: IndexedDbInterceptor;

    /** Allowlist mode: only the listed channels engage. Mutually exclusive with `observe`. */
    only?: SandboxChannel[];

    /** Denylist mode: all channels default to enabled, listed=false to opt out. */
    observe?: Partial<Record<SandboxChannel, boolean>>;

    /** Per-body byte cap for fetch/xhr/ws payloads. Default 256 KB. */
    bodyCap?: number;

    /** Skip URLs entirely (e.g. the daemon's own WS connection). */
    selfUrls?: string[];

    /** Disable initiator stack capture. Default: true. */
    captureInitiator?: boolean;
}
```

### `SandboxHandle`

```ts
interface SandboxHandle {
    dispose(): void;             // LIFO uninstall
    pause(): void;                // suspend events; patches stay
    resume(): void;
    enabled: Readonly<Record<SandboxChannel, boolean>>;
}
```

### `SandboxEvent`

Discriminated union by `source` × `kind`:

```ts
type SandboxEvent =
    | { source: 'fetch';      kind: 'req' | 'res'; data: FetchReqObservation | FetchResObservation }
    | { source: 'xhr';        kind: 'req' | 'res'; data: ... }
    | { source: 'ws';         kind: 'open' | 'send' | 'recv' | 'close'; data: WsObservation }
    | { source: 'storage';    kind: 'set' | 'remove' | 'clear' | 'get'; data: StorageObservation }
    | { source: 'navigation'; kind: 'push' | 'replace' | 'pop' | 'hash' | 'assign'; data: NavigationObservation }
    | { source: 'console';    kind: ConsoleLevel; data: ConsoleObservation }
    | { source: 'errors';     kind: 'error' | 'unhandledrejection'; data: ErrorObservation }
    | { source: 'globals';    kind: 'get' | 'set' | 'delete'; data: GlobalsObservation }
    | { source: 'indexeddb';  kind: 'open' | 'put' | 'add' | 'get' | 'getAll' | 'delete' | 'clear' | 'cursor'; data: IndexedDbObservation };
```

Each event also carries `ts: number`, `initiator?: { stack? }`, and a reserved
`moduleId?: string` field for a future build-plugin companion.

### `SandboxCtx` (passed to every interceptor)

```ts
interface SandboxCtx {
    channel: SandboxChannel;
    kind: string;
    initiator: { stack?: string };
    ts: number;
    moduleId?: string;  // reserved
}
```

## Cookbook

### Trace which module makes which request

```ts
installSandbox({
    fetch: {
        onRequest: (req, ctx) => {
            console.debug('[trace]', req.method, req.url, '\nfrom:', ctx.initiator.stack?.split('\n')[1]);
            return undefined;
        },
    },
});
```

### Block writes to a sensitive storage key

```ts
installSandbox({
    storage: {
        onSet: (key) => key === 'authToken' ? false : undefined,
    },
});
```

### Mock a fetch endpoint without changing app code

```ts
installSandbox({
    fetch: {
        onRequest: (req) => {
            if (req.url.endsWith('/api/feature-flags')) {
                return new Response(JSON.stringify({ newUI: true }), {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                });
            }
            return undefined;
        },
    },
});
```

### Watch specific window globals

```ts
installSandbox({
    globals: {
        watch: ['MY_APP_STATE', '__DEV__'],
        onSet: (key, value) => {
            console.log('[global write]', key, '=', value);
            return undefined;
        },
    },
});
```

### Encrypt IndexedDB values transparently

```ts
installSandbox({
    indexeddb: {
        onPut: (_store, key, value) => ({ key, value: encrypt(value) }),
        onGet: (store, key) => {
            // override get to also decrypt
            const real = readFromRealIDB(store, key); // your sync access path
            return decrypt(real);
        },
    },
});
```

## What about build-time?

Sandbox is **pure runtime**. Some things only build-time can do:
- Tag every module / micro-frontend remote with a stable `moduleId`
- Ensure `installSandbox()` runs strictly before any other module's top-level
  side effects
- Catch `eval` / `new Function` source locations
- Sandbox-inject into Worker / ServiceWorker entries

These are the responsibility of a future companion build plugin
(`@harness-fe/sandbox-plugin-vite|webpack`). The lib reserves
`SandboxCtx.moduleId` for the plugin to populate.

For now, the recommended runtime-only sequence:

```ts
// entry.ts — FIRST line of your app's entry bundle
import { installSandbox } from '@harness-fe/sandbox';
installSandbox({ /* ... */ });
import './app';  // everything else loads under the sandbox
```

## Cross-package architecture

```
┌─────────────────────────────────────────────────────────────┐
│                @harness-fe/sandbox                          │
│                (this package)                               │
│                                                             │
│   browser APIs ──────► [Proxy + prototype patches] ────►    │
│                                ▼                            │
│                       interceptor chain                     │
│                        (onion model)                        │
│                                ▼                            │
│                        onEvent(SandboxEvent)                │
└──────────────────────────────────┼──────────────────────────┘
                                   │
                                   ▼ (any consumer)
   ┌───────────────────────┐    ┌──────────────────┐    ┌────────┐
   │ @harness-fe/runtime   │    │ Tanka MF runtime │    │ custom │
   │ (adapts to protocol + │    │ (audit / logging)│    │ ...    │
   │  ships to daemon)     │    │                  │    │        │
   └───────────────────────┘    └──────────────────┘    └────────┘
```

## License

MIT
