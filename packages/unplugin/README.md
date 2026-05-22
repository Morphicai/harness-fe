# @harness-fe/unplugin

> Unified build plugin core for [Harness-FE](https://github.com/Morphicai/harness-fe). Powers the Vite, Rspack, esbuild, and Rollup adapters.

You normally do **not** install this directly — install the bundler-specific package instead:

- [`@harness-fe/vite`](https://www.npmjs.com/package/@harness-fe/vite)
- [`@harness-fe/webpack`](https://www.npmjs.com/package/@harness-fe/webpack) — **native** webpack plugin (not a unplugin adapter). Required for thread-loader compatibility.

## Install (advanced)

```bash
pnpm add -D @harness-fe/unplugin
```

## Usage

```ts
import { harnessFE } from '@harness-fe/unplugin/vite';
// or '/rspack' '/esbuild' '/rollup'
```

**Webpack users**: install `@harness-fe/webpack` instead. The `./webpack` subpath export has been removed because unplugin's webpack adapter serializes the plugin instance into loader options, which breaks `thread-loader` (the plugin holds a `compiler` reference and JSON.stringify trips on `Compiler.root`). See the changeset for details.

For custom integrations, import the raw factory:

```ts
import { unplugin, unpluginFactory } from '@harness-fe/unplugin';
```

## Public API

- `unplugin` — pre-built unplugin instance (call `.vite()` / `.rspack()` / etc.)
- `unpluginFactory` — raw factory for fully custom adapters
- `transformJsx` — JSX/TSX source transform with location attribute injection
- `transformVueSFC` / `transformVueTemplate` — Vue SFC + template transforms
- `createMcpClient`, `installNodeLogCapture`, `createBuildIdentity`, `appendTokenQuery` — internal building blocks used by `@harness-fe/webpack` to assemble a native plugin without going through unplugin's webpack adapter

## Docs

- [Root README](https://github.com/Morphicai/harness-fe#readme)
- [Architecture](https://github.com/Morphicai/harness-fe/blob/main/ARCHITECTURE.md)

## License

MIT
