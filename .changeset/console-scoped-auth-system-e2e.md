---
"@harness-fe/gateway": minor
---

Console data API: scope by the caller's identity, and add a system-acceptance e2e.

- **Scoped `/console/api/*`** — the data face now resolves a principal and filters
  by it: an **agent token** sees only the projects it's bound to (read scope
  required; write-only → 403), an **admin session** sees everything, solo (Open)
  sees all, and a Governed request with no credential is rejected (401). Sessions
  outside a token's projects return 404 (no existence leak). The admin session
  cookie is now `Path=/` so it also authenticates the console data API;
  `createAdminHandler` returns `{ handle, isAuthed }`.
- **`system.e2e.test.ts`** — one governed gateway + in-process core exercised
  through real clients across every surface, so a green run means the product
  wires up without a manual demo: MCP (agentA drives, agentB read-only denied,
  no-token 401, audited), `/ws` upload (a write-token runtime's event lands in
  the store), `/console` (token-scoped vs admin-all vs 401), and `/admin` API
  gating.
