# @harness-fe/dashboard-ui

## 0.3.0-next.0

### Minor Changes

- dbaf5ad: Version observability — surface the running version in both the dashboard and
  the in-page overlay, so you can tell at a glance which build is live.

  - **daemon** exposes `GET /api/meta` → `{ daemonVersion, protocolVersion }`
    (read from its own package.json at module load).
  - **dashboard-ui** header shows a `v<daemonVersion>` badge (protocol version on
    hover).
  - **runtime** overlay info card gains a `version` row showing the injected
    runtime's real version.
  - **Fix:** the runtime's `VERSION` was a hand-maintained constant stuck at
    `3.3.0` while the package was `4.0.0-next.x`. It is now generated from
    package.json at build time (`scripts/gen-version.mjs` → `src/version.ts`), so
    it can never drift again.

  Additive only — no behaviour change for existing callers.

## 0.2.0

### Minor Changes

- 88e41a2: Wire up the React SPA dashboard end-to-end (PR C of A-E).

  ### `@harness-fe/dashboard-ui`

  - Real routes — `ProjectList` (`/`) and `SessionDetail` (`/sessions/:id`) — replacing the placeholder hero
  - Glass header with a live-pill indicator that flashes green on each `dashboard.update`
  - Tab/recording/timeline/exports panels matching the legacy HTML dashboard's information density, in a Linear-style dark layout
  - Inline "Create replay" buttons that POST to `/api/sessions/:id/replay` and reveal a link to `/replay/:exportId`
  - `useApi` / `useLiveBridge` hooks: GET wrapper with token auth + singleton WS subscriber with backoff reconnect
  - ~64 KB gzip total bundle

  ### `@harness-fe/mcp-server`

  - New `dashboardSpa.ts` handler — serves the SPA at `/dashboard/*` from `@harness-fe/dashboard-ui/dist`. Hashed assets get long-lived immutable cache; `index.html` is `no-store`. Path traversal blocked
  - WS subscriber registry: clients sending `hello { role: 'dashboard-client' }` get added to `dashboardSubscribers` and receive `dashboard.update` frames
  - Broadcast hooks at `upsertSession` (new/update), `closeSession`, `appendRecording` (debounced 200ms per session), and `writeExport` (via API callback)
  - `notifyDashboard()` public method so future code paths can push their own update kinds

  ### `@harness-fe/protocol`

  - New peer role `dashboard-client`
  - New `dashboardUpdateFrameSchema` carrying `{ kind, sessionId?, projectId?, ts }`
  - `frameSchema` discriminated union extended

  Old `/` and `/sessions/:id` HTML routes remain in place during this PR;
  the redirect + legacy deletion lands in PR D.

- 7d3f830: First publish: scaffold of the React SPA that will replace the legacy
  server-rendered dashboard in `@harness-fe/mcp-server`. Ships with Vite +
  React 18 + Tailwind 3 and a Linear-style dark palette. No real routes
  yet — the project list and live session detail land in follow-up PRs.

  Built artifact ships at `dist/`, ~50 KB gzipped. End users don't install
  this package directly; mcp-server resolves it as a workspace dep at
  runtime and serves the static files under `/dashboard/`.
