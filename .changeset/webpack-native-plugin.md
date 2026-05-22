---
'@harnessa-fe/webpack': minor
'@harnessa-fe/unplugin': minor
---

`@harnessa-fe/webpack` is now a native webpack plugin. The
`@harnessa-fe/unplugin/webpack` subpath export is removed.

API surface is unchanged — `harnessaFE()` still takes the same options and
returns a plugin instance you can drop into `plugins: [...]`. The package
just stops going through unplugin's webpack adapter under the hood.

### Why

unplugin's webpack adapter passes the plugin instance through a loader's
`options` field. The plugin instance closes over `compiler` (via the
`webpack(compiler)` hook), and `compiler.root` self-references the compiler.
JSON.stringify chokes on the cycle, which crashes any project that uses
**thread-loader** anywhere in the resolved loader chain.

This bites Vue 2 + TypeScript projects in particular: vue-loader inlines
the user's `.ts` rule loaders for `<script lang="ts">` virtual sub-modules,
so even projects that never put thread-loader on `.vue` directly end up
with `[thread-loader, harnessa-loader]` chains and crash with:

```
Converting circular structure to JSON
  --> starting at object with constructor 'Compiler'
  |   property 'root' closes the circle
```

### What changed

- `@harnessa-fe/webpack` is now a hand-written webpack plugin with an
  independent loader file whose options are pure JSON-serializable data.
  Worker processes forward collected component locations back to the main
  process via `module.buildMeta.harnessaCollected`, which the main-process
  plugin aggregates in `compilation.succeedModule`.
- `@harnessa-fe/unplugin` removes the `./webpack` subpath export.
  Importing it directly will fail at resolve time. Vite / Rspack / esbuild
  / Rollup adapters are unchanged.

### Migration

If you previously imported from `@harnessa-fe/unplugin/webpack`:

```diff
- import { harnessaFE } from '@harnessa-fe/unplugin/webpack'
+ import { harnessaFE } from '@harnessa-fe/webpack'
```

The call signature is identical. Any code already using
`@harnessa-fe/webpack` directly just needs the dep bump — no source change.
