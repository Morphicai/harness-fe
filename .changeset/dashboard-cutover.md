---
'@harnessa-fe/mcp-server': minor
---

Cut over from the legacy server-rendered dashboard to the React SPA.

- `GET /` now 302-redirects into `/dashboard/?token=…` (preserves token)
- `GET /sessions/:id` 302-redirects to `/dashboard/sessions/:id?token=…` so old bookmarks keep working
- Legacy `dashboard.ts` module deleted (332 lines of inlined HTML). All
  data correctness it covered is now exercised by `dashboardApi.test.ts`
  (JSON shapes) and `dashboardSpa.test.ts` (routing + caching)

Visitors hitting the daemon root land in the SPA. No new endpoints, no
breaking changes to the JSON API or WS subscription introduced in PR C.
