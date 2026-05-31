---
"@harness-fe/console-ui": minor
"@harness-fe/gateway": minor
---

Console: revive the rich dashboard UI on the new gateway.

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
