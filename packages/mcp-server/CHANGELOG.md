# @harnessa-fe/mcp-server

## 3.0.0

### Minor Changes

- 9e70d1e: Cut over from the legacy server-rendered dashboard to the React SPA.

  - `GET /` now 302-redirects into `/dashboard/?token=…` (preserves token)
  - `GET /sessions/:id` 302-redirects to `/dashboard/sessions/:id?token=…` so old bookmarks keep working
  - Legacy `dashboard.ts` module deleted (332 lines of inlined HTML). All
    data correctness it covered is now exercised by `dashboardApi.test.ts`
    (JSON shapes) and `dashboardSpa.test.ts` (routing + caching)

  Visitors hitting the daemon root land in the SPA. No new endpoints, no
  breaking changes to the JSON API or WS subscription introduced in PR C.

- 541cbba: Add a JSON API under `/api/*` for the upcoming React SPA dashboard.

  Routes:

  - `GET /api/projects` — projects with their 10 most recent sessions inline
  - `GET /api/sessions?projectId=&tabId=&buildId=&limit=` — sessions list with optional filters
  - `GET /api/sessions/:id` — session detail (meta + summary + chunks + timeline tail + exports)
  - `POST /api/sessions/:id/replay` — create a replay export (same logic as the form POST; returns JSON instead of a 302)

  Routes are chained ahead of the legacy HTML dashboard handler so `/api/*`
  never falls into the HTML 404 page. Non-`/api/*` paths still hit the
  existing handlers unchanged. Auth (token) is enforced upstream in
  `bridge.ts` as before.

  No user-facing change yet — the React SPA that consumes this lands in
  the next PR.

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

### Patch Changes

- a7d8c96: Fix: visiting `/dashboard/?token=…` rendered a blank page because the SPA
  bundle (loaded via `<script src="/dashboard/assets/index-XXX.js">` —
  without the token query) hit 401 and never executed.

  The dashboard handler now does a one-hop token handoff: when a request
  arrives with `?token=…` but no `harnessa_fe_token` cookie, the response
  is a 302 with `Set-Cookie: harnessa_fe_token=…; Path=/; SameSite=Lax`
  and a clean Location. From that point every same-origin request (SPA
  assets, `/api/*`, WS upgrade) carries the cookie automatically.

  The redirect also normalizes `/dashboard` → `/dashboard/` in the same
  hop, so a typical first-load chain is a single redirect rather than two.

  No behavior change for users already authenticated via cookie, header,
  or query — the handoff only fires once per session.

- Updated dependencies [65f2b96]
- Updated dependencies [88e41a2]
- Updated dependencies [7d3f830]
- Updated dependencies [10d669c]
  - @harnessa-fe/protocol@3.0.0
  - @harnessa-fe/dashboard-ui@0.2.0

## 2.1.0

### Patch Changes

- 09c3da4: Add a self-hosted Docker image (`morphixai/harnessa-fe`) for teams
  who want to run the daemon on a shared dev VM instead of `npx` on each
  laptop. Multi-arch (amd64 + arm64), publishes automatically on every
  mcp-server release.

  Container defaults differ from `npx`: `HARNESSA_FE_HOST=0.0.0.0`,
  `HARNESSA_FE_MCP_TRANSPORT=http`, and `HOME=/data` so the volume mount
  captures all persistence. Token (`HARNESSA_FE_TOKEN`) is still required.

  See [docs/docker.md](https://github.com/Morphicai/harnessa-fe/blob/main/docs/docker.md)
  for the full guide and [examples/docker/docker-compose.example.yml](https://github.com/Morphicai/harnessa-fe/blob/main/examples/docker/docker-compose.example.yml)
  for a reference compose file.

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

### Patch Changes

- Updated dependencies [5d02bbf]
  - @harnessa-fe/protocol@2.0.0

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

- Updated dependencies [74be490]
  - @harnessa-fe/protocol@1.0.2

## 1.0.0

### Minor Changes

- 2019214: Version alignment: reset `@harnessa-fe/log` and `@harnessa-fe/next` to the 0.9.x line, locking all core packages together via `linked` in `.changeset/config.json`

  Background: `@harnessa-fe/log`'s initial Changesets minor bump took it to **1.0.0** (Changesets treats brand-new packages as starting at 1.0.0 unless explicitly minor-bumped from a prior 0.x), then the next minor pushed it to 2.0.0 — leaving the rest of the ecosystem at 0.6–0.9 while `log` and `next` (which transitively bumped) sat at 2.0. Functionally fine, but cosmetically off.

  Since morphicai-web is the only consumer and hasn't shipped publicly, accepting the inconvenience of a version downgrade is cheap. The previous `log@{1.0.0, 2.0.0, 2.0.1}` and `next@{1.0.0, 2.0.0}` releases will be deprecated on npmjs.com pointing to 0.9.x as the canonical line.

  This changeset bumps **every** core package by `minor` so they all land at the same 0.x.0 going forward, plus locks them via `linked` so future bumps stay in lockstep. Also includes the Turbopack-fix browser/node split for `@harnessa-fe/log` that was previously queued as a patch.

### Patch Changes

- Updated dependencies [2019214]
  - @harnessa-fe/protocol@1.0.0

## 0.7.2

### Patch Changes

- 0cd04d9: feat(log): new `@harnessa-fe/log` isomorphic logger package

  Introduces `@harnessa-fe/log` — a zero-config structured logger that works
  identically in Server Components, Route Handlers, Server Actions, Client
  Components, and shared utilities.

  - `log.info('msg', { meta })` from any environment lands in
    `~/.harnessa/data/sessions/{sid}/timeline.jsonl` as `t: 'app-log'`
  - Session identity is resolved fresh on every call (via React `cache()` /
    AsyncLocalStorage) — no cross-request contamination possible
  - No userId in payload — agents resolve user via `sessionId → visitor` lookup
  - Scope chaining: `log.scope('a').scope('b')` emits `scope='a.b'`
  - Silent on missing runtime (optional peer deps on node-runtime and runtime)

  **@harnessa-fe/node-runtime**: adds `reportAppLog()` method + `AppLogContext`
  type for the new explicit log path (distinct from auto-captured console).

  **@harnessa-fe/mcp-server**: adds `EventType = 'app-log'`, bridge now writes
  `t: 'app-log'` rows for `app.log` frames (previously would have stored `t:
'app.log'` — now consistent with `server-log` / `server-err` naming), and
  the dashboard renders app-log events with a distinct soft-purple tag.

## 0.7.1

### Patch Changes

- ff8cc7d: Fix: bridge now stamps `visitorId` on every event row

  Pre-fix, `~/.harnessa/data/sessions/{sid}/timeline.jsonl` rows carried `projectId` and `buildId` but not `visitorId`, even though the bridge knew the visitor identity from the peer's hello frame. As a result, agents could read the visitor's metadata (firstSeenAt / sessionCount / tabIds) and could enumerate the visitor's sessions via `visitor.journey`, but couldn't filter a single session's timeline rows to events from one specific visitor — important when the same session has parent + iframe child apps with separate visitors.

  The bridge now stamps `visitorId` from `frame.visitorId ?? peer.visitorId` on every `appendEvent` call. `StoreEvent.visitorId` is the new optional field.

## 0.7.0

### Minor Changes

- c4a1f59: feat: Edge Runtime HTTP transport (Phase 1)

  - `@harnessa-fe/protocol`: add `httpBatchSchema` / `HttpBatch` for stateless POST /events
  - `@harnessa-fe/mcp-server`: new `POST /events` + `GET /events/ping` HTTP endpoints; `Bridge.handleHttpBatch()` routes batches into the same session timeline as the WebSocket path
  - `@harnessa-fe/node-runtime`: `Transport` interface + `WsTransport` (existing behaviour) + `HttpBatchTransport` (fetch-based, 500ms flush, 50-event batching, 5xx retry, outbox cap); automatic selection via `NEXT_RUNTIME=edge` / `HARNESSA_FE_TRANSPORT=http`; `ws` moved to optional peer dependency; new `./auto-edge` export
  - `@harnessa-fe/next`: webpack plugin injects `@harnessa-fe/node-runtime/auto-edge` into edge-runtime bundles (webworker target)

### Patch Changes

- c4a1f59: chore: remove pre-1.0 read-compat shims (Phase 2)

  **Breaking change for on-disk data older than v0.4:**

  - Removed `LegacyBuildSessionMeta` and `LegacyLoadMeta` types
  - Removed `TailOptions.loadId` and `SearchOptions.loadId` deprecated fields
  - Removed `_detectLegacyLayout()` — replaced by per-chunk stderr warning when a recording chunk lacks `chunkId`
  - Removed 8 `load: loadId` double-stamp fields from bridge event rows

  If you have on-disk data from a daemon older than v0.4, run `rm -rf ~/.harnessa/data` to start fresh.

- Updated dependencies [c4a1f59]
  - @harnessa-fe/protocol@0.7.0
