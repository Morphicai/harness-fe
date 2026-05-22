# @harness-fe/next

Next.js integration for Harness-FE. Drop-in Server Component + config wrapper. Works with App Router + Pages Router, webpack + Turbopack, Node + Edge runtime.

```bash
pnpm add -D @harness-fe/next @harness-fe/react-jsx @harness-fe/runtime @harness-fe/node-runtime
```

## What it does

1. **Server Component `<HarnessScript />`** — boots the runtime client in the browser AND auto-registers `@harness-fe/node-runtime` on first server render (no `instrumentation.ts` boilerplate).
2. **`getSessionId()`** — React `cache()`-backed, request-scoped UUID. Same id reused across every Server Component, Route Handler, and Server Action in one request, and seeded into the HTML so the browser client adopts it.
3. **`withHarness()`** — wraps `next.config.mjs` to inject the auto-boot import into the server bundle (alternative path for projects that don't render `<HarnessScript>` at the root).

## Quickstart (App Router)

**1. tsconfig.json** — enable source-tagging JSX runtime so agents can locate elements:
```jsonc
{
  "compilerOptions": {
    "jsxImportSource": "@harness-fe/react-jsx"
  }
}
```

**2. next.config.mjs** — *(optional, alternative to `<HarnessScript>`):*
```ts
import { withHarness } from '@harness-fe/next/config';
const nextConfig = { /* …your config… */ };
export default withHarness(nextConfig, { projectId: 'my-app' });
```

**3. app/layout.tsx** — Server Component, no `'use client'` needed:
```tsx
import { HarnessScript } from '@harness-fe/next';

export default async function RootLayout({ children }) {
    return (
        <html>
            <body>
                <HarnessScript
                    projectId="my-app"
                    userId={someUser?.id}
                    buildId={process.env.NEXT_PUBLIC_GIT_SHA}
                />
                {children}
            </body>
        </html>
    );
}
```

**4.** Start the daemon (`pnpm exec @harness-fe/mcp-server` or any installed binary) then `pnpm dev`. Two `peer connected` lines should appear in the daemon log per refresh — one `role=node-runtime`, one `role=runtime-client`, **same `sessionId`**.

## `<HarnessScript />` props

| Prop | Type | Default | Notes |
|---|---|---|---|
| `projectId` | `string` (required) | — | Stable id for the codebase; agents key off this |
| `displayName` | `string` | `projectId` | Human-readable label shown in agent UIs |
| `userId` | `string?` | — | App-supplied user id; daemon-local, never leaves your machine |
| `buildId` | `string?` | — | Build artifact id (e.g. `process.env.NEXT_PUBLIC_GIT_SHA`) |
| `parentProjectId` | `string?` | — | Set when this app is hosted inside another via iframe / module federation |
| `mcpUrl` | `string?` | `ws://127.0.0.1:47729` | Daemon WebSocket URL |

In production (`NODE_ENV !== 'development'`) `<HarnessScript>` renders `null` and pulls no code into client bundles.

## How sessionId stays unified

This is the value-add over a plain pair of "server SDK + browser SDK":

```
request arrives
  │
  ▼
<HarnessScript> renders (Server Component)
  │  ├─ ensureNodeRuntimeBooted() ─ registers @harness-fe/node-runtime once per process
  │  ├─ import('./sessionId.js')   ─ side-effect: setSessionIdProvider(getSessionId)
  │  └─ getSessionId() ────────────► React cache() allocates sid-X for this render
  │                                                                │
  │                                                                ▼
  ▼                                                       server-side console.log
seed <script>window.__HARNESS_FE_SEED__={sessionId:'sid-X'}                │
                                                                ▼
                                                       node-runtime
                                                       .getRequestSessionId()
                                                       reads provider → 'sid-X'
                                                                ▼
                                                       server-log event { sessionId: 'sid-X' }
HTML reaches browser
  │
  ▼
<HarnessScriptClient> hydrates
  └─ reads window.__HARNESS_FE_SEED__ → adopts sid-X
                │
                ▼
            client console.log / log.info
            → app-log event { sessionId: 'sid-X' }
```

Result: **one refresh = one `sessions/{sid-X}/timeline.jsonl`** containing both server and client events. No bookkeeping in user code.

## Edge runtime

`<HarnessScript>` detects `process.env.NEXT_RUNTIME === 'edge'` and loads `@harness-fe/node-runtime/auto-edge` instead of the WebSocket-based main entry. Edge requests post events to the daemon over HTTP-batch (`POST /events`) since Edge can't keep a long-lived WS or call `process.on`. Same `sessionId`, same timeline.

## Auto-boot via webpack vs `<HarnessScript>`

Two paths to register the Node SDK:

| | `<HarnessScript>` | `withHarness()` |
|---|---|---|
| Where it boots | First server render | Server bundle entry-point |
| Required for SSR-less routes (Route Handlers only) | No | Yes |
| Works with Turbopack | ✅ (no bundler plugin) | ⚠️ webpack only |
| Recommended | **Yes**, for almost everyone | Use if you have Route Handlers but no rendered pages |

You can use both at once; `register()` is idempotent.

## Exports

```ts
// @harness-fe/next
export { HarnessScript, type HarnessScriptProps };
export { getSessionId };

// @harness-fe/next/config
export { withHarness, type WithHarnessOptions };

// @harness-fe/next/sessionId
export const getSessionId: () => string;   // React cache()-backed
```

## What the SSR seed looks like

Inlined script in the body, runs before hydration:
```html
<script id="__hfe_seed__">window.__HARNESS_FE_SEED__={"sessionId":"01HM..."};</script>
```

The runtime client reads this at `DOMContentLoaded` and adopts the id instead of generating a fresh UUID — that's how server and client end up with the same `sessionId`.

## License

MIT
