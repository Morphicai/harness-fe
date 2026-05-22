---
'@harnessa-fe/mcp-server': minor
'@harnessa-fe/protocol': patch
---

Add MCP tool `dashboard.open` so agents can surface the dev dashboard
to the human user.

The tool returns the dashboard URL (with token pre-populated when auth
is configured) and optionally launches the user's default browser via
`open` (macOS) / `xdg-open` (Linux) / `cmd /c start ""` (Windows). Set
`HARNESSA_FE_HEADLESS=1` to suppress browser-launch attempts in remote
or Docker contexts.

A `sessionId` argument deep-links into `/dashboard/sessions/:id` so
agents can point users at a specific recording.

### What's new
- `protocol`: `COMMAND.DASHBOARD_OPEN = 'dashboard.open'`
- `mcp-server`:
  - new `openBrowser.ts` — cross-platform launcher with dependency-injection seams for unit testing
  - new `dashboardUrl.ts` — pure URL composer (handles token, session deep-link, missing port)
  - `IBridge.getAuthToken()` getter so the URL composer can read the configured token without reaching into private fields
  - tool registration in `mcp.ts`

13 new unit tests pin the cross-platform spawn behavior and URL shape.
