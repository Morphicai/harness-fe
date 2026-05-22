---
'@harnessa-fe/mcp-server': minor
---

Add a JSON API under `/api/*` for the upcoming React SPA dashboard.

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
