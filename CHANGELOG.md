# Changelog

All notable changes to this project will be documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added — Storage hardening (unbounded-growth defense)

Empirically measured (10 pages × 30s on react-demo): 87 KB/min growth, of which 86% is rrweb recording. Without active retention enforcement that's ~860 MB after a week, ~6 GB per month — manual `session.purge` was the *only* trim path. Three new defenses landed:

- **Auto-purge scheduler in `Bridge`** — by default runs `store.purge()` once at startup and every hour thereafter. Errors are caught + logged, never crash the daemon. The interval timer is `unref()`'d so it doesn't keep Node alive. Opt-out via `new Bridge({ autoPurge: { enabled: false } })` or `HARNESSA_FE_PURGE_DISABLED=1` env var; configurable via `autoPurge.intervalMs` / `autoPurge.policy`.
- **Per-event size limit** — `JsonlStore.append()` / `appendBatch()` drop and log any event whose JSON encoding exceeds 256 KB. Prevents one `console.log(window)` from filling a timeline with megabytes per row.
- **Per-rrweb-chunk size limit** — `JsonlStore.appendRecording()` drops chunks larger than 2 MB. Tolerates the largest legitimate full-snapshots while catching misbehaving recorders.

Integration test (`bridge.test.ts`) seeds 10 sessions on a real `JsonlStore`, fires up `Bridge` with `autoPurge.policy: { maxAgeDays: 0 }`, asserts disk usage actually decreases.

## [0.2.0] — 2026-05-19

### Added — Narrative refactor: parent project + iframe identity + buildId

Foundation for micro-frontend debugging. Detailed plan in `/Users/admin/.claude/plans/delegated-seeking-tiger.md`.

- **Project tree as a first-class concept.** `ProjectMeta` extended with `parentProjectId`, `displayName`, `tags`, `metadata`. Bridge upserts these on every `HelloFrame`. Cycle detection at write time.
- **`BuildMeta`** — new persisted record (`{projectId}/builds/{buildId}/meta.json`) identifying a source-code snapshot. Captures `gitSha`, `gitDirty`, `bundler`, `nodeVersion`, `sourceDigest`. Plugin computes a stable `buildId` per dev-server start (git sha → CI env → config-file hash fallback).
- **Same-origin iframe identity inheritance** (`tryInheritFromParent`). When a runtime client boots inside a same-origin iframe, it reads `window.parent.__harnessa_fe_client__` + `__hfe_session_id__` + `__HARNESSA_FE__.projectId` so parent + child apps share the same `tabId` / `sessionId` and the child reports `parentProjectId`. Cross-origin SecurityError caught silently → child falls back to its own identity.
- **Protocol additions.** `HelloFrame` carries `parentProjectId` / `displayName` / `buildId` / `sessionId` (renamed from `loadId`; legacy field still accepted via `normalizeHelloFrame`). `EventFrame` stamps `sessionId` + `buildId` for downstream cross-cutting queries.
- **New MCP tools** for the project tree:
  - `project.list` — full `ProjectMeta[]`
  - `project.get` — single project
  - `project.tree(rootId?)` — assembled forest from parent links
  - `project.set_parent` — set/clear with cycle rejection
  - `build.list` / `build.get` — builds of a project
- **New runtime export**: `tryInheritFromParent` (in `parent-inherit.ts`, kept rrweb-free so unit tests can import without happy-dom CJS/ESM friction).

### Added — earlier in this release window

- **Webpack + Vue 3 build-pipeline integration** — Vue SFC `<template>` tagging now works under `vue-loader` by intercepting its `*.vue?vue&type=template` virtual sub-module. Element line numbers are translated back to the original `.vue` file via `<template>` block offset. New example: `examples/webpack5-vue3-demo/`.
- `transformVueTemplate`, `resolveVueComponentName`, `getTemplateLineOffset` exported from `@harnessa-fe/unplugin` for direct use by custom bundler integrations.
- Build-pipeline e2e smoke for the webpack+vue3 demo (`pnpm --filter harnessa-fe-webpack5-vue3-demo e2e`).
- Build + runtime e2e for the Vite+Vue 3 demo (`pnpm --filter harnessa-fe-vue-demo e2e`). Confirms `data-morphix-*` tagging on rendered Vue DOM, `defineOptions({ name })` propagation, and live WebSocket connection to MCP via headless Chromium.

### Changed

- **URL-based config** — replaced the `HARNESSA_FE_HOST` + `HARNESSA_FE_PORT` env-var pair with a single `HARNESSA_FE_URL` (default `ws://127.0.0.1:47729`). One env var, one resolution path for both the daemon and the plugins/runtimes. New `parseWsUrl()` + `DEFAULT_WS_URL` exports in `@harnessa-fe/protocol`. No backwards compatibility — local data and configs are wipeable at this stage.
- **`loadId` field fully removed** from the protocol; renamed to `sessionId` everywhere on the wire (`HelloFrame`, `EventFrame`, `pageLoadPayloadSchema`, `Task`). Bridge's compat shim removed.

### Docs

- `ARCHITECTURE.md` rewritten to reflect the v0.2 narrative model (project tree, builds, sessions, iframe inheritance, URL config, IStore migration path).
- Each example demo (`react-demo`, `vue-demo`, `webpack-demo`, `webpack5-vue3-demo`) ships a brief README explaining what it shows, how to run it, and how to verify via e2e.

### Known limitations (deferred to a follow-up minor)

- Cross-project session timeline tools (`session.timeline` / `tab.timeline` / `project.timeline` / `build.timeline`) are planned but not in this release. Today, agent code must call `session.tail` per (project, session). The data model now supports them — the implementation is a future scan-and-merge over disk events.
- Folder layout reversal (`sessions/` at top of store dir, projects mixed by row-level tag) is deferred. Existing per-project layout still works; the refactor stays additive.
- `examples/iframe-demo/` end-to-end fixture is planned but not landed.

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
