---
'@harnessa-fe/mcp-server': patch
---

Fix: visiting `/dashboard/?token=…` rendered a blank page because the SPA
bundle (loaded via `<script src="/dashboard/assets/index-XXX.js">` —
without the token query) hit 401 and never executed.

The dashboard handler now does a one-hop token handoff: when a request
arrives with `?token=…` but no `harnessa_fe_token` cookie, the response
is a 302 with `Set-Cookie: harnessa_fe_token=…; Path=/; SameSite=Lax`
and a clean Location. From that point every same-origin request (SPA
assets, `/api/*`, WS upgrade) carries the cookie automatically.

The redirect also normalizes `/dashboard` → `/dashboard/` in the same
hop, so a typical first-load chain is a single redirect rather than two.

No behavior change for users already authenticated via cookie, header,
or query — the handoff only fires once per session.
