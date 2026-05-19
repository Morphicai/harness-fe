# Changelog

All notable changes to this project will be documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Webpack + Vue 3 build-pipeline integration** — Vue SFC `<template>` tagging now works under `vue-loader` by intercepting its `*.vue?vue&type=template` virtual sub-module. Element line numbers are translated back to the original `.vue` file via `<template>` block offset. New example: `examples/webpack5-vue3-demo/`.
- `transformVueTemplate`, `resolveVueComponentName`, `getTemplateLineOffset` exported from `@harnessa-fe/unplugin` for direct use by custom bundler integrations.
- Build-pipeline e2e smoke for the webpack+vue3 demo (`pnpm --filter harnessa-fe-webpack5-vue3-demo e2e`).
- Build + runtime e2e for the Vite+Vue 3 demo (`pnpm --filter harnessa-fe-vue-demo e2e`). Confirms `data-morphix-*` tagging on rendered Vue DOM, `defineOptions({ name })` propagation, and live WebSocket connection to MCP via headless Chromium.

### Promoted to Stable

- **Vite + Vue 3** — full SFC support (template tagging + component-name resolution from `defineOptions` / `export default { name }` / filename / parent dir). Verified end-to-end via headless Chromium e2e: 13+ tagged DOM elements, runtime client registers, WebSocket connects to MCP.
- **Webpack + React** — same `EntryPlugin` fix that landed for Webpack+Vue 3 makes the runtime client load in any webpack project; React's `data-morphix-*` JSX tagging was already correct, but the in-page runtime now actually boots.
- **Webpack + Vue 3** — both the build-pipeline integration above and the runtime injection fix together.

### Changed

- **Webpack runtime client is now bundled into the user's main entry chunk** via `webpack.EntryPlugin`. The previous bare-specifier `<script src="@harnessa-fe/runtime">` injection 404'd in browsers; runtime now auto-loads with `bundle.js` and registers `window.__harnessa_fe_client__`. End-to-end browser ↔ MCP connection works in webpack mode. New e2e: `examples/webpack5-vue3-demo/e2e/runtime.e2e.ts` (headless Chromium asserts DOM tagging + WS open).

## [0.1.0] — 2026-05-18

First public release on npm.

### Added

- **Source-aware build transform** — `data-morphix-loc` / `data-morphix-comp` attributes injected into every JSX element (`@harnessa-fe/unplugin`)
- **Vite plugin** — stable for React on Vite 5–7 (`@harnessa-fe/vite`)
- **Webpack plugin** — beta for React on Webpack 5 (`@harnessa-fe/webpack`)
- **Browser runtime client** — console / network / error capture, rrweb session recording, annotation overlay, page command execution (`@harnessa-fe/runtime`)
- **MCP server daemon** — stdio MCP bridge for AI agents (Claude, Cursor, Kiro) + WebSocket bridge for plugin/runtime peers + JSONL persistence in `~/.harnessa/` (`@harnessa-fe/mcp-server`)
- **Shared protocol** — wire-format types and Zod schemas (`@harnessa-fe/protocol`)
- **Session replay** — `session.replay.create` plus rrweb chunk slice tools
- **Source intelligence** — `project.source`, `project.where_is`, `project.module_graph` so agents can resolve DOM nodes back to source files
- **Point-and-task annotation** — in-page overlay lets humans pin a task to a UI element for the agent to pick up

### Known limitations

- Vue 3 SFC transform is incomplete (basic template tagging only)
- Webpack plugin is beta — fast-refresh edge cases may drop the WebSocket
- Wire format (`PROTOCOL_VERSION`) is not yet frozen — pin exact versions in production

[0.1.0]: https://github.com/Morphicai/harnessa-fe/releases/tag/v0.1.0
