# harness-fe · Electron rrweb demo

A minimal Electron app that loads a vite-served renderer wired with
`@harness-fe/vite`. Its purpose is to **verify that rrweb records normally inside
an Electron renderer** — the open question behind harness-fe#158 (startup perf)
and #159 (replay "not supported" in Electron).

## TL;DR — does rrweb record in Electron?

**Yes.** An Electron `BrowserWindow` renderer is a full Chromium browser context.
`@harness-fe/runtime`'s recorder (`packages/runtime-client/src/recording.ts`)
calls rrweb `record()` with only standard DOM/`window` APIs and needs no Node
access, so it produces the same `type:2` FullSnapshot + incremental events it does
in a normal browser tab. Nothing in the ingest/replay path
(`core/src/bridge.ts`, `replayCreate.ts`, console-ui `SessionDetail`) is
environment-specific.

The two Electron issues were **not** "rrweb can't run in Electron":

- **#159 ("replay not supported")** was traced to a **wujie micro-frontend**
  child app, where rrweb threw while traversing the wujie shadow/iframe container,
  corrupting the FullSnapshot baseline → no `type:2` → replay had nothing to
  assemble. The fix (shipped in #163) is the `blockSelector` option, which keeps
  rrweb out of containers it can't serialize. Plain Electron (this demo, no wujie)
  never hits that path.
- **#158 ("first entry janky")** is a **perf** concern, not correctness: the
  initial FullSnapshot serializes the whole DOM synchronously, and a heavy
  Electron DOM makes that block the main thread more visibly. Recording still
  works; it's the startup cost that #163 reduced (ack-time snapshot de-dup, etc.).

This demo reproduces the **happy path**: a plain Electron renderer with no wujie,
where recording works end-to-end.

## Run

```bash
pnpm --filter harness-fe-electron-demo dev
```

This starts:

1. the **vite dev server** on `http://127.0.0.1:47816` (renderer),
2. a **solo harness gateway** auto-spawned by the vite plugin on `:47952`
   (Open policy, loopback, no token),
3. an **Electron window** (via `wait-on` once vite is up) loading the vite URL.

Then inspect the recording from any MCP client pointed at the solo gateway, or via
the console at `http://127.0.0.1:47952/console`. Look for project `electron-demo`,
open the session, and confirm:

- `session.recordings.list` returns chunks with a `type:2` FullSnapshot, and
- `session.tail` shows `console` / `err` / DOM events streaming in.

Set `OPEN_DEVTOOLS=1` to detach the renderer DevTools and check
`window.__harness_fe_client__?.tabId` directly.

## Why HTTP, not file://

In dev the window loads the **vite dev server over HTTP**. That's what lets the
`@harness-fe/vite` plugin's `transformIndexHtml` inject `window.__HARNESS_FE__` +
the runtime entry. A `file://` renderer bypasses vite and would get no injection —
so harness is dev-server-bound, exactly as in any other vite app. (A production
`vite build` is loaded via `file://`, where harness is intentionally absent.)

## Multi-window note

This demo is single-window. For a multi-window Electron app where you want **one
session across all windows**, set `window.__HARNESS_FE_SEED__.sessionId` before the
runtime boots — see `docs/electron.md` ("the seed contract").
