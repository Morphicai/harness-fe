# `webpack5-vue3-demo`

Webpack 5 + `vue-loader` + Vue 3 demo. Promoted to **stable** in v0.2.

## What it shows

The trickiest combination: `vue-loader` splits an SFC into virtual sub-modules (`App.vue?vue&type=template`, …) and re-reads from disk for each one, which would normally drop our pre-loader transform. Harness intercepts the `*.vue?vue&type=template` sub-module specifically, tags the bare template HTML, then lets `vue-loader`'s `templateLoader` compile it into a render function with the attributes preserved.

Other invariants verified by the e2e:

- Element line numbers stay file-relative (offset by the `<template>` block position in the SFC)
- Runtime is bundled into the main chunk via `webpack.EntryPlugin` and boots automatically
- WebSocket connection to the MCP daemon succeeds without manual config

## Run

```bash
pnpm install
pnpm --filter harness-fe-webpack5-vue3-demo dev   # http://localhost:3002
```

## Verify

```bash
pnpm --filter harness-fe-webpack5-vue3-demo e2e
```

Two scripts:

- `build.e2e.ts` — runs `webpack`, asserts 12+ `data-morphix-loc` occurrences across the produced bundle with line numbers ≥ 10 (proves file-relative offset works)
- `runtime.e2e.ts` — spins up `webpack-dev-server` on a random port, launches headless Chromium, asserts 15+ tagged DOM elements + `window.__harness_fe_client__` registered + WebSocket OPEN

## Source of truth

- Apps: `src/App.vue`, `src/Counter.vue`
- webpack config: `webpack.config.cjs` (CJS because the demo `package.json` is ESM)
- E2E: `e2e/{build,runtime}.e2e.ts`
