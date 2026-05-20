# @harnessa-fe/next

Next.js integration for Harnessa-FE. Drop-in Server Component + config wrapper. Works with App Router + Pages Router, webpack + Turbopack, Node + Edge runtime.

```bash
pnpm add -D @harnessa-fe/next @harnessa-fe/react-jsx @harnessa-fe/runtime @harnessa-fe/node-runtime
```

## What it does

1. **Server Component `<HarnessaScript />`** — boots the runtime client in the browser AND auto-registers `@harnessa-fe/node-runtime` on first server render (no `instrumentation.ts` boilerplate).
2. **`getSessionId()`** — React `cache()`-backed, request-scoped UUID. Same id reused across every Server Component, Route Handler, and Server Action in one request, and seeded into the HTML so the browser client adopts it.
3. **`withHarnessa()`** — wraps `next.config.mjs` to inject the auto-boot import into the server bundle (alternative path for projects that don't render `<HarnessaScript>` at the root).

## Quickstart (App Router)

**1. tsconfig.json** — enable source-tagging JSX runtime so agents can locate elements:
```jsonc
{
  "compilerOptions": {
    "jsxImportSource": "@harnessa-fe/react-jsx"
  }
}
```

**2. next.config.mjs** — *(optional, alternative to `<HarnessaScript>`):*
```ts
import { withHarnessa } from '@harnessa-fe/next/config';
const nextConfig = { /* …your config… */ };
export default withHarnessa(nextConfig, { projectId: 'my-app' });
```

**3. app/layout.tsx** — Server Component, no `'use client'` needed:
```tsx
import { HarnessaScript } from '@harnessa-fe/next';

export default async function RootLayout({ children }) {
    return (
        <html>
            <body>
                <HarnessaScript
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

**4.** Start the daemon (`pnpm exec @harnessa-fe/mcp-server` or any installed binary) then `pnpm dev`. Two `peer connected` lines should appear in the daemon log per refresh — one `role=node-runtime`, one `role=runtime-client`, **same `sessionId`**.

## `<HarnessaScript />` props

| Prop | Type | Default | Notes |
|---|---|---|---|
| `projectId` | `string` (required) | — | Stable id for the codebase; agents key off this |
| `displayName` | `string` | `projectId` | Human-readable label shown in agent UIs |
| `userId` | `string?` | — | App-supplied user id; daemon-local, never leaves your machine |
| `buildId` | `string?` | — | Build artifact id (e.g. `process.env.NEXT_PUBLIC_GIT_SHA`) |
| `parentProjectId` | `string?` | — | Set when this app is hosted inside another via iframe / module federation |
| `mcpUrl` | `string?` | `ws://127.0.0.1:47729` | Daemon WebSocket URL |

In production (`NODE_ENV !== 'development'`) `<HarnessaScript>` renders `null` and pulls no code into client bundles.

## How sessionId stays unified

This is the value-add over a plain pair of "server SDK + browser SDK":

```
request arrives
  │
  ▼
<HarnessaScript> renders (Server Component)
  │  ├─ ensureNodeRuntimeBooted() ─ registers @harnessa-fe/node-runtime once per process
  │  ├─ import('./sessionId.js')   ─ side-effect: setSessionIdProvider(getSessionId)
  │  └─ getSessionId() ────────────► React cache() allocates sid-X for this render
  │                                                                │
  │                                                                ▼
  ▼                                                       server-side console.log
seed <script>window.__HARNESSA_FE_SEED__={sessionId:'sid-X'}                │
                                                                ▼
                                                       node-runtime
                                                       .getRequestSessionId()
                                                       reads provider → 'sid-X'
                                                                ▼
                                                       server-log event { sessionId: 'sid-X' }
HTML reaches browser
  │
  ▼
<HarnessaScriptClient> hydrates
  └─ reads window.__HARNESSA_FE_SEED__ → adopts sid-X
                │
                ▼
            client console.log / log.info
            → app-log event { sessionId: 'sid-X' }
```

Result: **one refresh = one `sessions/{sid-X}/timeline.jsonl`** containing both server and client events. No bookkeeping in user code.

## Edge runtime

`<HarnessaScript>` detects `process.env.NEXT_RUNTIME === 'edge'` and loads `@harnessa-fe/node-runtime/auto-edge` instead of the WebSocket-based main entry. Edge requests post events to the daemon over HTTP-batch (`POST /events`) since Edge can't keep a long-lived WS or call `process.on`. Same `sessionId`, same timeline.

## Auto-boot via webpack vs `<HarnessaScript>`

Two paths to register the Node SDK:

| | `<HarnessaScript>` | `withHarnessa()` |
|---|---|---|
| Where it boots | First server render | Server bundle entry-point |
| Required for SSR-less routes (Route Handlers only) | No | Yes |
| Works with Turbopack | ✅ (no bundler plugin) | ⚠️ webpack only |
| Recommended | **Yes**, for almost everyone | Use if you have Route Handlers but no rendered pages |

You can use both at once; `register()` is idempotent.

## Exports

```ts
// @harnessa-fe/next
export { HarnessaScript, type HarnessaScriptProps };
export { getSessionId };

// @harnessa-fe/next/config
export { withHarnessa, type WithHarnessaOptions };

// @harnessa-fe/next/sessionId
export const getSessionId: () => string;   // React cache()-backed
```

## What the SSR seed looks like

Inlined script in the body, runs before hydration:
```html
<script id="__hfe_seed__">window.__HARNESSA_FE_SEED__={"sessionId":"01HM..."};</script>
```

The runtime client reads this at `DOMContentLoaded` and adopts the id instead of generating a fresh UUID — that's how server and client end up with the same `sessionId`.

## License

MIT
