# Electron / multi-window host integration

harness-fe was designed for the browser, but a renderer process in
Electron / Tauri / Capacitor / a CEF-embedded WebView is still a
browser context — the build plugin + runtime client work as-is.

This page documents the **one piece** that needs host-side cooperation:
multi-window sessionId sharing.

## The seed contract

`@harness-fe/runtime` reads two globals synchronously at boot:

```ts
window.__HARNESS_FE__         // ← injected by the build plugin
                               //   (mcpUrl, projectId, buildId, token, …)

window.__HARNESS_FE_SEED__    // ← OPTIONAL, host-provided
  ?.sessionId                  //   override the auto-generated sessionId
```

If `__HARNESS_FE_SEED__.sessionId` is present, it wins over the
runtime's own `crypto.randomUUID()`. This is how `@harness-fe/next`'s
`<HarnessScript>` aligns SSR and CSR — but the seed is a fully generic
extension point. Anything you can put into that field works.

## Why you'd want to set it: multi-window hosts

Electron spins up an independent renderer process per `BrowserWindow`.
Each renderer has its own `sessionStorage` and its own runtime instance
— so by default every window generates its own sessionId. The daemon
records them as N independent sessions, and `session.tail` /
`session.recordings.*` can only see one window at a time.

For most multi-window apps you want the opposite: **one session
spanning every window the user has open, with one tabId per window**.

```
session: <one-shared-uuid>
├── tab: <main-window-tabId>
├── tab: <settings-window-tabId>
└── tab: <devtools-popup-tabId>
```

Now `session.tail` returns the full cross-window timeline; the agent
sees the user's complete behaviour.

## How: any cross-window sync primitive works

Pick whichever your host already has — harness-fe doesn't care:

| Mechanism | Notes |
|---|---|
| `BroadcastChannel` | Standard browser API; works between renderer processes that share the same origin + Electron session/partition |
| `localStorage` + `storage` event | Same-origin same-partition fallback |
| Electron `ipcMain` + `ipcRenderer` | Main process holds a single UUID and IPC-distributes it to every renderer on start |
| Tauri events / Capacitor plugin | Same shape, different transport |
| Host's own state-sync library | If your app already has one, reuse it |

## Skeleton

Set the seed **before** importing the runtime. Synchronous read in the
runtime constructor means the seed must already be on `window`.

```ts
// renderer entry, dev-only
if (process.env.NODE_ENV === 'development') {
  void (async () => {
    const sessionId = await yourSharedStateLib.getOrCreate(
      'harness-fe:session',
      () => crypto.randomUUID(),
    )
    ;(window as any).__HARNESS_FE_SEED__ = { sessionId }
    await import('@harness-fe/runtime')
  })()
}
```

The first window to boot writes the UUID; subsequent windows read the
already-stored value and end up with the same sessionId. Their tabIds
remain distinct because `tabId` is keyed off each renderer's own
`sessionStorage`.

## Verify

In each window's DevTools:

```js
window.__HARNESS_FE_SEED__.sessionId   // same across all windows
window.__harness_fe_client__?.tabId    // different in every window
```

If both checks hold, the gateway will record one merged session and the
agent's `session.tail` will surface every window's events.

## Resetting the session

Set the seed to a new UUID and notify every window through the same
sync mechanism. Each renderer that picks up the change applies it on
the next page reload (or right away if the host triggers one). Useful
for a "clear logs / start fresh" devtool button.

## Caveats

- **Production builds**: keep all of this behind a `NODE_ENV` /
  feature-flag guard. The runtime + plugin are dev-only anyway, but the
  seed wiring should not ship to end users.
- **Race on first boot**: if two windows boot simultaneously and your
  sync primitive isn't strongly atomic, two UUIDs may race. The
  short-term inconsistency is harmless — the gateway will record up to
  two brief sessions before convergence. If you need stronger
  guarantees, gate window 2 with an "after window 1 ready" signal from
  your host.
- **Cross-origin renderers**: if your windows load from genuinely
  different origins, `BroadcastChannel` / `localStorage` won't bridge
  them. Use IPC through the host process.
