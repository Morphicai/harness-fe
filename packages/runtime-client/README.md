# @harnessa-fe/runtime

> Browser runtime client for [Harnessa-FE](https://github.com/morphixai/harnessa-fe). Captures DOM/console/network events and executes commands from the MCP server in the user's real browser tab.

Auto-injected by the [Vite plugin](https://www.npmjs.com/package/@harnessa-fe/vite) / [Webpack plugin](https://www.npmjs.com/package/@harnessa-fe/webpack) — you typically install it as a peer of the plugin.

## Install

```bash
pnpm add -D @harnessa-fe/runtime
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
import { RuntimeClient } from '@harnessa-fe/runtime';

const client = new RuntimeClient({
    projectId: 'my-app',
    wsUrl: 'ws://localhost:47729',
});
client.start();
```

## Docs

- [Root README](https://github.com/morphixai/harnessa-fe#readme)
- [Architecture](https://github.com/morphixai/harnessa-fe/blob/main/ARCHITECTURE.md)

## License

MIT
