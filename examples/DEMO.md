# Harness-FE demo — team gateway + an auto-spawned solo gateway

`pnpm demo` boots the whole demo on one machine, on the latest local build
(`workspace:*` packages + the `dist` that `pnpm build` produces). All dev servers
run under a single `turbo run`, so you get unified per-app live logs and one
Ctrl-C stops the lot.

Two ends of one spectrum. The **team** apps report into a governed gateway
(token + RBAC + audit). **vue-demo** is the **solo** example: a zero-config Open
gateway that is **auto-spawned and shared** — nobody starts it by hand. Both
kinds expose the same faces: `/ws` (runtime), `/mcp` (agents), `/console` (humans).

```
 react-demo ─────────WS┐
 webpack-demo ───────WS┼─> team gateway :47950  /ws (write token) · /mcp · /console + /admin
 webpack5-vue3-demo ─WS┤            (agentA read+control · agentB read)
 iframe parent+child WS┘

 vue-demo ───────────WS┐
 harness-solo (mcp) ───┴─> solo gateway :47951  (Open, AUTO-SPAWNED + shared; /ws + /mcp + /console)
```

Ports live in a dedicated **`478xx` band**, off the common `5173`/`3000`/`8080`
defaults:

| App | Dev port | Project reported | Gateway |
|---|---|---|---|
| `vue-demo` | `47810` | `vue-demo` | **solo `:47951`** (auto-spawned) |
| `react-demo` | `47811` | `react-demo` | team `:47950` |
| `webpack-demo` | `47812` | `webpack-demo` | team `:47950` |
| `webpack5-vue3-demo` | `47813` | `webpack5-vue3-demo` | team `:47950` |
| `iframe-demo` parent | `47814` | `iframe-parent` | team `:47950` |
| `iframe-demo` child | `47815` (proxied) | `iframe-child` | team `:47950` |

```bash
pnpm demo                                 # build + boot everything (scripts/demo.sh)
```

`scripts/demo.sh` starts **one** `harness --governed` gateway on `:47950` (core
in-process), issues the demo tokens, then hands the apps to
`turbo run dev dev:parent dev:child --filter='./examples/*'`. It does **not** start
the solo gateway — vue-demo's dev server auto-spawns it on `:47951` via the build
plugin (and `harness-solo` would too). Each app's plugin config pins its `/ws`
target + `projectId`; the team apps' **write token** is injected via
`HARNESS_TEAM_TOKEN` (exported by `demo.sh`). The solo gateway's data is kept in
the demo's isolated `.demo-solo-core/` via `HARNESS_CORE_DATA_DIR`.

The root `.mcp.json` is wired with **both** ends of the spectrum so one agent sees
each:

- `harness-solo` — stdio → `harness mcp`: reuses (or auto-spawns) the shared solo
  gateway on `:47951` and proxies the agent's stdio MCP to its `/mcp`. Sees vue-demo.
- `harness-team` — http → the team gateway `/mcp`, **all team projects** (agentA token).

Ctrl-C tears everything down, incl. the auto-spawned solo gateway. Gateway log is
in `/tmp/harness-demo/gateway.log`.

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

## Solo (zero-config) — one auto-spawned, shared gateway

The opposite end of the spectrum, demonstrated by **vue-demo**. There is **no
manual gateway start**: whoever comes up first auto-spawns one shared Open gateway
on `:47951`, and the other end reuses it.

- vue-demo's **dev server** (build plugin, `configureServer`) detects a loopback
  target with no token → ensures the shared gateway is up, then connects its `/ws`.
- the **agent** (`harness-solo` = `harness mcp`) does the same, then proxies its
  stdio MCP to the gateway's `/mcp`.

The gateway is started by whichever runs first and **survives** the other quitting
(it's spawned detached). Open policy: no tokens, no RBAC, no audit, single trusted
`local` principal. Data is shared — the agent sees vue-demo's sessions because both
hit the same gateway + core dir.

### What to verify

- Open http://127.0.0.1:47951/console once vue-demo (or the agent) is up — it's the
  **real** console UI (cli locates `@harness-fe/console-ui`'s dist), not a placeholder.
- Kill vue-demo's dev server → the solo gateway (and its console) **stay alive**.
- Start the agent first (no dev server) → `harness mcp` spawns the gateway itself;
  later starting vue-demo reuses it.

---

> **Fixed test credentials** (throwaway, deliberately stable so the topology and
> the wired `.mcp.json` don't churn): admin panel `admin` / `demopass`. The three
> tokens are issued **once** on the first run and cached in
> `.demo-gateway/agent-tokens.env`, then reused — the gateway stores only a scrypt
> hash, so they can't be re-printed later. To rotate, delete `.demo-gateway/` +
> `.demo-core/` and re-run. The solo gateway's data lives in `.demo-solo-core/`
> (cleared on each run). All these dirs are git-ignored.
