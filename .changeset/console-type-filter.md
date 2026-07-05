---
"@harness-fe/gateway": patch
---

fix(gateway): pass `?type=` through to the session timeline query (#179)

`GET /console/api/sessions/:id` only ever read the `timeline` (count) query param — `type` was silently dropped even though `store.tail()`'s `TailOptions.type` has supported single/array type filtering since it was introduced. Dashboard clients can now narrow a session's timeline to specific event types via `?type=network,console,error` (comma-separated).
