---
"@harness-fe/gateway": minor
"@harness-fe/console-ui": minor
"@harness-fe/runtime": minor
---

Console: a real sign-in, a clean empty state, and an overlay shortcut that isn't an auth grant.

- **Sign-in entry** — the console now has a unified sign-in: an **agent read token**
  (pasted, kept in sessionStorage, sent as Bearer → scoped to the token's projects)
  or an **admin** session (sees all). Under Open (solo) no sign-in is needed.
  New `GET /console/api/whoami` reports `{ mode, authenticated, kind, projects }`
  (never 401s) so the SPA gates on it.
- **No more weird empty `/`** — a Governed viewer with no credential gets the
  sign-in screen instead of a raw 401; authenticated/Open viewers get the data.
- **Overlay = pure shortcut** — `deriveDashboardUrl` no longer appends the
  runtime token; the "open dashboard" button is plain navigation to
  `/console/sessions/:id`. The viewer authorizes in the console itself (the
  runtime's write token could never read anyway). The console credential is read
  from sessionStorage, never the URL.
