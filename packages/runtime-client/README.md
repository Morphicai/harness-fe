<p align="center">
  <img src="https://raw.githubusercontent.com/Morphicai/harness-fe/main/branding/logo.svg" alt="Harness-FE" width="96" />
</p>

# @harness-fe/runtime

> Browser runtime client for [Harness-FE](https://github.com/Morphicai/harness-fe). Captures DOM/console/network events and executes commands from the MCP server in the user's real browser tab.

Auto-injected by the [Vite plugin](https://www.npmjs.com/package/@harness-fe/vite) / [Webpack plugin](https://www.npmjs.com/package/@harness-fe/webpack) — you typically install it as a peer of the plugin.

## Install

```bash
pnpm add -D @harness-fe/runtime
```

## What it does

- Connects to the MCP server via WebSocket on dev page load
- Streams `console.*`, `fetch`/`XHR`, `window.error`, `unhandledrejection` events
- Captures rrweb session recordings for replay
- Executes commands (`page.click`, `page.type`, `page.dom_query`, etc.)
- Renders the annotation overlay (point-and-task)

Disabled automatically in production builds.

## Manual usage (advanced)

For non-Vite/Webpack setups:

```ts
import { RuntimeClient } from '@harness-fe/runtime';

const client = new RuntimeClient({
    projectId: 'my-app',
    wsUrl: 'ws://localhost:47729',
});
client.start();
```

## Docs

- [Root README](https://github.com/Morphicai/harness-fe#readme)
- [Architecture](https://github.com/Morphicai/harness-fe/blob/main/ARCHITECTURE.md)

## License

MIT
