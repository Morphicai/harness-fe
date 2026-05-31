# @harness-fe/vite

> Vite plugin for [Harness-FE](https://github.com/Morphicai/harness-fe) — _the agent that built it never leaves._

Source-aware transform + runtime injection + MCP bridge for Vite projects. Tags every JSX element with `data-morphix-loc` / `data-morphix-comp` so AI agents can map any UI element back to a file:line:column.

## Install

```bash
pnpm add -D @harness-fe/vite @harness-fe/runtime
```

## Usage

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { harnessFE } from '@harness-fe/vite';

export default defineConfig({
    plugins: [react(), harnessFE()],
});
```

The plugin auto-disables in production builds — zero overhead in your shipped bundle.

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `projectId` | `string` | auto (package name) | Stable id this app reports under. **Fix it in team mode** so the app shows up as a distinct project in the shared daemon — required for [project→agent binding](https://github.com/Morphicai/harness-fe/blob/main/docs/gateway-team-mode.md#project-agent-binding) |
| `mcpUrl` | `string` | `ws://127.0.0.1:47729` | Daemon WebSocket URL the runtime connects to. Point at a shared central daemon in team mode (or set `HARNESS_FE_URL`) |
| `token` | `string` | — | Auth token for the daemon WS (or `HARNESS_FE_TOKEN`). Needed when the central daemon runs with `--token` |
| `parentProjectId` | `string` | — | Host project id for a sub-app / micro-frontend (host owner sees the sub-app's data) |
| `include` | `FilterPattern` | `/\.(jsx?\|tsx?\|vue)$/` | Files to transform |
| `exclude` | `FilterPattern` | `/node_modules/` | Files to skip |
| `wsPort` | `number` | `47729` | Daemon WebSocket port (legacy; `mcpUrl` takes precedence) |

> **Solo vs team:** with no `mcpUrl`/`token` the runtime connects to a loopback daemon (zero config). In **team mode** set `projectId` + `mcpUrl` (+ `token`) so many apps report into one shared daemon as distinct projects. See [gateway-team-mode.md](https://github.com/Morphicai/harness-fe/blob/main/docs/gateway-team-mode.md).

## Docs

- [Root README](https://github.com/Morphicai/harness-fe#readme) — quick start, all packages
- [Architecture](https://github.com/Morphicai/harness-fe/blob/main/ARCHITECTURE.md) — how the layers fit together

## License

MIT
