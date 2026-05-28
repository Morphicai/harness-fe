# 快速开始

从"我有一个前端项目"到"AI Agent 可以在我的浏览器里驱动它"的 90 秒路径。挑选与你技术栈匹配的章节即可;项目的其他文档在 [`docs/`](/zh/guide/introduction) 和 [README](https://github.com/Morphicai/harness-fe#readme) 中。

## 前置条件

- Node.js ≥ 20
- 包管理器:pnpm ≥ 8(推荐)、npm ≥ 9 或 yarn ≥ 1.22
- 一个支持 MCP 的 Agent 运行时——Claude Code、Cursor、Kiro、Windsurf,或任何支持 [Model Context Protocol](https://modelcontextprotocol.io) 的客户端

---

## Vite + React / Vue(3 分钟)

```bash
pnpm add -D @harness-fe/vite @harness-fe/runtime
```

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { harnessFE } from '@harness-fe/vite';

export default defineConfig({
  plugins: [react(), harnessFE()],
});
```

启动 daemon,再启动你的应用:

```bash
npx @harness-fe/mcp-server   # daemon 监听 :47729
pnpm dev                     # 你的应用
```

打开应用——浮动的 "H" 悬浮按钮表示运行时已连接。

---

## Next.js(App Router 或 Pages Router,3 分钟)

```bash
pnpm add -D @harness-fe/next @harness-fe/react-jsx @harness-fe/runtime @harness-fe/node-runtime
```

```jsonc
// tsconfig.json
{ "compilerOptions": { "jsxImportSource": "@harness-fe/react-jsx" } }
```

```ts
// next.config.mjs
import { withHarness } from '@harness-fe/next/config';
export default withHarness({ /* …你的配置… */ }, { projectId: 'my-app' });
```

```tsx
// app/layout.tsx
import { HarnessScript } from '@harness-fe/next';

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        {children}
        <HarnessScript />
      </body>
    </html>
  );
}
```

```bash
npx @harness-fe/mcp-server
pnpm dev
```

同一个 `<HarnessScript>` 会跨 SSR 和客户端运行时埋入按请求的 `sessionId`,这样一次页面加载就落入**一个** session 时间线。

---

## Webpack / Rspack / 其他 React 工具链

- Webpack 5(原生插件,兼容 thread-loader)—— `@harness-fe/webpack`
- Rspack / esbuild / Rollup —— `@harness-fe/unplugin`
- 任何 React 17+ 工具链而不动打包器——把 `tsconfig.compilerOptions.jsxImportSource` 设为 `@harness-fe/react-jsx`

每个包的 npm README 都有可直接复制粘贴的配置片段。

---

## 接入 AI Agent

daemon 通过 stdio MCP 暴露自身。在 Agent 中注册一次即可:

**Claude Code / Cursor / Kiro**(`~/.config/...` 或应用内设置):

```jsonc
{
  "mcpServers": {
    "harness-fe": {
      "command": "npx",
      "args": ["@harness-fe/mcp-server", "--stdio"]
    }
  }
}
```

也可以把内置的 SKILL.md 投放到 Agent 中,让它学会工具集的预期用法:

```bash
npx @harness-fe/skill install
```

Agent 现在可以看到 `session_*`、`page_*`、`project_*`、`tasks_*` 等工具。

---

## 验证

打开 dashboard <http://localhost:47729/dashboard> —— 应该看到:

- 当前项目,以及绿色的 "connected" 圆点
- dev 页面加载后立刻出现的实时 session
- 实时流入的 网络 / console / 错误

如果 dashboard 是空的,查看 [docs/troubleshooting.md](/zh/guide/troubleshooting)。

---

## 下一步

- [自调试模式](/zh/guide/self-debug) —— 让 Agent 自己驱动 Harness dashboard
- [LAN 模式](/zh/integrations/lan-mode) —— 手机或第二台机器调试
- [Docker](/zh/integrations/docker) —— 团队共享一个 daemon
- [Electron / 多窗口](/zh/integrations/electron) —— 跨 renderer 的统一 session
- [版本策略](/zh/reference/versioning-policy) —— 这里 semver 承诺的含义
