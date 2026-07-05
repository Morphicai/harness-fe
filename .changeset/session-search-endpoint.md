---
"@harness-fe/gateway": patch
---

feat(gateway): wire keyword search (`?q=`) into the session timeline endpoint

`GET /console/api/sessions/:id` only ever called `store.tail()`. `store.search()` — full-history substring match, already used by the `session.search` MCP tool — was never reachable from the dashboard. Adding `?q=` now branches to `search()` (composable with the existing `?type=` filter, AND semantics). `search()` streams forward and returns its first N matches (oldest-biased, by design — shared code, not changed here); the route requests a generous limit and slices to the last N so the dashboard sees the most recent matches first, matching `tail()`'s convention, without touching `search()`'s own streaming/ordering.
