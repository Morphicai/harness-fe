# @harnessa-fe/protocol

## 3.0.0

### Patch Changes

- 65f2b96: Add MCP tool `dashboard.open` so agents can surface the dev dashboard
  to the human user.

  The tool returns the dashboard URL (with token pre-populated when auth
  is configured) and optionally launches the user's default browser via
  `open` (macOS) / `xdg-open` (Linux) / `cmd /c start ""` (Windows). Set
  `HARNESSA_FE_HEADLESS=1` to suppress browser-launch attempts in remote
  or Docker contexts.

  A `sessionId` argument deep-links into `/dashboard/sessions/:id` so
  agents can point users at a specific recording.

  ### What's new

  - `protocol`: `COMMAND.DASHBOARD_OPEN = 'dashboard.open'`
  - `mcp-server`:
    - new `openBrowser.ts` — cross-platform launcher with dependency-injection seams for unit testing
    - new `dashboardUrl.ts` — pure URL composer (handles token, session deep-link, missing port)
    - `IBridge.getAuthToken()` getter so the URL composer can read the configured token without reaching into private fields
    - tool registration in `mcp.ts`

  13 new unit tests pin the cross-platform spawn behavior and URL shape.

- 88e41a2: Wire up the React SPA dashboard end-to-end (PR C of A-E).

  ### `@harnessa-fe/dashboard-ui`

  - Real routes — `ProjectList` (`/`) and `SessionDetail` (`/sessions/:id`) — replacing the placeholder hero
  - Glass header with a live-pill indicator that flashes green on each `dashboard.update`
  - Tab/recording/timeline/exports panels matching the legacy HTML dashboard's information density, in a Linear-style dark layout
  - Inline "Create replay" buttons that POST to `/api/sessions/:id/replay` and reveal a link to `/replay/:exportId`
  - `useApi` / `useLiveBridge` hooks: GET wrapper with token auth + singleton WS subscriber with backoff reconnect
  - ~64 KB gzip total bundle

  ### `@harnessa-fe/mcp-server`

  - New `dashboardSpa.ts` handler — serves the SPA at `/dashboard/*` from `@harnessa-fe/dashboard-ui/dist`. Hashed assets get long-lived immutable cache; `index.html` is `no-store`. Path traversal blocked
  - WS subscriber registry: clients sending `hello { role: 'dashboard-client' }` get added to `dashboardSubscribers` and receive `dashboard.update` frames
  - Broadcast hooks at `upsertSession` (new/update), `closeSession`, `appendRecording` (debounced 200ms per session), and `writeExport` (via API callback)
  - `notifyDashboard()` public method so future code paths can push their own update kinds

  ### `@harnessa-fe/protocol`

  - New peer role `dashboard-client`
  - New `dashboardUpdateFrameSchema` carrying `{ kind, sessionId?, projectId?, ts }`
  - `frameSchema` discriminated union extended

  Old `/` and `/sessions/:id` HTML routes remain in place during this PR;
  the redirect + legacy deletion lands in PR D.

- 10d669c: Overlay UX + screenshot fixes:

  ### Draggable FAB with position persistence

  The floating "H" button can now be dragged anywhere on screen. The
  position is saved to `localStorage` (`__harnessa_fe_fab_pos__`) and
  clamped into the viewport on every load — resilient to monitor
  swaps, dev-tools panel changes, and viewport resizes. Follower cards
  (info / reports / question) anchor relative to the FAB and flip side
  based on available space, so they're always reachable no matter where
  you drop the button.

  A 5px movement threshold separates click from drag; clicking the FAB
  still opens the info card, dragging it never does.

  ### Dark, glass-style cards

  The info / reports / question panels switched to a dark theme with
  backdrop blur, matching the new dashboard SPA's Linear-style palette.
  Info pills, primary/secondary buttons, and status dots refreshed for
  contrast and clarity on both light and dark host pages.

  ### Screenshot fixes

  - **Overlay no longer bleeds into screenshots.** The "H" FAB and any
    open info card used to land in the corner of every shot. The
    `PAGE_SCREENSHOT` handler now flips `visibility: hidden` on the
    overlay host for the duration of the capture, restoring it
    (try/finally — survives capture errors) immediately after.
  - **Default to opaque background.** Captures were rendering blank for
    pages with no explicit body background. Default is now `#ffffff`;
    callers can pass `backgroundColor: '#0a0a0f'` (or any CSS color)
    for a dark backdrop, or `backgroundColor: null` to opt back into a
    transparent capture (PNG/WebP only — JPEG has no alpha).

  ### Tests

  9 new tests:

  - 4 in `overlay.test.ts` — default position, persisted restore, viewport clamp on shrink, malformed-storage fallback
  - 5 in `commands.test.ts` (new file) — default opaque background, transparent opt-in via null, custom color, overlay-hidden during capture, overlay restored on error

## 2.0.0

### Minor Changes

- 5d02bbf: LAN-friendly daemon with token auth, MCP-over-HTTP transport, and Vue 2
  syntax hardening.

  **Daemon (`@harnessa-fe/mcp-server`)**

  - New CLI flags: `--host`, `--port`, `--token [value|auto]`,
    `--mcp-transport <stdio|http>`, `--mcp-path`, `--public-host`. Matching
    env vars: `HARNESSA_FE_HOST`, `HARNESSA_FE_TOKEN`, etc.
  - Refuses to bind a non-loopback host without `--token` to prevent
    accidental LAN exposure of console / network / DOM recordings.
  - Token auth is enforced once at the bridge HTTP/WS edge, so the
    dashboard, replay viewer, events handler, and MCP HTTP transport all
    share the same gate. Browsers get an HTML login form; agents/CLIs use
    `Authorization: Bearer`. Cookie, query, and WS subprotocol carriers
    are also accepted.
  - MCP-over-HTTP transport via `StreamableHTTPServerTransport`, mounted
    on the bridge HTTP server at `--mcp-path` (default `/mcp`). Lets a
    remote Claude Code / Cursor share one daemon with the dev machine.
  - `npx @harnessa-fe/mcp-server` now works (shebang fixed, postbuild
    chmod, `engines.node >= 18`).

  **Protocol (`@harnessa-fe/protocol`)**

  - Added `DEFAULT_HOST`, `isLoopbackHost`, `buildWsUrl`, `buildHttpUrl`.

  **Plugin (`@harnessa-fe/unplugin` + vite/webpack wrappers)**

  - `HarnessaFEOptions.token` — appended to the daemon WS URL and threaded
    through `__HARNESSA_FE__` so the runtime client connects under LAN
    mode.
  - `HarnessaFEOptions.safeMode` (default `true`) — Vue SFC transform
    now strict-downgrades on `compiler-sfc` errors, wraps walk in
    try/catch, and re-parses its own output. Legacy Vue 2 syntax (filters,
    `<template functional>`, …) is silently skipped instead of risking a
    corrupt template fed downstream.
  - `HARNESSA_FE_DRY_RUN=1` builds without injecting, then prints a
    coverage report (files attempted/injected, skip counts, first 20
    skipped paths) on process exit. Use it to scope adoption in legacy
    Vue projects.

  See `docs/lan-mode.md` and `docs/vue2-compat.md` for the developer
  guides.

## 1.0.2

### Patch Changes

- 74be490: 1.0.2 — coordinated patch across the linked group

  **Functional changes:**

  - `@harnessa-fe/node-runtime` — auto-captured server-side `console.*` calls now inherit the request's `sessionId` automatically when used with `@harnessa-fe/next`. Previously they became orphans unless the handler was wrapped with `withHarnessaTracing`. Mechanism: a new `setSessionIdProvider(fn)` dependency-injection setter; the Next adapter pushes its `cache()`-backed getter in on first render. ALS still wins when populated; orphan behaviour unchanged when no adapter is loaded.
  - `@harnessa-fe/log` — node-side emit path simplified to delegate sessionId resolution to `node-runtime.getRequestSessionId()`. Same observable behaviour; less duplicated logic. Peer-dependency declarations cleaned up — the dynamic-import contract is described in the README instead.
  - `@harnessa-fe/next` — `sessionId.ts` module side-effect-registers its `cache()` getter with node-runtime via `setSessionIdProvider`. No new exports.

  **Release plumbing:**

  - Republish `@harnessa-fe/log` after the 24-hour cooldown from a prior unpublish. Defensive listing covering all 10 linked packages so the bump is genuinely lockstep.
  - `scripts/release-publish.sh` handles the npm "Cannot implicitly apply latest tag to a version lower than current latest" case by publishing under a staging tag and then explicitly moving `latest` via `npm dist-tag add`.

  **Docs (shipping with the release):**

  - New READMEs for `packages/log`, `packages/next`, `packages/node-runtime`.
  - New `VISION.md` (three nested mission directions) and `docs/troubleshooting.md`.
  - `ARCHITECTURE.md` — new section explaining server-side sessionId resolution chain (ALS → adapter provider → orphan).
  - `ROADMAP.md` reframed around the three mission directions.

## 1.0.0

### Minor Changes

- 2019214: Version alignment: reset `@harnessa-fe/log` and `@harnessa-fe/next` to the 0.9.x line, locking all core packages together via `linked` in `.changeset/config.json`

  Background: `@harnessa-fe/log`'s initial Changesets minor bump took it to **1.0.0** (Changesets treats brand-new packages as starting at 1.0.0 unless explicitly minor-bumped from a prior 0.x), then the next minor pushed it to 2.0.0 — leaving the rest of the ecosystem at 0.6–0.9 while `log` and `next` (which transitively bumped) sat at 2.0. Functionally fine, but cosmetically off.

  Since morphicai-web is the only consumer and hasn't shipped publicly, accepting the inconvenience of a version downgrade is cheap. The previous `log@{1.0.0, 2.0.0, 2.0.1}` and `next@{1.0.0, 2.0.0}` releases will be deprecated on npmjs.com pointing to 0.9.x as the canonical line.

  This changeset bumps **every** core package by `minor` so they all land at the same 0.x.0 going forward, plus locks them via `linked` so future bumps stay in lockstep. Also includes the Turbopack-fix browser/node split for `@harnessa-fe/log` that was previously queued as a patch.

## 0.7.0

### Minor Changes

- c4a1f59: feat: Edge Runtime HTTP transport (Phase 1)

  - `@harnessa-fe/protocol`: add `httpBatchSchema` / `HttpBatch` for stateless POST /events
  - `@harnessa-fe/mcp-server`: new `POST /events` + `GET /events/ping` HTTP endpoints; `Bridge.handleHttpBatch()` routes batches into the same session timeline as the WebSocket path
  - `@harnessa-fe/node-runtime`: `Transport` interface + `WsTransport` (existing behaviour) + `HttpBatchTransport` (fetch-based, 500ms flush, 50-event batching, 5xx retry, outbox cap); automatic selection via `NEXT_RUNTIME=edge` / `HARNESSA_FE_TRANSPORT=http`; `ws` moved to optional peer dependency; new `./auto-edge` export
  - `@harnessa-fe/next`: webpack plugin injects `@harnessa-fe/node-runtime/auto-edge` into edge-runtime bundles (webworker target)
