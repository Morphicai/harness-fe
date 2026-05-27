# Next.js

Supports App Router and Pages Router. Server-side events (Route Handlers, Server Actions, `console.*` in Server Components) are captured alongside browser events in **one unified session**.

## Install

::: code-group

```bash [pnpm]
pnpm add -D @harness-fe/next @harness-fe/react-jsx @harness-fe/runtime @harness-fe/node-runtime
```

```bash [npm]
npm install -D @harness-fe/next @harness-fe/react-jsx @harness-fe/runtime @harness-fe/node-runtime
```

:::

## Configure

### 1. TypeScript — set JSX import source

```jsonc [tsconfig.json]
{
  "compilerOptions": {
    "jsxImportSource": "@harness-fe/react-jsx"
  }
}
```

This tags every React element with its file path and line number — no Babel/SWC transform required.

### 2. Next.js config

```ts [next.config.mjs]
import { withHarness } from '@harness-fe/next/config';

export default withHarness(
  { /* your existing next config */ },
  { projectId: 'my-app' }
);
```

### 3. Root layout — add `<HarnessScript>`

```tsx [app/layout.tsx]
import { HarnessScript } from '@harness-fe/next';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <HarnessScript />
      </body>
    </html>
  );
}
```

`<HarnessScript>` is a Server Component that seeds the same `sessionId` into the SSR HTML and the client runtime — so one page load produces **one** unified session timeline.

## Start the daemon

```bash
npx @harness-fe/mcp-server
pnpm dev
```

## Server-side events

Node runtime captures automatically:
- `console.log/warn/error` in Server Components, Route Handlers, Server Actions
- `uncaughtException` / `unhandledRejection`
- Route Handler request/response traces

No extra config needed — `withHarness` sets up the node runtime automatically.

## Structured logging

Use `@harness-fe/log` for isomorphic structured logging across server and client:

```ts
import { log } from '@harness-fe/log';

// Works in Server Components, Route Handlers, AND the browser
log.info('user.action', { userId, action: 'checkout' });
```

## Pages Router

The setup is identical — `withHarness` in `next.config.mjs` and add `<HarnessScript />` to `_app.tsx`:

```tsx [pages/_app.tsx]
import { HarnessScript } from '@harness-fe/next';
import type { AppProps } from 'next/app';

export default function App({ Component, pageProps }: AppProps) {
  return (
    <>
      <Component {...pageProps} />
      <HarnessScript />
    </>
  );
}
```
