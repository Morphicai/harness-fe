# @harness-fe/console-ui

## 4.0.0-next.6

### Patch Changes

- 46775be: Align the linked package group onto a single 4.0.0-next line.

  The gateway/console work only touched some packages, so changesets left the linked
  group split — `log`/`react-jsx` were still 3.x, `next`/`node-runtime` on older 4.0
  prereleases, while gateway/runtime/etc were at next.5. This is a version-only bump
  (no code change) so consumers (morphix, tanka) can install ONE consistent
  4.0.0-next.x set without mixing `@harness-fe/protocol` majors.

## 4.0.0-next.5

### Minor Changes

- c03d01c: Console: revive the rich dashboard UI on the new gateway.

  The console data face was a thin MVP; bring back the proven dashboard experience
  (project list, session detail with logs / timeline / rrweb replay, live-status
  header) on top of the gateway's in-process core:

  - **gateway `/console/api/*`** now serves the full data contract the dashboard
    expects — `meta`, `projects` ({project, recentSessions}), `sessions`,
    `sessions/:id` ({session, summary, chunks, timeline, exports}), and
    `POST sessions/:id/replay` (via `createReplayExport`). Reads go straight to the
    in-process store (the authenticated operator sees everything).
  - **console-ui** recovers the dashboard's `ProjectList` / `SessionDetail` /
    `Header` / hooks / styling and repoints them at `/console/api/*` and the
    gateway `/ws` (live `dashboard.update` feed). The governance face
    (tokens / servers / audit) stays as a second tab in the shared header.

  Deep links use `/console/sessions/:id` (the runtime overlay's "open dashboard"
  button + `deriveDashboardUrl` aligned). Known limitation: the live WS feed needs
  a write-scope socket, so under the Governed policy the operator console falls
  back to manual refresh (Solo gets live updates).

- 68e4785: Console: a real sign-in, a clean empty state, and an overlay shortcut that isn't an auth grant.

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

- 2fa80f1: Rebuild ③ — introduce `@harness-fe/console-ui`, the React SPA the gateway serves
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

- c7736ab: Shared auto-spawn gateway + unified console sign-in.

  - **cli**: `harness serve` (headless shared gateway) and `harness mcp` (stdio↔http proxy) subcommands; default-locate `@harness-fe/console-ui` dist so `/console` serves the real UI with no `--console-dir`.
  - **ensureSharedGateway**: a dev server (vite/unplugin and native webpack) or the mcp launcher — whoever starts first — auto-spawns one shared Open gateway; the other end reuses it. Team (explicit token) never spawns.
  - **gateway**: `startMcpStdioProxy`; removed the server-rendered `/admin` + `/admin/login` HTML pages — sign-in unified at `/console`.
  - **console-ui**: sign-in takes effect without a hard reload; governance tab admin-only.
  - **demo**: `demo.sh` reclaims a stale harness gateway instead of refusing to start.
