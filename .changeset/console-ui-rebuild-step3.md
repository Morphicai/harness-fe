---
"@harness-fe/console-ui": minor
---

Rebuild ③ — introduce `@harness-fe/console-ui`, the React SPA the gateway serves
at `/console`.

A single SPA with two faces:
- **Data face** — projects + their recent sessions, a session timeline view
  (summary + tail events), and a version/policy badge, backed by the gateway's
  capability JSON API (`/console/api/*`).
- **Governance face** — sign in + tokens / servers / audit, backed by the
  gateway's `/admin/api/*` (cookie session). Creating a token shows its secret
  once; tokens can be revoked.

Built with Vite + Tailwind (base `/console/`). The gateway serves its `dist`
via the `consoleDir` option / `--console-dir` flag. Supersedes the old
`dashboard-ui` (retired in the final step).
