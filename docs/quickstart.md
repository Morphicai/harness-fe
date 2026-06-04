# Quickstart

The 90-second path from "I have a frontend project" to "an AI agent can drive
it in my browser." Pick the section matching your stack; the rest of the
project's docs live in [`docs/`](./) and the [README](../README.md).

## Prerequisites

- Node.js ≥ 20
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

Start your app — the gateway auto-spawns when the agent connects:

```bash
pnpm dev
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

**Install the skill first** — it teaches the agent *how* to use harness-fe, so you describe the problem and it drives:

```bash
npx @harness-fe/skill install      # auto-detects Claude Code / Cursor / Kiro
```

Then register the MCP server (`.mcp.json` or in-app settings). Solo / local — stdio, no token:

```jsonc
{
  "mcpServers": {
    "harness-fe": { "type": "stdio", "command": "npx", "args": ["-y", "@harness-fe/cli", "mcp"] }
  }
}
```

`harness mcp` auto-spawns a shared gateway on `127.0.0.1:47729` (once) and proxies the agent's MCP traffic to it. Multiple IDE windows reuse the same gateway automatically.

The agent now sees `session_*`, `page_*`, `project_*`, `tasks_*` and friends. Sharing one gateway across a team? Use governed mode instead — see [gateway-team-mode.md](./gateway-team-mode.md). Full setup: [agent-setup.md](./agent-setup.md).

---

## Verify

Open the console at <http://localhost:47729/console> — you should see:

- The current project, with a green "connected" dot
- A live session as soon as the dev page loads
- Network / console / errors streaming in real time

If the console is empty, check [docs/troubleshooting.md](./troubleshooting.md).

---

## Next steps

- [Self-debug mode](./self-debug.md) — let an agent drive the Harness console itself
- [LAN mode](./lan-mode.md) — phone or second-machine debugging
- [Electron / multi-window](./electron.md) — unified session across renderers
- [Versioning policy](./versioning-policy.md) — what semver promises mean here
