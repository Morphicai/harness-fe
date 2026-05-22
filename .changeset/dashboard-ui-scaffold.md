---
'@harnessa-fe/dashboard-ui': minor
---

First publish: scaffold of the React SPA that will replace the legacy
server-rendered dashboard in `@harnessa-fe/mcp-server`. Ships with Vite +
React 18 + Tailwind 3 and a Linear-style dark palette. No real routes
yet — the project list and live session detail land in follow-up PRs.

Built artifact ships at `dist/`, ~50 KB gzipped. End users don't install
this package directly; mcp-server resolves it as a workspace dep at
runtime and serves the static files under `/dashboard/`.
