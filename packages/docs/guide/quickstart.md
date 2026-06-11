# Quickstart

The 90-second path from "I have a frontend project" to "an AI agent can drive
it in my browser." Pick the section matching your stack; the rest of the
project's docs live in [`docs/`](/guide/introduction) and the [README](https://github.com/Morphicai/harness-fe#readme).

## Prerequisites

- Node.js ≥ 20
- A package manager: pnpm ≥ 8 (recommended), npm ≥ 9, or yarn ≥ 1.22
- An MCP-aware agent runtime — Claude Code, Cursor, Kiro, Windsurf, or any
  client that speaks the [Model Context Protocol](https://modelcontextprotocol.io)

---

## Step 1: Install the agent skill (recommended)

The **agent skill** is the canonical onboarding path. It teaches your agent how
Harness-FE works — install steps, MCP config, tool catalog, decision flows,
safety constraints — all in one file the agent reads at the start of every
session.

```bash
npx @harness-fe/skill install
```

That drops `.claude/skills/harness-fe/SKILL.md` into your project (other agents:
`install cursor` / `install kiro` / `install plain`). From here, ask your agent:

> "Set up Harness-FE in this project."

The agent reads the skill, detects your bundler, runs the right install
commands, and writes the MCP config. The rest of this page is the manual path
— useful as a reference, or when you want to do it yourself.

::: tip Why skill-first
The skill is a single source of truth. When the docs site updates, you bump
`@harness-fe/skill` once and every agent gets the latest playbook — no need
to keep copy-pasted instructions in sync across teammates.
:::

---

## Step 2 (manual path): Vite + React / Vue (3 minutes)

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

If you installed the skill (Step 1), this config is already explained inside
the skill — the agent will write it for you. The agent now sees `session_*`,
`page_*`, `project_*`, `tasks_*` and friends.

---

## Verify

Open the dashboard at <http://localhost:47729/dashboard> — you should see:

- The current project, with a green "connected" dot
- A live session as soon as the dev page loads
- Network / console / errors streaming in real time

If the dashboard is empty, check [docs/troubleshooting.md](/guide/troubleshooting).

---

## Next steps

- [Team mode (gateway)](/guide/team-mode) — share one daemon across a team: caller identity, project isolation, and a [consent gate](/guide/consent) on browser control
- [Self-debug mode](/guide/self-debug) — let an agent drive the Harness dashboard itself
- [LAN mode](/integrations/lan-mode) — phone or second-machine debugging
- [Docker](/integrations/docker) — share one daemon across a dev team
- [Electron / multi-window](/integrations/electron) — unified session across renderers
- [Versioning policy](/reference/versioning-policy) — what semver promises mean here
