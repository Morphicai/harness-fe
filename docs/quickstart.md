# Quickstart

The 90-second path from "I have a frontend project" to "an AI agent can drive
it in my browser." Pick the section matching your stack; the rest of the
project's docs live in [`docs/`](./) and the [README](../README.md).

## Prerequisites

- Node.js ≥ 20 (Node 18 still works for client packages but the daemon needs 20)
- A package manager: pnpm ≥ 8 (recommended), npm ≥ 9, or yarn ≥ 1.22
- An MCP-aware agent runtime — Claude Code, Cursor, Kiro, Windsurf, or any
  client that speaks the [Model Context Protocol](https://modelcontextprotocol.io)

---

## Vite + React / Vue (3 minutes)

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

Start the daemon, then your app:

```bash
npx @harness-fe/mcp-server   # daemon on :47729
pnpm dev                     # your app
```

Open the app — the floating "H" overlay confirms the runtime is connected.

---

## Next.js (App or Pages Router, 3 minutes)

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
export default withHarness({ /* …your config… */ }, { projectId: 'my-app' });
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

The same `<HarnessScript>` seeds a per-request `sessionId` across SSR and the
client runtime, so one page-load lands in **one** session timeline.

---

## Webpack / Rspack / Other React toolchains

- Webpack 5 (native plugin, thread-loader compatible) — `@harness-fe/webpack`
- Rspack / esbuild / Rollup — `@harness-fe/unplugin`
- Any React 17+ toolchain without touching the bundler — set
  `tsconfig.compilerOptions.jsxImportSource` to `@harness-fe/react-jsx`

Each package's README on npm has a copy-paste config block.

---

## Connect an AI agent

The daemon advertises itself over stdio MCP. Register it once in your agent:

**Claude Code / Cursor / Kiro** (`~/.config/...` or in-app settings):

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

Alternatively, drop the bundled SKILL.md into your agent so it learns the
toolset's intended usage:

```bash
npx @harness-fe/skill install
```

The agent now sees `session_*`, `page_*`, `project_*`, `tasks_*` and friends.

---

## Verify

Open the dashboard at <http://localhost:47729/dashboard> — you should see:

- The current project, with a green "connected" dot
- A live session as soon as the dev page loads
- Network / console / errors streaming in real time

If the dashboard is empty, check [docs/troubleshooting.md](./troubleshooting.md).

---

## Next steps

- [Self-debug mode](./self-debug.md) — let an agent drive the Harness dashboard itself
- [LAN mode](./lan-mode.md) — phone or second-machine debugging
- [Docker](./docker.md) — share one daemon across a dev team
- [Electron / multi-window](./electron.md) — unified session across renderers
- [Versioning policy](./versioning-policy.md) — what semver promises mean here
