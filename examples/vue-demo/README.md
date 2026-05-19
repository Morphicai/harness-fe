# `vue-demo`

Vite + Vue 3 demo. Promoted to **stable** in v0.2.

## What it shows

- `<template>` element tagging in `.vue` SFCs via `@vue/compiler-dom`
- Component-name resolution from `defineOptions({ name })` / `export default { name }` / filename
- Runtime client booting inside a Vue app, connecting to the daemon, and serving agent commands

## Run

```bash
pnpm install
pnpm --filter harnessa-fe-vue-demo dev   # http://localhost:5174
```

## Verify

```bash
pnpm --filter harnessa-fe-vue-demo e2e
```

Two scripts:

- `build.e2e.ts` — runs `vite build`, asserts the bundle carries 8+ tagged locations with file-relative line numbers and `data-morphix-comp="App"` (proves `defineOptions` was honored)
- `runtime.e2e.ts` — headless Chromium loads the dev page, asserts: 13+ tagged DOM elements visible, `window.__harnessa_fe_client__` registered, WebSocket to MCP daemon `OPEN`

## Source of truth

- App: `src/App.vue` (defines `App` / `CounterValue` / `IncrementBtn` / `EchoInput` / `EchoDisplay` components)
- Vite config: `vite.config.ts`
- E2E: `e2e/{build,runtime}.e2e.ts`
