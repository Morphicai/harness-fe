<p align="center">
  <img src="branding/logo.svg" alt="Harness-FE" width="200" />
</p>

<h1 align="center">Harness-FE</h1>

<p align="center">
  <strong>The agent that built it never leaves.</strong>
</p>

<p align="center">
  A source-aware harness for every AI-built app — source-mapped build plugins, an MCP daemon, and a runtime client that let the agent keep watching, listening, and fixing the app long after it ships.
</p>

<p align="center">
  <em>Every AI-coded app should ship with the runtime that keeps it bonded to the agent that built it.</em> — see <a href="./VISION.md">VISION.md</a>
</p>

<p align="center">
  <a href="https://github.com/Morphicai/harness-fe/actions/workflows/ci.yml"><img src="https://github.com/Morphicai/harness-fe/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://www.npmjs.com/package/@harness-fe/mcp-server"><img src="https://img.shields.io/npm/v/@harness-fe/mcp-server?label=mcp-server&color=4f46e5" alt="npm @harness-fe/mcp-server" /></a>
  <a href="https://www.npmjs.com/package/@harness-fe/vite"><img src="https://img.shields.io/npm/v/@harness-fe/vite?label=vite&color=10b981" alt="npm @harness-fe/vite" /></a>
  <a href="https://www.npmjs.com/package/@harness-fe/next"><img src="https://img.shields.io/npm/v/@harness-fe/next?label=next&color=fb7185" alt="npm @harness-fe/next" /></a>
  <a href="https://www.npmjs.com/package/@harness-fe/mcp-server"><img src="https://img.shields.io/npm/dm/@harness-fe/mcp-server?label=downloads&color=64748b" alt="npm downloads" /></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%E2%89%A520-3c873a" alt="Node ≥ 20" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT" /></a>
  <a href="./CONTRIBUTING.md"><img src="https://img.shields.io/badge/PRs-welcome-fbbf24" alt="PRs welcome" /></a>
</p>

---

## Features

- **Source-Aware Instrumentation** — Injects `data-morphix-loc` and `data-morphix-comp` attributes into JSX / Vue elements (via build plugin OR `@harness-fe/react-jsx` `jsxImportSource`), giving AI agents precise file:line:column references for every UI element.
- **MCP Server Bridge** — A stdio-based MCP daemon that connects AI agents (Claude, Cursor, Kiro) to browser + server runtimes via WebSocket / HTTP, enabling bidirectional command/event communication and a unified timeline per page-load.
- **Browser Runtime + Overlay** — A lightweight browser SDK that captures console / network / errors / DOM (rrweb), exposes an in-page "H" overlay so users can file annotated screenshots (arrow + text on a snapdom-captured PNG), and surfaces a "My reports" view to manage their submissions. The overlay is **extensible** — add custom action buttons via `registerOverlayPlugin` to send the current scene/logs to your own system (issue tracker, Slack, webhook). See [docs/overlay-plugins.md](./docs/overlay-plugins.md).
- **Server-Side Capture (Next.js)** — `@harness-fe/node-runtime` collects Server Component errors, Route Handler / Server Action durations, and uncaught Node exceptions. `<HarnessScript>` is a Server Component that uses React `cache()` to bind the **same sessionId** across SSR and the client runtime — one refresh = one `sessions/{id}/timeline.jsonl`.
- **Edge Runtime Compatible** — When Next emits an Edge worker bundle the SDK auto-switches to an HTTP-batch transport (`POST /events` on the daemon) so Cloudflare Workers / Vercel Edge routes flow into the same daemon as Node routes.
- **Visitor Identity** — Anonymous, stable per-browser identifier (`localStorage`) + optional `userId` from the app's auth layer. Lets agents build a real user journey across refreshes, tabs, and same-origin iframes.
- **Annotated Feedback Loop** — Users file tasks through the overlay; the screenshot's arrow + text annotations are flattened into the PNG so vision models read the annotations directly off pixels. Agents fetch the image via `tasks_get_attachment` as a native MCP image-content block.
- **Multi-Bundler & Multi-Framework** — Stable on Vite + React, Webpack + React, Vite/Webpack + Vue 3, Next.js (App + Pages Router, webpack + Turbopack). Any React 17+ toolchain via `@harness-fe/react-jsx` `jsxImportSource`.
- **Zero Production Overhead** — All instrumentation, WebSocket / HTTP connections, the overlay, and the Node SDK are gated behind `NODE_ENV === 'development'`.

## How It Works

Harness-FE uses a three-layer architecture to connect AI agents with your running application:

```mermaid
graph LR
    Agent["🤖 AI Agent<br/>(Claude / Kiro)"]
    MCP["⚡ MCP Server<br/>(Daemon)"]
    Plugin["🔧 Build Plugin<br/>(Vite / Webpack)"]
    Runtime["🌐 Runtime Client<br/>(Browser)"]

    Agent <-->|stdio| MCP
    MCP <-->|WebSocket| Plugin
    MCP <-->|WebSocket| Runtime
```

| Layer | Role | Communication |
|-------|------|---------------|
| **Build Plugin** | Transforms source files at dev-time, injecting location and component metadata into JSX/Vue templates. Sends HMR and error events to the MCP server. | WebSocket → MCP Server |
| **Runtime Client** | Runs in the browser, captures DOM snapshots, executes commands (click, type, query), and renders annotation overlays. | WebSocket → MCP Server |
| **MCP Server** | The central bridge. Exposes tools to AI agents via stdio MCP protocol and routes commands/events between agents and browser/plugin peers. | stdio ↔ AI Agent, WebSocket ↔ Peers |

**Data flow:** Bundler transforms source → Browser renders instrumented DOM → Runtime captures state → MCP Server relays to AI Agent → Agent sends commands back through the same path.

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

### Quick start — Vite + React (5 steps)

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

3. **Start the MCP server** — `npx @harness-fe/mcp-server`
   - Local-only by default. For phone / second-machine debugging:
     `npx @harness-fe/mcp-server --host 0.0.0.0 --token auto`
     ([details](docs/lan-mode.md))
   - Hosting it for a team on a shared dev VM?
     `morphixai/harness-fe:latest` ([Docker guide](docs/docker.md))
4. **Start your dev server** — `pnpm dev`
5. **Connect your AI agent** — register the MCP server in your AI tool (Claude Code, Cursor, Kiro). The agent now sees and drives your running app.

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

5. **Run the daemon** + **`pnpm dev`**. Two `peer connected` lines should show in the daemon log per refresh — one `role=node-runtime`, one `role=runtime-client`, **same sessionId**.

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
| [`@harness-fe/mcp-server`](./packages/mcp-server) | MCP daemon — WS bridge + HTTP `POST /events` for Edge + dashboard + replay viewer |
| [`@harness-fe/sandbox`](./packages/sandbox) | Standalone browser sandbox + interceptor lib (`fetch` / `xhr` / `ws` / `storage` / `navigation` / `globals` / `indexeddb` / `console` / `errors`). Used by `@harness-fe/runtime`; also consumable directly |
| [`@harness-fe/runtime`](./packages/runtime-client) | Browser SDK — capture(via `@harness-fe/sandbox`), rrweb, overlay, "Report a problem", "My reports" |
| [`@harness-fe/node-runtime`](./packages/node-runtime) | Node SDK — Server Component / Route Handler / uncaught error capture. Dual transport: WS in Node runtime, HTTP-batch in Edge runtime |
| [`@harness-fe/next`](./packages/next) | Next.js integration — `<HarnessScript>` server component, `withHarness()` next-config wrapper |
| [`@harness-fe/log`](./packages/log) | Isomorphic structured logger — same `log.info/warn/error` works in Server Components, Route Handlers, and Client Components; same `sessionId` everywhere |
| [`@harness-fe/react-jsx`](./packages/react-jsx) | `jsxImportSource` runtime — source-aware tagging for ANY React toolchain, no bundler plugin needed |
| [`@harness-fe/vite`](./packages/vite-plugin) | Vite plugin |
| [`@harness-fe/webpack`](./packages/webpack-plugin) | Webpack plugin |
| [`@harness-fe/unplugin`](./packages/unplugin) | Core unplugin (shared by all bundler plugins) |
| [`@harness-fe/skill`](./packages/agent-skill) | Curated agent playbook — install into Claude Code / Cursor / Kiro to teach the agent how to use harness-fe |

## Documentation

- [**VISION.md**](./VISION.md) — Why this project exists; the three deployment directions that drive the roadmap
- [**ARCHITECTURE.md**](./ARCHITECTURE.md) — Package responsibilities, data flow diagrams, sessionId resolution chain, and protocol reference
- [**docs/architecture/sandbox.md**](./docs/architecture/sandbox.md) — The `@harness-fe/sandbox` lib (browser API patching + interceptor middleware) — design + safety contract + 9-channel matrix
- [**ROADMAP.md**](./ROADMAP.md) — Milestones, organised by mission direction
- [**docs/troubleshooting.md**](./docs/troubleshooting.md) — Events not showing? sessionId mismatch? Where do timeline files live? Start here
- [**CONTRIBUTING.md**](./CONTRIBUTING.md) — Development setup, commit conventions, and PR process

## License

[MIT](./LICENSE) © 2026 MorphixAI
