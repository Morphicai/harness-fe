# Harness-FE demo — one gateway, many projects

`pnpm demo` boots the whole demo on one machine, on the latest local build
(`workspace:*` packages + the `dist` that `pnpm build` produces). All dev servers
run under a single `turbo run`, so you get unified per-app live logs and one
Ctrl-C stops the lot.

The rebuilt architecture has **one front door**: a gateway with an in-process
core. Every app's in-page runtime connects to the gateway's `/ws`; agents reach
it through `/mcp`; humans use `/console` (and `/admin`).

```
 vue-demo ───────────WS┐
 react-demo ─────────WS┤
 webpack-demo ───────WS┼─> gateway :47950   /ws       (runtime, write token)
 webpack5-vue3-demo ─WS┤            /mcp      (agentA read+control · agentB read)
 iframe parent+child WS┘            /console + /admin  (operator)
```

Ports live in a dedicated **`478xx` band**, off the common `5173`/`3000`/`8080`
defaults:

| App | Dev port | Project reported |
|---|---|---|
| `vue-demo` | `47810` | `vue-demo` |
| `react-demo` | `47811` | `react-demo` |
| `webpack-demo` | `47812` | `webpack-demo` |
| `webpack5-vue3-demo` | `47813` | `webpack5-vue3-demo` |
| `iframe-demo` parent | `47814` | `iframe-parent` |
| `iframe-demo` child | `47815` (proxied) | `iframe-child` |

```bash
pnpm demo                                 # build + boot everything (scripts/demo.sh)
```

`scripts/demo.sh` starts **one** `harness --governed` gateway on `:47950` (core
in-process), issues the demo tokens, then hands the apps to
`turbo run dev dev:parent dev:child --filter='./examples/*'`. Each app's plugin
config pins the gateway `/ws` target + its `projectId`; the runtime **write
token** is injected via `HARNESS_TEAM_TOKEN` (exported by `demo.sh`).

The root `.mcp.json` is wired with **both** ends of the spectrum so one agent sees
each:

- `harness-solo` — stdio → a fresh `harness` (Open policy, zero-config, its own
  loopback `/ws`).
- `harness-team` — http → the gateway `/mcp`, **all projects** (agentA token).

Ctrl-C tears everything down. Gateway log is in `/tmp/harness-demo/gateway.log`.

---

## Governed (team) — one gateway, RBAC, audit

This is the production-shaped path: many apps (and many browser windows per app,
each a distinct visitor) report into the one gateway, each a distinct **project**.
Agents reach it **only through `/mcp`**, which enforces token scope (RBAC),
per-project binding, tenant isolation, and audit.

`scripts/demo.sh` issues three tokens, all bound to every project:

- **runtime** `[write]` — the browser token. Core denies it every read/control
  capability, so even if it's extracted from `window.__HARNESS_FE__` it can only
  report events + be driven — never read or drive anyone's data.
- **agentA** `[read, control]` — full agent: reads telemetry **and** drives the
  browser (`page.*`).
- **agentB** `[read]` — read-only: `page.*` is filtered out of its `tools/list`
  manifest and any control `tools/call` is scope-denied at the gateway.

### What to verify (production-shape checklist)

- **Multi-project** — agentA sees all projects through the single gateway; each
  app reports under its own projectId.
- **RBAC** — agentB's `tools/list` omits `page.*`; a `page.click` with agentB is
  rejected (`-32001`). agentA can drive the browser.
- **Write-only runtime** — the browser holds only the `write` token; it cannot
  call any read/control capability.
- **Tenant isolation** — each browser window is a distinct visitor; per-principal
  `canSee` filtering applies.
- **Audit** — every gateway MCP call is appended to `.demo-gateway/audit.jsonl`.
- **Console** — http://127.0.0.1:47950/console (data face) + `/admin`
  (`admin` / `demopass`, governance face).

---

## Solo (zero-config) — `harness` over stdio

The opposite end of the spectrum, shown by the `harness-solo` entry in
`.mcp.json`: an agent spawns `harness` (no flags). That one process runs an
in-process core, a loopback gateway (`/ws` + `/console`), and an MCP server over
**stdio** — no tokens, no RBAC, no audit, fully trusted (single `local`
principal). Point an app's runtime at that loopback `/ws` (the default target)
and it just works.

---

> **Fixed test credentials** (throwaway, deliberately stable so the topology and
> the wired `.mcp.json` don't churn): admin panel `admin` / `demopass`. The three
> tokens are issued **once** on the first run and cached in
> `.demo-gateway/agent-tokens.env`, then reused — the gateway stores only a scrypt
> hash, so they can't be re-printed later. To rotate, delete `.demo-gateway/` +
> `.demo-core/` and re-run. The gateway data dirs are git-ignored.
