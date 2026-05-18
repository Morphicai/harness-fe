# @harnessa-fe/vite

> Vite plugin for [Harnessa-FE](https://github.com/Morphicai/harnessa-fe) — the frontend harness for AI agents.

Source-aware transform + runtime injection + MCP bridge for Vite projects. Tags every JSX element with `data-morphix-loc` / `data-morphix-comp` so AI agents can map any UI element back to a file:line:column.

## Install

```bash
pnpm add -D @harnessa-fe/vite @harnessa-fe/runtime
```

## Usage

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { harnessaFE } from '@harnessa-fe/vite';

export default defineConfig({
    plugins: [react(), harnessaFE()],
});
```

The plugin auto-disables in production builds — zero overhead in your shipped bundle.

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `include` | `FilterPattern` | `/\.(jsx?\|tsx?\|vue)$/` | Files to transform |
| `exclude` | `FilterPattern` | `/node_modules/` | Files to skip |
| `wsPort` | `number` | `47729` | MCP server WebSocket port |

## Docs

- [Root README](https://github.com/Morphicai/harnessa-fe#readme) — quick start, all packages
- [Architecture](https://github.com/Morphicai/harnessa-fe/blob/main/ARCHITECTURE.md) — how the layers fit together

## License

MIT
