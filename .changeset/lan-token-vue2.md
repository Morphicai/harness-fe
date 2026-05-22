---
'@harnessa-fe/mcp-server': minor
'@harnessa-fe/protocol': minor
'@harnessa-fe/unplugin': minor
'@harnessa-fe/vite': minor
'@harnessa-fe/webpack': minor
---

LAN-friendly daemon with token auth, MCP-over-HTTP transport, and Vue 2
syntax hardening.

**Daemon (`@harnessa-fe/mcp-server`)**

- New CLI flags: `--host`, `--port`, `--token [value|auto]`,
  `--mcp-transport <stdio|http>`, `--mcp-path`, `--public-host`. Matching
  env vars: `HARNESSA_FE_HOST`, `HARNESSA_FE_TOKEN`, etc.
- Refuses to bind a non-loopback host without `--token` to prevent
  accidental LAN exposure of console / network / DOM recordings.
- Token auth is enforced once at the bridge HTTP/WS edge, so the
  dashboard, replay viewer, events handler, and MCP HTTP transport all
  share the same gate. Browsers get an HTML login form; agents/CLIs use
  `Authorization: Bearer`. Cookie, query, and WS subprotocol carriers
  are also accepted.
- MCP-over-HTTP transport via `StreamableHTTPServerTransport`, mounted
  on the bridge HTTP server at `--mcp-path` (default `/mcp`). Lets a
  remote Claude Code / Cursor share one daemon with the dev machine.
- `npx @harnessa-fe/mcp-server` now works (shebang fixed, postbuild
  chmod, `engines.node >= 18`).

**Protocol (`@harnessa-fe/protocol`)**

- Added `DEFAULT_HOST`, `isLoopbackHost`, `buildWsUrl`, `buildHttpUrl`.

**Plugin (`@harnessa-fe/unplugin` + vite/webpack wrappers)**

- `HarnessaFEOptions.token` — appended to the daemon WS URL and threaded
  through `__HARNESSA_FE__` so the runtime client connects under LAN
  mode.
- `HarnessaFEOptions.safeMode` (default `true`) — Vue SFC transform
  now strict-downgrades on `compiler-sfc` errors, wraps walk in
  try/catch, and re-parses its own output. Legacy Vue 2 syntax (filters,
  `<template functional>`, …) is silently skipped instead of risking a
  corrupt template fed downstream.
- `HARNESSA_FE_DRY_RUN=1` builds without injecting, then prints a
  coverage report (files attempted/injected, skip counts, first 20
  skipped paths) on process exit. Use it to scope adoption in legacy
  Vue projects.

See `docs/lan-mode.md` and `docs/vue2-compat.md` for the developer
guides.
