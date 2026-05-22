# @harness-fe/webpack

> Webpack plugin for [Harness-FE](https://github.com/Morphicai/harness-fe) — the frontend harness for AI agents.

Source-aware transform + runtime injection + MCP bridge for Webpack projects. Tags every JSX element with `data-morphix-loc` / `data-morphix-comp` so AI agents can map any UI element back to a file:line:column.

> **Status:** stable for React + Vue 2/3 on Webpack 5. **thread-loader compatible** as of this release.

> **Note:** This package is now a hand-written webpack plugin, not a wrapper around `unplugin.webpack`. The change is invisible to users — same import, same options — but unblocks projects that put `thread-loader` anywhere in their loader chain (typical Vue 2 + TypeScript SFC builds). See [`.changeset/webpack-native-plugin.md`](../../.changeset/webpack-native-plugin.md) for the why.

## Install

```bash
pnpm add -D @harness-fe/webpack @harness-fe/runtime
```

## Usage

```js
// webpack.config.js
const { harnessFE } = require('@harness-fe/webpack');

module.exports = {
    plugins: [harnessFE()],
};
```

ESM:

```ts
import { harnessFE } from '@harness-fe/webpack';

export default {
    plugins: [harnessFE()],
};
```

The plugin auto-disables in production builds — zero overhead in your shipped bundle.

## Options

Same as [`@harness-fe/vite`](https://www.npmjs.com/package/@harness-fe/vite). All bundler-specific plugins share the same option surface via the underlying `unplugin`.

## Docs

- [Root README](https://github.com/Morphicai/harness-fe#readme)
- [Architecture](https://github.com/Morphicai/harness-fe/blob/main/ARCHITECTURE.md)

## License

MIT
