# @morphixai/harnessa-fe.unplugin

> Unified build plugin core for [Harnessa-FE](https://github.com/morphixai/harnessa-fe). Powers the Vite, Webpack, Rspack, esbuild, and Rollup adapters.

You normally do **not** install this directly — install the bundler-specific package instead:

- [`@morphixai/harnessa-fe.vite`](https://www.npmjs.com/package/@morphixai/harnessa-fe.vite)
- [`@morphixai/harnessa-fe.webpack`](https://www.npmjs.com/package/@morphixai/harnessa-fe.webpack)

## Install (advanced)

```bash
pnpm add -D @morphixai/harnessa-fe.unplugin
```

## Usage

```ts
import { harnessaFE } from '@morphixai/harnessa-fe.unplugin/vite';
// or '/webpack' '/rspack' '/esbuild' '/rollup'
```

For custom integrations, import the raw factory:

```ts
import { unplugin, unpluginFactory } from '@morphixai/harnessa-fe.unplugin';
```

## Public API

- `unplugin` — pre-built unplugin instance (call `.vite()` / `.webpack()` / etc.)
- `unpluginFactory` — raw factory for fully custom adapters
- `transformJsx` — JSX/TSX source transform with location attribute injection
- `transformVueSFC` — Vue SFC `<template>` transform

## Docs

- [Root README](https://github.com/morphixai/harnessa-fe#readme)
- [Architecture](https://github.com/morphixai/harnessa-fe/blob/main/ARCHITECTURE.md)

## License

MIT
