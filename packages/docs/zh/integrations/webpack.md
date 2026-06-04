# Webpack / Rspack / 其他打包器

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

用通用 unplugin:

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

## 不用打包器插件(仅 jsxImportSource)

任何 React 17+ 项目都可以不动打包器拿到源码感知的元素标记:

```jsonc [tsconfig.json]
{
  "compilerOptions": {
    "jsxImportSource": "@harness-fe/react-jsx"
  }
}
```

这给每个元素带上 `data-morphix-loc` / `data-morphix-comp`。但事件捕获仍需单独接入 `@harness-fe/runtime`。
