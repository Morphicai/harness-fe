# Changelog

All notable changes to this project will be documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

### Changed — release flow uses Changesets

Switched version management and publishing from manual lockstep bumps to
[Changesets](https://github.com/changesets/changesets). Day-to-day flow:

1. In your feature PR run `pnpm changeset` to declare which packages
   changed at what semver level. Commit the generated `.changeset/*.md`.
2. Merge the PR. The release workflow on `main` opens (or updates) a
   "chore(release): version packages" PR with the pending bumps.
3. Review and merge that PR. The workflow then runs publish — the
   hybrid OIDC + token strategy is preserved via
   `scripts/release-publish.sh`.

Per-package versions are now allowed to drift (e.g. `@harness-fe/protocol`
can stay on 0.6.x while `@harness-fe/runtime` jumps to 0.8.x). Existing
0.6.2 versions are the migration baseline; future bumps are
changeset-driven.

## [0.6.2] — 2026-05-20

### Fixed — `@harness-fe/node-runtime` first publish

0.6.1 published 9 of 10 tarballs. `@harness-fe/node-runtime` failed pass 2 because the old `NPM_TOKEN` lacked org-level "create new packages" permission. Token replaced with one scoped `Read and write` on `@harness-fe` org. No code change.

## [0.6.1] — 2026-05-20

### Fixed — CI hybrid publish unblocks the three stuck tarballs

v0.6.0 released 6 of 10 tarballs to npm. Three failed PUT with E404:
- `@harness-fe/next` and `@harness-fe/react-jsx` — have trusted publisher configured on npmjs.com, which rejects token PUT.
- `@harness-fe/node-runtime` — brand-new package, no trusted publisher, token couldn't create it through the same single-auth path.

The release workflow now publishes in **two passes**:
1. **OIDC** (no token in env) — works for trusted-publisher packages.
2. **NPM_TOKEN** — picks up whatever pass 1 didn't.

Flipping a package's trusted-publisher config on npmjs.com auto-routes it between modes. No code change inside the published packages.

## [0.6.0] — 2026-05-20

### Added — annotated screenshots travel with every task

Reporting a problem now opens an **annotation step** between picking an element and writing the question. The overlay captures the locked element (plus 32 px context margin) with **`@zumer/snapdom`** (SVG-first capture, font-crisp), drops the user into a fullscreen canvas modal with `↗ Arrow / T Text / ↩ Undo / Done` and five color swatches, and **flattens** the user's strokes back into the PNG before submitting. Vision-capable agents (Claude / GPT-4V) read the annotations directly off the pixels — no parallel structured-annotation stream is sent (it would be redundant).

Wire:
- `Task` and `TaskSubmitPayload` gain `attachments?: TaskAttachment[]`. On the wire, `data` is base64. After daemon-side write, it's stripped and replaced with `path`.
- Daemon writes binary to `~/.harness/data/projects/{projectId}/task-attachments/{taskId}/{attachmentId}.png`. tasks.json stays small (JSON-only).
- 4 MB cap per task, applied across all attachments. Oversized writes are dropped with a stderr warning.
- New MCP tool **`tasks_get_attachment({ taskId, attachmentId })`** returns the image as an MCP image-content block (`{ type: 'image', mimeType: 'image/png', data: base64 }`) — the form Claude / GPT-4V consume natively.
- "My reports" view shows thumbnails inline (first attachment, base64 inlined for ≤200 KB images) + click-to-lightbox.

### Added — SSR / Node-side logs with single sessionId across server + client

Until now, anything Next.js did on the server (Server Component renders, Route Handler errors, Server Actions, uncaught process exceptions) was invisible to the daemon. v0.6.0 ships a Node SDK and stitches server-side events into the **same** `sessions/{sessionId}/timeline.jsonl` as the client-side runtime for the same refresh.

How it works:
- **`<HarnessScript>` is now a Server Component** that uses React `cache()` to allocate one stable per-request sessionId, then renders an inline `<script>` setting `window.__HARNESS_FE_SEED__.sessionId` before any client code runs. The boot logic moved to a sibling `<HarnessScriptClient>` (`'use client'`).
- **`RuntimeClient` adopts the server seed** via `tryAdoptServerSeed()` before falling back to `generateSessionId()`. Inheritance order: parent-iframe seed → server seed → fresh generation.
- **New package `@harness-fe/node-runtime`** loadable from Next's `instrumentation.ts`. Exports:
  - `register(opts)` — opens WS with `role: 'node-runtime'`, installs `process.on('uncaughtException' | 'unhandledRejection')`.
  - `reportError(err, ctx?)` — explicit reporter; emits `t: 'server-err'`.
  - `reportLog(level, args, ctx?)` — explicit reporter; emits `t: 'server-log'`. Opt-in console patch via `HARNESS_FE_NODE_CONSOLE=1`.
  - `withHarnessTracing(handler)` — HOC for Route Handlers / Server Actions; times the call, catches errors, emits `t: 'server-action'`.
- **Build-time wrapper** `@harness-fe/next/config` exports `withHarness(nextConfig, opts)` — adds `experimental.instrumentationHook`, injects `@harness-fe/node-runtime/auto` into the server bundle, passes config via env vars. Zero-file alternative to writing `instrumentation.ts` by hand.
- **Bridge accepts `node-runtime` role** — joins the existing client SessionMeta when sessionIds match; orphan events go to `sessions/server-orphans/timeline.jsonl`.

Out of scope (deferred to 0.7): Edge Runtime route handlers (no Node `process` / `ws`), static `next export`, build-time pre-render orphans.

### Changed — token-only npm publish (CI)

CI's release workflow no longer pretends to support OIDC trusted publishing. The two stuck packages (`@harness-fe/next`, `@harness-fe/react-jsx`) were failing PUT-with-token because trusted-publisher config on npmjs.com rejects token auth. **Manual one-time step** required on upgrade: delete the trusted-publisher config for those two packages on npmjs.com. `id-token: write` permission stays for sigstore provenance (independent of trusted publishing).

### Protocol

- `peerRoleSchema` adds `'node-runtime'`.
- `EventType` adds `'server-log'`, `'server-err'`, `'server-action'`.
- `taskAttachmentSchema` is new; `TaskSubmitPayload.attachments?` and `Task.attachments?` are additive.

All additions are optional — old daemons and old clients interoperate gracefully.

## [0.5.0] — 2026-05-20

### Added — visitor identity + in-page "My reports"

A user submitting feedback used to be invisible — every refresh emitted a new sessionId, every tab a new tabId, and once the user clicked "Submit" the overlay forgot. This release stitches that whole story together:

- **`visitorId` — stable anonymous identifier.** Persisted in `localStorage.__hfe_visitor_id__` (per-origin, per-browser). Same-origin iframes inherit it from `window.parent` so the journey stays unified across micro-frontends. No canvas / WebGL / AudioContext fingerprinting — only an opaque UUID.
- **Optional `userId`.** `HarnessScript` gained a `userId?: string` prop so apps with auth (supabase / NextAuth / Auth0 / …) can pass the logged-in user's id through `window.__HARNESS_FE__.userId`. The daemon attaches the latest non-empty value to `VisitorMeta.userId`.
- **`VisitorEnv` snapshot on every hello.** Captures UA, language, languages, timezone, timezoneOffsetMin, screen (width/height/dpr/colorDepth), viewport, colorScheme, reducedMotion, platform. Stored under `~/.harness/data/visitors/{visitorId}/meta.json` alongside firstSeenAt / lastSeenAt / sessionCount / LRU-capped tabIds + projectIds.
- **Row-level visitor tag on events.** `EventFrame.visitorId` is stamped on every send so timeline filters / journeys can intersect without joins.
- **"📁 My reports" in the overlay.** A new view inside the existing info card (slide-in from the same FAB) lists this visitor's tasks across all their sessions: status badge (pending / claimed / resolved), question, agent's resolution note (when present), source location, submitted-X-ago. Each row supports **edit** (inline textarea — pending/claimed only), **copy** (task-specific markdown ready for an agent), and **delete** (two-click confirm for safety). Empty state guides users to "Report a problem" if they haven't filed any yet.
- **Request/reply channel `query` / `query.response`.** New protocol frame so the runtime can fetch and mutate the visitor's own data without going through MCP. Whitelisted methods: `tasks.mine`, `tasks.get`, `tasks.update`, `tasks.delete`. Server-side owner check refuses to touch tasks whose `visitorId` doesn't match the caller's.
- **MCP tools `visitor.list` / `visitor.get` / `visitor.journey`.** Agents can investigate who hit the daemon: list known visitors, fetch one visitor's full metadata + last env, and walk their journey chronologically (sessions with url / start / participants).
- **`RuntimeClient` gained accessors** `visitorId` and `userId`.

### Privacy

- Anonymous by default — `userId` is opt-in via the prop.
- `localStorage.__hfe_visitor_id__` lives per origin; clearing site data wipes it.
- The visitor record only stores what the runtime explicitly sent; the daemon never enriches with IP, server-side geolocation, or fingerprintable browser features beyond what's listed above.
- The dev-only overlay opts itself out of every common session-recording / RUM vendor (rrweb, PostHog, Sentry, Datadog, FullStory, LogRocket, Hotjar, Smartlook, Clarity, Heap) so its identifiers can't leak through someone else's pipeline. `outerHTML` snapshots also strip the `data-morphix-*` instrumentation attributes before being sent to agents — they're internal tooling artifacts, not part of the host app's JSX.

### Protocol

- `HelloFrame` adds optional `visitorId`, `userId`, `env`.
- `EventFrame` adds optional `visitorId`.
- `Task` adds optional `visitorId`, `userId`, `updatedAt`.
- Two new frame types: `query` and `query.response` (additive — old daemons / clients ignore them).
- All additions are optional; 0.4.x clients and 0.4.x daemons interoperate cleanly with this release.

### Migration

No on-disk migration needed; existing tasks without `visitorId` simply won't appear in any visitor's "My reports" (they'll still show in MCP `tasks_pending`). Existing daemons can read 0.5 client traffic and existing 0.4 clients can talk to a 0.5 daemon — both directions handle the optional fields gracefully.

## [0.4.1] — 2026-05-20

### Changed — unified in-page overlay (`@harness-fe/runtime`)

The blue "?" annotation FAB has been replaced by a single, calmer **"H" mark** in the bottom-right corner. Clicking it opens a compact info card that consolidates everything users used to have to dig through DevTools for:

- **Top bar** — project · buildId · connection status (animated green dot when daemon is reachable, amber-blinking while connecting, grey when offline)
- **Identity pills** — sessionId, tabId, buildId. Click any pill to copy that single value to the clipboard (visual confirmation: pill flashes green for ~1 s).
- **Current URL** (truncated to path) — full URL on title hover.
- **"Report a problem"** — the legacy element-picker flow, now reachable as the primary CTA inside the card. Same `task.submit` wire payload, same `selector.loc` / `selector.comp` / `selector.css` shape — no breaking change for agents.
- **"Copy snapshot"** — copies a tight markdown block (project, build, session, tab, url, time, daemon status) ready to paste into a teammate's chat or an agent prompt.

Keyboard:
- `Cmd/Ctrl + Shift + H` — toggle the card from anywhere
- `Esc` — close the card / exit the picker

The legacy `installAnnotationOverlay` export is gone; the runtime now installs `installOverlay` instead. Build/Wire/Protocol layers untouched — purely a renderer rewrite.

### Added — `RuntimeClient` accessors

`projectId`, `buildId`, `displayName`, `getConnectionState()` are now exposed on the `RuntimeClient` instance (read-only) so the overlay (and external integrations) can surface live state without reaching into private fields.

## [0.4.0] — 2026-05-20

### Changed — storage layout refactor (IStore v2)

Renamed store types and flipped the storage layout to use page-load sessions as the primary event unit:

- `LoadMeta` renamed to `SessionMeta`; old `SessionMeta` (dev-run handle) renamed to `BuildMeta`
- `IStore.openSession()` → `openBuild()`, `closeSession()` for builds → `closeBuild()`
- `IStore.openLoad()` → `upsertSession()`, `listLoads()` → `listSessions({ tabId })`
- Storage layout: flat `sessions/{sessionId}/` replaces `{projectId}/sessions/{buildId}/tabs/{tabId}/loads/{loadId}/`
- `upsertSession` dedup bug fixed: participants array was being doubled on repeated upserts
- `ensureDir` added before session timeline writes to prevent ENOENT on first write
- Dashboard project list now uses `listProjects()` (requires `upsertProject` to be called)
- Tests updated to new IStore API; grace-period tests now verify builds via `listBuilds()`

## [0.3.0] — 2026-05-20

### Changed — rrweb recordings are now isolated per pageload

Pre-0.3.0 every refresh on the same tab appended rrweb chunks to one shared `tabs/{tabId}/recording.jsonl`. Each refresh emits its own `type:4 Meta` + `type:2 FullSnapshot` baseline, so the file ended up with N baselines interleaved with N×incrementals. Replay slicing then had to guess which baseline applied to which window and frequently rendered blank.

Now `JsonlStore.appendRecording(sessionId, tabId, chunk, loadId)` takes the runtime `loadId` (the per-pageload id propagated as the `sessionId` field on `EventFrame`) and writes to `tabs/{tabId}/loads/{loadId}/recording.jsonl`. `listRecordings` / `sliceRecordings` aggregate across all load directories; the old per-tab path is still read so installs that had data on disk before the upgrade remain queryable until purge GCs it. Bridge passes `peer.sessionId` through automatically — runtime + plugins did not need to change.

Visibility:
- `[harness-fe] peer connected: role=… project=… tab=… load=…` printed once per accepted hello so "is the runtime actually talking to me?" is one log line away.
- Purge handles both legacy and per-load recording files uniformly (count / bytes caps remain per-tab, summed across its loads).

This is a storage layout change inside `~/.harness/data/` — nothing about the wire protocol or public package APIs changed, but old daemons running ≤ 0.2.5 cannot read 0.3.0's per-load directories (they will see empty `listRecordings` for new data). Upgrade the daemon to 0.3.0 alongside any consumers.

## [0.2.5] — 2026-05-19

### Added

- **`@harness-fe/next` — `HarnessScript` now accepts `buildId`.** Stamp every event with the code version (`git sha`, `NEXT_BUILD_ID`, …) so agents can answer "which build was running when this happened?". Without it the daemon still works — it just can't slice by build. Recommended source for production: `process.env.NEXT_PUBLIC_GIT_SHA` injected by your CI. Dev: leave undefined.

## [0.2.4] — 2026-05-19

### Fixed — rrweb replay sometimes rendered blank

Two independent gaps caused the very first chunk of a recording (the one carrying the `type:4` Meta + `type:2` FullSnapshot baseline) to be lost, which made every subsequent incremental snapshot useless for replay:

- **`@harness-fe/runtime` — pre-OPEN frames were silently dropped.** `RuntimeClient.send()` checked `ws.readyState !== OPEN` and returned without buffering, so any event emitted between `start()` and the WebSocket handshake completing (notably rrweb's synchronous FullSnapshot on init) hit the floor. Now buffered in a bounded FIFO outbox (500 frames / 8 MB cap) and drained right after the `hello` is sent on `open` — the daemon sees the baseline immediately after registering the peer. Also covers transient reconnects.
- **`@harness-fe/mcp-server` — replay export accepted FullSnapshot-less windows.** `createReplayExport()` produced exports that contained only `type:3` mutations when the user picked a narrow window long after page load (or any window that happened to miss the baseline chunk). The export "succeeded" but the rrweb player rendered an empty viewport. The export builder now scans for `type:2` in the window; if absent, walks back across earlier chunks for the same tab, finds the most recent baseline chunk, and prepends its events. If no baseline can be located anywhere, the export is refused with an explanatory error instead of producing a blank replay.

### Fixed — plugin-less mode silently lost events

`@harness-fe/mcp-server` `bridge.ts` previously refused `runtime-client` `hello` frames whenever no build plugin (vite / webpack) had already registered the project. That made the new `@harness-fe/next` + `jsxImportSource` integration unusable — and any production / staging deployment where the bundler plugin is absent. The gate is removed: a `runtime-client` `hello` now bootstraps its own store session (`peerRole: 'runtime-client'`) when none exists. As an observability backstop, the daemon now logs a `console.warn` the first time a connection drops an event for lack of a store session — silent data loss surfaces immediately.

## [0.2.3] — 2026-05-19

### Added

- **New package `@harness-fe/react-jsx`** — a universal `jsxImportSource` wrapper for React. Set `"jsxImportSource": "@harness-fe/react-jsx"` in tsconfig.json (or the SWC / Babel equivalent) and every JSX element gets a `data-morphix-loc="file:line:column"` attribute in dev — works in any React toolchain (Next.js, Vite, Webpack, Remix, Astro, …) without a bundler plugin. Wraps React's `jsxDEV` runtime; passes through unchanged in production builds.
- **New package `@harness-fe/next`** — Next.js integration for App Router and Pages Router. Drop `<HarnessScript projectId="my-app" />` into `app/layout.tsx`; the client component seeds `window.__HARNESS_FE__`, dynamically imports `@harness-fe/runtime`, and connects to the daemon. Works under both webpack and Turbopack, renders nothing in production.

### Changed

- **CI publish loop is now fault-tolerant** — one package failing (e.g. missing trusted-publisher config on a brand-new name) no longer blocks the rest. The workflow collects published / skipped lists, only fails when *nothing* publishes, and emits warnings for each skip so partial releases are visible at a glance.

## [0.2.2] — 2026-05-19

### Added

- **New package `@harness-fe/skill`** — a curated agent playbook (`SKILL.md`) + tiny CLI for distributing harness-fe knowledge to Claude Code, Cursor, Kiro, or any MCP-aware agent. Install with `npx @harness-fe/skill install [target]`. Covers the mental model (project / build / tab / session), MCP tool catalog with examples, source-aware selector usage, four common debugging decision flows, and safety constraints. Pure-data package — no build step, ships as `bin/*.js` + `skill/SKILL.md`.

## [0.2.1] — 2026-05-19

### Fixed

- **Release pipeline** — v0.2.0 publish failed at npm with `E404` because pnpm 9 doesn't yet exchange the workflow's OIDC id-token for an npm publish credential. Restored the granular-token flow (`NODE_AUTH_TOKEN` in the workflow env). Provenance (sigstore attestation) still attaches via `--provenance` + `NPM_CONFIG_PROVENANCE=true`. We'll revisit OIDC when pnpm 10 lands.

### Added — Storage hardening (unbounded-growth defense)

Empirically measured (10 pages × 30s on react-demo): 87 KB/min growth, of which 86% is rrweb recording. Without active retention enforcement that's ~860 MB after a week, ~6 GB per month — manual `session.purge` was the *only* trim path. Three new defenses landed:

- **Auto-purge scheduler in `Bridge`** — by default runs `store.purge()` once at startup and every hour thereafter. Errors are caught + logged, never crash the daemon. The interval timer is `unref()`'d so it doesn't keep Node alive. Opt-out via `new Bridge({ autoPurge: { enabled: false } })` or `HARNESS_FE_PURGE_DISABLED=1` env var; configurable via `autoPurge.intervalMs` / `autoPurge.policy`.
- **Per-event size limit** — `JsonlStore.append()` / `appendBatch()` drop and log any event whose JSON encoding exceeds 256 KB. Prevents one `console.log(window)` from filling a timeline with megabytes per row.
- **Per-rrweb-chunk size limit** — `JsonlStore.appendRecording()` drops chunks larger than 2 MB. Tolerates the largest legitimate full-snapshots while catching misbehaving recorders.

Integration test (`bridge.test.ts`) seeds 10 sessions on a real `JsonlStore`, fires up `Bridge` with `autoPurge.policy: { maxAgeDays: 0 }`, asserts disk usage actually decreases.

## [0.2.0] — 2026-05-19

### Added — Narrative refactor: parent project + iframe identity + buildId

Foundation for micro-frontend debugging. Detailed plan in `/Users/admin/.claude/plans/delegated-seeking-tiger.md`.

- **Project tree as a first-class concept.** `ProjectMeta` extended with `parentProjectId`, `displayName`, `tags`, `metadata`. Bridge upserts these on every `HelloFrame`. Cycle detection at write time.
- **`BuildMeta`** — new persisted record (`{projectId}/builds/{buildId}/meta.json`) identifying a source-code snapshot. Captures `gitSha`, `gitDirty`, `bundler`, `nodeVersion`, `sourceDigest`. Plugin computes a stable `buildId` per dev-server start (git sha → CI env → config-file hash fallback).
- **Same-origin iframe identity inheritance** (`tryInheritFromParent`). When a runtime client boots inside a same-origin iframe, it reads `window.parent.__harness_fe_client__` + `__hfe_session_id__` + `__HARNESS_FE__.projectId` so parent + child apps share the same `tabId` / `sessionId` and the child reports `parentProjectId`. Cross-origin SecurityError caught silently → child falls back to its own identity.
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
- `transformVueTemplate`, `resolveVueComponentName`, `getTemplateLineOffset` exported from `@harness-fe/unplugin` for direct use by custom bundler integrations.
- Build-pipeline e2e smoke for the webpack+vue3 demo (`pnpm --filter harness-fe-webpack5-vue3-demo e2e`).
- Build + runtime e2e for the Vite+Vue 3 demo (`pnpm --filter harness-fe-vue-demo e2e`). Confirms `data-morphix-*` tagging on rendered Vue DOM, `defineOptions({ name })` propagation, and live WebSocket connection to MCP via headless Chromium.

### Changed

- **URL-based config** — replaced the `HARNESS_FE_HOST` + `HARNESS_FE_PORT` env-var pair with a single `HARNESS_FE_URL` (default `ws://127.0.0.1:47729`). One env var, one resolution path for both the daemon and the plugins/runtimes. New `parseWsUrl()` + `DEFAULT_WS_URL` exports in `@harness-fe/protocol`. No backwards compatibility — local data and configs are wipeable at this stage.
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

- **Webpack runtime client is now bundled into the user's main entry chunk** via `webpack.EntryPlugin`. The previous bare-specifier `<script src="@harness-fe/runtime">` injection 404'd in browsers; runtime now auto-loads with `bundle.js` and registers `window.__harness_fe_client__`. End-to-end browser ↔ MCP connection works in webpack mode. New e2e: `examples/webpack5-vue3-demo/e2e/runtime.e2e.ts` (headless Chromium asserts DOM tagging + WS open).

## [0.1.0] — 2026-05-18

First public release on npm.

### Added

- **Source-aware build transform** — `data-morphix-loc` / `data-morphix-comp` attributes injected into every JSX element (`@harness-fe/unplugin`)
- **Vite plugin** — stable for React on Vite 5–7 (`@harness-fe/vite`)
- **Webpack plugin** — beta for React on Webpack 5 (`@harness-fe/webpack`)
- **Browser runtime client** — console / network / error capture, rrweb session recording, annotation overlay, page command execution (`@harness-fe/runtime`)
- **MCP server daemon** — stdio MCP bridge for AI agents (Claude, Cursor, Kiro) + WebSocket bridge for plugin/runtime peers + JSONL persistence in `~/.harness/` (`@harness-fe/mcp-server`)
- **Shared protocol** — wire-format types and Zod schemas (`@harness-fe/protocol`)
- **Session replay** — `session.replay.create` plus rrweb chunk slice tools
- **Source intelligence** — `project.source`, `project.where_is`, `project.module_graph` so agents can resolve DOM nodes back to source files
- **Point-and-task annotation** — in-page overlay lets humans pin a task to a UI element for the agent to pick up

### Known limitations

- Vue 3 SFC transform is incomplete (basic template tagging only)
- Webpack plugin is beta — fast-refresh edge cases may drop the WebSocket
- Wire format (`PROTOCOL_VERSION`) is not yet frozen — pin exact versions in production

[0.1.0]: https://github.com/Morphicai/harness-fe/releases/tag/v0.1.0
