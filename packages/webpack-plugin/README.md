# @harnessa-fe/webpack

> Webpack plugin for [Harnessa-FE](https://github.com/Morphicai/harnessa-fe) — the frontend harness for AI agents.

Source-aware transform + runtime injection + MCP bridge for Webpack projects. Tags every JSX element with `data-morphix-loc` / `data-morphix-comp` so AI agents can map any UI element back to a file:line:column.

> **Status:** in progress. Stable for React + Webpack 5. Vue support coming.

## Install

```bash
pnpm add -D @harnessa-fe/webpack @harnessa-fe/runtime
```

## Usage

```js
// webpack.config.js
const { harnessaFE } = require('@harnessa-fe/webpack');

module.exports = {
    plugins: [harnessaFE()],
};
```

ESM:

```ts
import { harnessaFE } from '@harnessa-fe/webpack';

export default {
    plugins: [harnessaFE()],
};
```

The plugin auto-disables in production builds — zero overhead in your shipped bundle.

## Options

Same as [`@harnessa-fe/vite`](https://www.npmjs.com/package/@harnessa-fe/vite). All bundler-specific plugins share the same option surface via the underlying `unplugin`.

## Docs

- [Root README](https://github.com/Morphicai/harnessa-fe#readme)
- [Architecture](https://github.com/Morphicai/harnessa-fe/blob/main/ARCHITECTURE.md)

## License

MIT
