# Vite + React / Vue

3 分钟内为任何 Vite 项目加上 Harness-FE。

## 安装

::: code-group

```bash [pnpm]
pnpm add -D @harness-fe/vite @harness-fe/runtime
```

```bash [npm]
npm install -D @harness-fe/vite @harness-fe/runtime
```

```bash [yarn]
yarn add -D @harness-fe/vite @harness-fe/runtime
```

:::

## 配置

```ts [vite.config.ts]
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';   // 或 @vitejs/plugin-vue
import { harnessFE } from '@harness-fe/vite';

export default defineConfig({
  plugins: [
    react(),
    harnessFE(),          // 本地 dev 零配置
  ],
});
```

### 带 options

```ts [vite.config.ts]
harnessFE({
  projectId: 'my-app',        // 默认取 package.json 的 name
  displayName: 'My App',      // dashboard 中展示
  mcpUrl: 'ws://127.0.0.1:47729',  // 默认
})
```

## 启动 daemon

```bash
npx @harness-fe/mcp-server   # 跑在 :47729
pnpm dev                     # 你的应用
```

打开应用——角落里浮动的 **H** 按钮表示运行时已连接。

## 接入 Agent

加到你的 MCP 客户端配置(Claude Code / Cursor / Kiro):

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

## 安装 Agent playbook

让 Agent 知道每个工具的用途:

```bash
npx @harness-fe/skill install
```

## 验证

打开 <http://localhost:47729/dashboard> —— 应该看到你的项目,带一个实时 session,事件正在流入。

如果是空的,查看[故障排查指南](/zh/guide/troubleshooting)。
