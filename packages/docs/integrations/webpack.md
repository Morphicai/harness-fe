# Webpack / Rspack / Other bundlers

## Webpack 5

```bash
pnpm add -D @harness-fe/webpack @harness-fe/runtime
```

```js [webpack.config.js]
const { HarnessFEPlugin } = require('@harness-fe/webpack');

module.exports = {
  plugins: [
    new HarnessFEPlugin({ projectId: 'my-app' }),
  ],
};
```

## Rspack / esbuild / Rollup

Use the universal unplugin:

```bash
pnpm add -D @harness-fe/unplugin @harness-fe/runtime
```

```js
// rspack.config.js
const { harnessFEUnplugin } = require('@harness-fe/unplugin');

module.exports = {
  plugins: [harnessFEUnplugin.rspack({ projectId: 'my-app' })],
};
```

## No bundler plugin (jsxImportSource only)

Any React 17+ project can get source-aware element tagging without touching the bundler:

```jsonc [tsconfig.json]
{
  "compilerOptions": {
    "jsxImportSource": "@harness-fe/react-jsx"
  }
}
```

This gives you `data-morphix-loc` / `data-morphix-comp` on every element. You'll still need `@harness-fe/runtime` wired up separately for event capture.
