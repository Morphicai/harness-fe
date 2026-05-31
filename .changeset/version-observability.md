---
'@harness-fe/core': minor
'@harness-fe/console-ui': minor
'@harness-fe/runtime': minor
---

Version observability — surface the running version in both the dashboard and
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
