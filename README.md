<p align="center">
  <img src="branding/logo.svg" alt="Harness-FE" width="200" />
</p>

<h1 align="center">Harness-FE</h1>

<p align="center">
  <strong>The agent that built it never leaves.</strong>
</p>

<p align="center">
  A source-aware harness for every AI-built app — source-mapped build plugins, an MCP gateway, and a runtime client that let the agent keep watching, listening, and fixing the app long after it ships.
</p>

<p align="center">
  <em>Every AI-coded app should ship with the runtime that keeps it bonded to the agent that built it.</em> — see <a href="./VISION.md">VISION.md</a>
</p>

<p align="center">
  <a href="https://github.com/Morphicai/harness-fe/actions/workflows/ci.yml"><img src="https://github.com/Morphicai/harness-fe/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://www.npmjs.com/package/@harness-fe/cli"><img src="https://img.shields.io/npm/v/@harness-fe/cli?label=cli&color=4f46e5" alt="npm @harness-fe/cli" /></a>
  <a href="https://www.npmjs.com/package/@harness-fe/vite"><img src="https://img.shields.io/npm/v/@harness-fe/vite?label=vite&color=10b981" alt="npm @harness-fe/vite" /></a>
  <a href="https://www.npmjs.com/package/@harness-fe/next"><img src="https://img.shields.io/npm/v/@harness-fe/next?label=next&color=fb7185" alt="npm @harness-fe/next" /></a>
  <a href="https://www.npmjs.com/package/@harness-fe/cli"><img src="https://img.shields.io/npm/dm/@harness-fe/cli?label=downloads&color=64748b" alt="npm downloads" /></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%E2%89%A520-3c873a" alt="Node ≥ 20" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT" /></a>
  <a href="./CONTRIBUTING.md"><img src="https://img.shields.io/badge/PRs-welcome-fbbf24" alt="PRs welcome" /></a>
</p>

---

## Features

- **Source-Aware Instrumentation** — Injects `data-morphix-loc` and `data-morphix-comp` attributes into JSX / Vue elements (via build plugin OR `@harness-fe/react-jsx` `jsxImportSource`), giving AI agents precise file:line:column references for every UI element.
- **MCP Gateway** — Connects AI agents (Claude, Cursor, Kiro) to browser + server runtimes via WebSocket / HTTP. Solo mode auto-spawns a shared loopback gateway; team mode (`harness --governed`) adds RBAC tokens, project→agent binding, and audit. Bidirectional command/event communication with a unified timeline per page-load.
- **Browser Runtime + Overlay** — A lightweight browser SDK that captures console / network / errors / DOM (rrweb), exposes an in-page "H" overlay so users can file annotated screenshots (arrow + text on a snapdom-captured PNG), and surfaces a "My reports" view to manage their submissions. The overlay is **extensible** — add custom action buttons via `registerOverlayPlugin` to send the current scene/logs to your own system (issue tracker, Slack, webhook). See [docs/overlay-plugins.md](./docs/overlay-plugins.md).
- **Server-Side Capture (Next.js)** — `@harness-fe/node-runtime` collects Server Component errors, Route Handler / Server Action durations, and uncaught Node exceptions. `<HarnessScript>` is a Server Component that uses React `cache()` to bind the **same sessionId** across SSR and the client runtime — one refresh = one `sessions/{id}/timeline.jsonl`.
- **Edge Runtime Compatible** — When Next emits an Edge worker bundle the SDK auto-switches to an HTTP-batch transport (`POST /events` on the gateway) so Cloudflare Workers / Vercel Edge routes flow into the same gateway as Node routes.
- **Visitor Identity** — Anonymous, stable per-browser identifier (`localStorage`) + optional `userId` from the app's auth layer. Lets agents build a real user journey across refreshes, tabs, and same-origin iframes.
- **Annotated Feedback Loop** — Users file tasks through the overlay; the screenshot's arrow + text annotations are flattened into the PNG so vision models read the annotations directly off pixels. Agents fetch the image via `tasks_get_attachment` as a native MCP image-content block.
- **Multi-Bundler & Multi-Framework** — Stable on Vite + React, Webpack + React, Vite/Webpack + Vue 3, Next.js (App + Pages Router, webpack + Turbopack). Any React 17+ toolchain via `@harness-fe/react-jsx` `jsxImportSource`.
- **Zero Production Overhead** — All instrumentation, WebSocket / HTTP connections, the overlay, and the Node SDK are gated behind `NODE_ENV === 'development'`.

## How It Works

Harness-FE uses a three-layer architecture to connect AI agents with your running application:

```mermaid
graph LR
    Agent["🤖 AI Agent<br/>(Claude / Kiro)"]
    GW["⚡ Gateway<br/>(harness)"]
    Plugin["🔧 Build Plugin<br/>(Vite / Webpack)"]
    Runtime["🌐 Runtime Client<br/>(Browser)"]

    Agent <-->|stdio or HTTP-MCP| GW
    GW <-->|WebSocket /ws| Plugin
    GW <-->|WebSocket /ws| Runtime
```

| Layer | Role | Communication |
|-------|------|---------------|
| **Build Plugin** | Transforms source files at dev-time, injecting location and component metadata into JSX/Vue templates. Sends HMR and error events to the gateway. | WebSocket `/ws` → Gateway |
| **Runtime Client** | Runs in the browser, captures DOM snapshots, executes commands (click, type, query), and renders annotation overlays. | WebSocket `/ws` → Gateway |
| **Gateway** | The central bridge. Exposes tools to AI agents via stdio MCP (solo) or HTTP MCP (team), stores events, and routes commands/events between agents and browser/plugin peers. | stdio or HTTP-MCP ↔ AI Agent, WebSocket ↔ Peers |

**Data flow:** Bundler transforms source → Browser renders instrumented DOM → Runtime captures state → Gateway relays to AI Agent → Agent sends commands back through the same path.

## Supported Environments

| Environment | Version | Status |
|-------------|---------|--------|
| Vite + React | 5.x – 7.x | ✅ Stable (`@harness-fe/vite`) |
| Webpack + React | 5.x | ✅ Stable (`@harness-fe/webpack`) |
| Vite + Vue 3 | 5.x – 7.x | ✅ Stable |
| Webpack + Vue 3 | 5.x | ✅ Stable |
| Next.js (App + Pages Router) | 13+ | ✅ Stable (`@harness-fe/next` + `@harness-fe/react-jsx`) |
| Any React toolchain (Remix, Astro, Turbopack, …) | React 17+ | ✅ Stable via `@harness-fe/react-jsx` jsxImportSource |

## Getting Started

> **In a hurry?** Jump to the 90-second [Quickstart](./docs/quickstart.md).

### Prerequisites

- **Node.js** >= 20
- **pnpm** >= 8 (recommended), npm >= 9, or yarn >= 1.22

### Installation

**pnpm** (recommended):
```bash
pnpm add -D @harness-fe/vite @harness-fe/runtime
```

**npm:**
```bash
npm install -D @harness-fe/vite @harness-fe/runtime
```

**yarn:**
```bash
yarn add -D @harness-fe/vite @harness-fe/runtime
```

### Which path are you on?

| You are… | Use | Auth | Setup |
|---|---|---|---|
| **Solo dev** — one app, local | `@harness-fe/cli mcp` over stdio (auto-spawns shared gateway) | none (loopback trusted) | Quick start below + `npx @harness-fe/skill install` |
| **A team** — many apps sharing one gateway | `harness --governed` (token + RBAC + project→agent binding) | scoped token per agent | [Team / governed mode](./docs/gateway-team-mode.md) |

Whichever path: **install the skill first** (`npx @harness-fe/skill install`) so your agent knows how to use harness-fe without you spelling out each tool. See [docs/agent-setup.md](./docs/agent-setup.md).

### Quick start — Vite + React (6 steps)

1. **Install packages**:
   ```bash
   pnpm add -D @harness-fe/vite @harness-fe/runtime
   ```

2. **Configure Vite** — add the plugin to your `vite.config.ts`:
   ```typescript
   import { defineConfig } from 'vite';
   import react from '@vitejs/plugin-react';
   import { harnessFE } from '@harness-fe/vite';
   export default defineConfig({ plugins: [react(), harnessFE()] });
   ```

3. **Install the agent skill** *(recommended — do this first)* — teach your agent how to drive harness-fe so you don't have to hand-hold it:
   ```bash
   npx @harness-fe/skill install      # auto-detects Claude Code / Cursor / Kiro
   ```
   The skill drops a curated playbook (mental model + tool catalog + decision flows) into your IDE. Your agent then knows *which* tool to reach for from a plain-English bug report — **you describe the problem, it drives the app.**

4. **Wire the MCP server** — add harness-fe to your agent's `.mcp.json` (solo / local — no token, trusted on loopback):
   ```jsonc
   {
     "mcpServers": {
       "harness-fe": {
         "type": "stdio",
         "command": "npx",
         "args": ["-y", "@harness-fe/cli", "mcp"]
       }
     }
   }
   ```
   `harness mcp` auto-spawns a shared gateway on `127.0.0.1:47729` and proxies MCP traffic to it. Multiple IDE windows share the same gateway automatically. Sharing across a team? Use **[governed mode](./docs/gateway-team-mode.md)** instead. Phone / second-machine debugging: [docs/lan-mode.md](docs/lan-mode.md).

5. **Start your dev server** — `pnpm dev`.

6. **Describe a problem to your agent** — *"the increment button does nothing"* — and it uses the skill + tools to inspect console/network, locate the source (`file:line`), fix, and verify. The agent that built it never leaves.

> **Adopting in legacy Vue projects?** See [docs/vue2-compat.md](docs/vue2-compat.md)
> — the plugin will never break your build, but you may want to dry-run
> first to see which files miss out on source-aware tagging.

> **Embedding in Electron / Tauri / multi-window hosts?** See
> [docs/electron.md](docs/electron.md) for how to make every renderer
> share one sessionId so the agent gets a unified cross-window timeline.

### Quick start — Next.js (App or Pages Router)

For Next.js the recommended path is **plugin-less** (via `react-jsx` for source tagging + `next` for SSR session continuity). Two file touches.

1. **Install**:
   ```bash
   pnpm add -D @harness-fe/next @harness-fe/react-jsx @harness-fe/runtime @harness-fe/node-runtime
   ```

2. **`tsconfig.json`** — enable the source-tag JSX runtime:
   ```jsonc
   { "compilerOptions": { "jsxImportSource": "@harness-fe/react-jsx" } }
   ```

3. **`next.config.mjs`** — wrap with `withHarness()`:
   ```ts
   import { withHarness } from '@harness-fe/next/config';
   export default withHarness({/* …your config… */}, { projectId: 'my-app' });
   ```

4. **`app/layout.tsx`** — drop in the Server Component (yes, no `'use client'` needed):
   ```tsx
   import { HarnessScript } from '@harness-fe/next';
   import { getCurrentUser } from '@/lib/auth';
   export default async function RootLayout({ children }) {
       const user = await getCurrentUser().catch(() => null);
       return (
           <html><body>
               <HarnessScript
                   projectId="my-app"
                   userId={user?.id}
                   buildId={process.env.NEXT_PUBLIC_GIT_SHA}
               />
               {children}
           </body></html>
       );
   }
   ```

5. **`pnpm dev`**. Two `peer connected` lines should show in the gateway log per refresh — one `role=node-runtime`, one `role=runtime-client`, **same sessionId**.

### Optional — structured logs with `@harness-fe/log`

For explicit logs (instead of relying on auto-captured `console.*`), use the isomorphic logger. Same import works in Server Components, Route Handlers, Server Actions, and Client Components — events from both server and client land in the same session timeline.

```bash
pnpm add @harness-fe/log
```

```tsx
import { log } from '@harness-fe/log';

// Anywhere — Server Component, Route Handler, Client Component, shared util
log.info('Cart loaded', { items: items.length });
log.scope('checkout').warn('Stripe latency high', { ms: latency });
log.error('Webhook failed', err);
```

Agents can ask "show me all `log.warn(...)` in this session" because `log` events are tagged `app-log` — distinct from auto-captured `server-log` / browser `console`. See [`packages/log/README.md`](./packages/log/README.md) for details.

### User feedback (in-page overlay)

When the runtime loads in dev a discreet "H" mark appears bottom-right. Clicking opens the info card. From there users can:

- **Copy snapshot** — markdown block with project / build / session / tab / url ready to paste to an agent.
- **Report a problem** — picks an element → `snapdom` captures it with 32 px context → user draws arrows + text → flattened PNG ships as part of a `task.submit` event. Vision-capable agents read the annotations directly off the pixels.
- **My reports** — list of this visitor's tasks across all sessions: status, agent's resolution note, inline edit, copy-for-agent, delete with two-click confirm.

## Packages

| Package | Description |
|---------|-------------|
| [`@harness-fe/protocol`](./packages/protocol) | Shared types, Zod schemas, message + wire definitions |
| [`@harness-fe/core`](./packages/core) | **Core library** — WS bridge, event store, recording/replay, caller identity + per-project tenant isolation. No HTTP server; gateway owns all transports. |
| [`@harness-fe/gateway`](./packages/gateway) | **Gateway** — MCP (stdio + HTTP, per-session), `/ws` for browser runtime, `/console` back-office, `/admin` for governed mode. Embeds `core` in-process. |
| [`@harness-fe/cli`](./packages/cli) | **`harness` CLI** — solo (`harness mcp`: auto-spawn shared gateway + stdio proxy), serve (headless shared gateway), governed (`harness --governed`: RBAC + tokens + audit) |
| [`@harness-fe/console-ui`](./packages/console-ui) | React SPA served at `/console` — session browser, replay viewer, governance panel (tokens / servers / audit) |
| [`@harness-fe/sandbox`](./packages/sandbox) | Standalone browser sandbox + interceptor lib (`fetch` / `xhr` / `ws` / `storage` / `navigation` / `globals` / `indexeddb` / `console` / `errors`). Used by `@harness-fe/runtime`; also consumable directly |
| [`@harness-fe/runtime`](./packages/runtime-client) | Browser SDK — capture(via `@harness-fe/sandbox`), rrweb, overlay, "Report a problem", "My reports" |
| [`@harness-fe/node-runtime`](./packages/node-runtime) | Node SDK — Server Component / Route Handler / uncaught error capture. Dual transport: WS in Node runtime, HTTP-batch in Edge runtime |
| [`@harness-fe/next`](./packages/next) | Next.js integration — `<HarnessScript>` server component, `withHarness()` next-config wrapper |
| [`@harness-fe/log`](./packages/log) | Isomorphic structured logger — same `log.info/warn/error` works in Server Components, Route Handlers, and Client Components; same `sessionId` everywhere |
| [`@harness-fe/react-jsx`](./packages/react-jsx) | `jsxImportSource` runtime — source-aware tagging for ANY React toolchain, no bundler plugin needed |
| [`@harness-fe/vite`](./packages/vite-plugin) | Vite plugin |
| [`@harness-fe/webpack`](./packages/webpack-plugin) | Webpack plugin |
| [`@harness-fe/unplugin`](./packages/unplugin) | Core unplugin (shared by all bundler plugins) |
| [`@harness-fe/skill`](./packages/agent-skill) | ⭐ **Start here** — curated agent playbook; `npx @harness-fe/skill install` into Claude Code / Cursor / Kiro so the agent knows how to use harness-fe without you spelling out each tool |

## Documentation

- [**VISION.md**](./VISION.md) — Why this project exists; the three deployment directions that drive the roadmap
- [**docs/agent-setup.md**](./docs/agent-setup.md) — ⭐ Connect your agent: install the skill first, then wire `.mcp.json` (solo or governed)
- [**docs/gateway-team-mode.md**](./docs/gateway-team-mode.md) — Share one gateway across a team: governed mode, scope RBAC, project→agent binding, audit
- [**ARCHITECTURE.md**](./ARCHITECTURE.md) — Package responsibilities, data flow diagrams, sessionId resolution chain, and protocol reference
- [**docs/architecture/sandbox.md**](./docs/architecture/sandbox.md) — The `@harness-fe/sandbox` lib (browser API patching + interceptor middleware) — design + safety contract + 9-channel matrix
- [**ROADMAP.md**](./ROADMAP.md) — Milestones, organised by mission direction
- [**docs/troubleshooting.md**](./docs/troubleshooting.md) — Events not showing? sessionId mismatch? Where do timeline files live? Start here
- [**CONTRIBUTING.md**](./CONTRIBUTING.md) — Development setup, commit conventions, and PR process

## License

[MIT](./LICENSE) © 2026 MorphixAI
