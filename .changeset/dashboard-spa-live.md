---
'@harnessa-fe/dashboard-ui': minor
'@harnessa-fe/mcp-server': minor
'@harnessa-fe/protocol': patch
---

Wire up the React SPA dashboard end-to-end (PR C of A-E).

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
