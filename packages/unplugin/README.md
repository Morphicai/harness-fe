# @harnessa-fe/unplugin

> Unified build plugin core for [Harnessa-FE](https://github.com/Morphicai/harnessa-fe). Powers the Vite, Rspack, esbuild, and Rollup adapters.

You normally do **not** install this directly — install the bundler-specific package instead:

- [`@harnessa-fe/vite`](https://www.npmjs.com/package/@harnessa-fe/vite)
- [`@harnessa-fe/webpack`](https://www.npmjs.com/package/@harnessa-fe/webpack) — **native** webpack plugin (not a unplugin adapter). Required for thread-loader compatibility.

## Install (advanced)

```bash
pnpm add -D @harnessa-fe/unplugin
```

## Usage

```ts
import { harnessaFE } from '@harnessa-fe/unplugin/vite';
// or '/rspack' '/esbuild' '/rollup'
```

**Webpack users**: install `@harnessa-fe/webpack` instead. The `./webpack` subpath export has been removed because unplugin's webpack adapter serializes the plugin instance into loader options, which breaks `thread-loader` (the plugin holds a `compiler` reference and JSON.stringify trips on `Compiler.root`). See the changeset for details.

For custom integrations, import the raw factory:

```ts
import { unplugin, unpluginFactory } from '@harnessa-fe/unplugin';
```

## Public API

- `unplugin` — pre-built unplugin instance (call `.vite()` / `.rspack()` / etc.)
- `unpluginFactory` — raw factory for fully custom adapters
- `transformJsx` — JSX/TSX source transform with location attribute injection
- `transformVueSFC` / `transformVueTemplate` — Vue SFC + template transforms
- `createMcpClient`, `installNodeLogCapture`, `createBuildIdentity`, `appendTokenQuery` — internal building blocks used by `@harnessa-fe/webpack` to assemble a native plugin without going through unplugin's webpack adapter

## Docs

- [Root README](https://github.com/Morphicai/harnessa-fe#readme)
- [Architecture](https://github.com/Morphicai/harnessa-fe/blob/main/ARCHITECTURE.md)

## License

MIT
