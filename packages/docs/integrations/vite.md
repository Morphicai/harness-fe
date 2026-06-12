# Vite + React / Vue

Add harness-fe to any Vite project in under 3 minutes.

## Install

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

## Configure

```ts [vite.config.ts]
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';   // or @vitejs/plugin-vue
import { harnessFE } from '@harness-fe/vite';

export default defineConfig({
  plugins: [
    react(),
    harnessFE(),          // zero-config for local dev
  ],
});
```

### With options

```ts [vite.config.ts]
harnessFE({
  projectId: 'my-app',        // defaults to package.json name
  displayName: 'My App',      // shown in the dashboard
  mcpUrl: 'ws://127.0.0.1:47729',  // default
})
```

## Start the daemon

```bash
npx @harness-fe/mcp-server   # runs on :47729
pnpm dev                     # your app
```

Open your app — the floating **H** button in the corner confirms the runtime is connected.

## Connect an agent

Add to your MCP client config (Claude Code / Cursor / Kiro):

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

## Install the agent playbook

Teach your agent what every tool does:

```bash
npx @harness-fe/skill install
```

## Verify

Open <http://localhost:47729/dashboard> — you should see your project with a live session and events streaming in.

If it's empty, check the [troubleshooting guide](/guide/troubleshooting).
