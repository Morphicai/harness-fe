# @harness-fe/node-runtime

Node.js server-side SDK for Harness-FE. Captures server errors, console output, and Route Handler / Server Action traces — and links them to the browser session via a shared `sessionId`.

```bash
pnpm add @harness-fe/node-runtime
```

Most users don't import this directly — `@harness-fe/next`'s `<HarnessScript>` auto-boots it. Reach for it when:
- You're on Next but want to call `register()` from `instrumentation.ts` yourself
- You're on Express / Fastify / Hono / Koa / any non-Next Node server
- You're writing a framework adapter and want to plug a `sessionId` resolver in via `setSessionIdProvider`

## What it captures

| Event | When |
|---|---|
| `server-err` | `process.on('uncaughtException')`, `unhandledRejection`, or explicit `reportError()` |
| `server-log` | Auto-captured `console.log/info/warn/error/debug` calls (toggle via `captureConsole`) |
| `app-log` | Explicit `reportAppLog()` calls — `@harness-fe/log` emits these |
| `server-action` | Handlers wrapped with `withHarnessTracing()` — duration + status |

Every event is tagged with the current request's `sessionId` (when one exists).

## Quickstart — non-Next Node app

```ts
// app.ts (Express example)
import express from 'express';
import { register, withHarnessTracing } from '@harness-fe/node-runtime';

register({
    projectId: 'my-api',
    buildId: process.env.GIT_SHA,
    mcpUrl: 'ws://127.0.0.1:47729',
});

const app = express();

app.get('/hello', withHarnessTracing(async (req, res) => {
    console.log('handling /hello'); // → server-log with this request's sessionId
    res.json({ ok: true });
}));
```

`withHarnessTracing()` reads the `x-hfe-session-id` header (set by the browser runtime client when it ships events) and binds it into `AsyncLocalStorage` for the handler scope. Every `console.*` call and any `reportError()` inside the handler inherits that id.

## Quickstart — Next.js (advanced)

If you already use `<HarnessScript>`, you're done — it calls `register()` for you. The remaining hook you might care about is `withHarnessTracing` for Route Handlers:

```ts
// app/api/foo/route.ts
import { withHarnessTracing } from '@harness-fe/node-runtime';

export const POST = withHarnessTracing(async (req: Request) => {
    console.log('foo received');
    return Response.json({ ok: true });
});
```

For App Router pages, `<HarnessScript>` already sets up the `cache()`-backed sessionId; you don't need `withHarnessTracing` there.

## API

### `register(opts: RegisterOptions): void`

Idempotent. First call wires up the transport (WS in Node runtime, HTTP-batch in Edge), installs `process.on('uncaughtException' / 'unhandledRejection')` handlers, and patches `console.*` (unless disabled).

| Option | Default | Notes |
|---|---|---|
| `projectId` (required) | — | Stable id; matches your package.json name typically |
| `displayName` | `projectId` | Label shown in agent UIs |
| `buildId` | — | Build artifact id (git SHA) |
| `mcpUrl` | `ws://127.0.0.1:47729` | Daemon WebSocket URL |
| `baseUrl` | derived | Daemon HTTP base — only matters when using HTTP transport (Edge) |
| `captureConsole` | `true` | Set `false` (or env `HARNESS_FE_NODE_CONSOLE=0`) to skip patching `console.*` |

### `withHarnessTracing(handler)`

HoC for Route Handlers / Server Actions. Reads `x-hfe-session-id` from the incoming request, binds it into ALS for the handler's async scope, and emits a `server-action` event on completion (duration + status).

### `setSessionIdProvider(fn: () => string | undefined): void`

Dependency-injection hook for framework adapters. The Next adapter calls this on module load with its React `cache()`-backed `getSessionId`. node-runtime stays React-agnostic; the adapter pushes its environment-specific resolver in.

### `getRequestSessionId(): string | undefined`

Returns the current request's sessionId. Resolution order:
1. `AsyncLocalStorage` (populated by `withHarnessTracing()`)
2. Adapter-supplied provider (from `setSessionIdProvider`)
3. `undefined` → orphan event

### `reportError(err, ctx?)`

Explicit error report; auto-called by the global `uncaughtException` / `unhandledRejection` handlers.

### `reportLog(level, args, ctx?)` / `reportAppLog(level, args, ctx?)`

Lower-level emit. `reportAppLog` is what `@harness-fe/log` calls; you can use it directly if you want the same `t: 'app-log'` event type without the wrapper.

## Transport selection

| Condition | Transport |
|---|---|
| `process.env.NEXT_RUNTIME === 'edge'` | HTTP-batch (`POST /events`) |
| `HARNESS_FE_TRANSPORT=http` env | HTTP-batch |
| `ws` module installed (default in Node) | WebSocket |
| Fallback | HTTP-batch |

The Edge entry point is `@harness-fe/node-runtime/auto-edge` (loaded automatically by `<HarnessScript>` when on Edge). It doesn't import `ws` and doesn't call `process.on`, keeping the worker bundle slim.

## Auto-boot via `/auto` entry

For Node-runtime users who want zero-touch:

```ts
// at the very top of your server entry
import '@harness-fe/node-runtime/auto';
```

The auto module reads `HARNESS_FE_*` env vars (projectId, mcpUrl, buildId, …) and calls `register()` for you. Works in webpack-bundled Next server entries (`withHarness()` injects this for you).

## Concurrency safety

`getRequestSessionId()` is **read fresh on every call** — never closed over. Two concurrent requests in the same Node process get separate `AsyncLocalStorage` scopes (via `withHarnessTracing`) AND separate React `cache()` scopes (via the Next adapter provider). 28 unit tests verify zero cross-request contamination including a `Promise.all([renderA, renderB])` interleaved-`console.log` case.

## Orphans

If a `console.log` (or `reportError`, etc.) fires with no ALS and no adapter provider — e.g. cold-start init, post-response timer, top-level module side-effect — it emits with `sessionId: undefined`. The daemon files these under `~/.harness/data/sessions/server-orphans/...` rather than guessing. Better orphaned than misattributed.

## Production behavior

`<HarnessScript>` and the `/auto` entry only call `register()` when `NODE_ENV === 'development'`. If you call `register()` directly outside of dev, it still works — useful for staging or self-hosted dev environments — but you must opt in explicitly.

## License

MIT
