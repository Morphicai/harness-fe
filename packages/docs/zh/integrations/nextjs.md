# Next.js

支持 App Router 和 Pages Router。服务端事件(Route Handlers、Server Actions、Server Components 中的 `console.*`)与浏览器事件捕获在**同一个统一 session** 中。

## 安装

::: code-group

```bash [pnpm]
pnpm add -D @harness-fe/next @harness-fe/react-jsx @harness-fe/runtime @harness-fe/node-runtime
```

```bash [npm]
npm install -D @harness-fe/next @harness-fe/react-jsx @harness-fe/runtime @harness-fe/node-runtime
```

:::

## 配置

### 1. TypeScript —— 设置 JSX import source

```jsonc [tsconfig.json]
{
  "compilerOptions": {
    "jsxImportSource": "@harness-fe/react-jsx"
  }
}
```

这会给每个 React 元素打上文件路径和行号——不需要 Babel/SWC 转换。

### 2. Next.js config

```ts [next.config.mjs]
import { withHarness } from '@harness-fe/next/config';

export default withHarness(
  { /* 你已有的 next 配置 */ },
  { projectId: 'my-app' }
);
```

### 3. 根 layout —— 加 `<HarnessScript>`

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

`<HarnessScript>` 是 Server Component,它把同一个 `sessionId` 种入 SSR HTML 和客户端运行时——这样一次页面加载产出**一个**统一的 session 时间线。

## 启动 daemon

```bash
npx @harness-fe/mcp-server
pnpm dev
```

## 服务端事件

Node runtime 自动捕获:
- Server Components、Route Handlers、Server Actions 中的 `console.log/warn/error`
- `uncaughtException` / `unhandledRejection`
- Route Handler 的请求/响应 trace

无需额外配置——`withHarness` 自动设好 node runtime。

## 结构化日志

用 `@harness-fe/log` 做跨服务端 / 客户端的同构结构化日志:

```ts
import { log } from '@harness-fe/log';

// 在 Server Components、Route Handlers 和浏览器中都能用
log.info('user.action', { userId, action: 'checkout' });
```

## Pages Router

配置一致——`next.config.mjs` 里 `withHarness`,`_app.tsx` 里加 `<HarnessScript />`:

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
