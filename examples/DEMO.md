# Harness-FE demos — solo vs. team (one shared service, many projects)

`pnpm demo` boots the **whole spectrum** on one machine, on the latest local
build (`workspace:*` packages + the `dist` that `pnpm build` produces). All dev
servers run under a single `turbo run`, so you get unified, per-app live logs in
the terminal and one Ctrl-C stops the lot.

Ports live in a dedicated **`478xx` band**, off the common `5173`/`3000`/`8080`
defaults so the demo never fights another dev server for a port:

| Mode | App | Dev port | Daemon | Gateway | Project reported |
|---|---|---|---|---|---|
| **Solo** (zero-config) | `vue-demo` | `47810` | loopback `47729` (no token) | — | `vue-demo` |
| **Team** (shared service) | `react-demo` | `47811` | central `47900` (token) | `47950` | `react-demo` |
| **Team** (shared service) | `webpack-demo` | `47812` | central `47900` | `47950` | `webpack-demo` |
| **Team** (shared service) | `webpack5-vue3-demo` | `47813` | central `47900` | `47950` | `webpack5-vue3-demo` |
| **Team** (shared service) | `iframe-demo` parent | `47814` | central `47900` | `47950` | `iframe-parent` |
| **Team** (shared service) | `iframe-demo` child | `47815` (proxied) | central `47900` | `47950` | `iframe-child` |

```bash
pnpm demo                                 # build + boot everything (scripts/demo.sh)
```

`scripts/demo.sh` stands up the daemon + gateway + tokens, then hands the apps to
`turbo run dev dev:parent dev:child --filter='./examples/*'`. The team/solo
connection difference lives in each app's own config (team apps hard-code the
central daemon target; solo stays on loopback), so turbo can launch them all
uniformly with no env var leaking the team target into the solo app.

The root `.mcp.json` is wired with **both** servers, so one agent sees both ends:

- `harness-solo` — stdio → loopback daemon (the latest local-built dev-cli), `vue-demo`
- `harness-team` — http → gateway → central daemon, **all team projects** (agentA token)

Ctrl-C tears everything down. Daemon/gateway logs are in `/tmp/harness-demo/`.

---

## Team mode — ONE shared service, MANY projects

This is the production-shaped path: many apps (and many browser windows per app,
each a distinct visitor) report into **one shared central daemon**. Each app is a
**distinct project** in that daemon. Agents reach it **only through the governance
gateway**, which enforces token scope (RBAC), per-project binding, tenant
isolation, and audit.

```
 react-demo ─────────WS┐
 webpack-demo ───────WS┤
 webpack5-vue3-demo ─WS┼─> central daemon :47900  (token, HTTP-MCP upstream)
 iframe parent+child WS┘            ▲
                                    │
 agent ─HTTP-MCP + multi-project token─┴─> gateway :47950 ─(inject caller)
```

`scripts/demo.sh` issues two scoped agent tokens, **both bound to every team
project** (`react-demo`, `webpack-demo`, `webpack5-vue3-demo`, `iframe-parent`,
`iframe-child`):

- **agentA** `[read, control]` — full agent: reads telemetry **and** drives the
  browser (`page.*`) across all projects.
- **agentB** `[read]` — read-only: `page.*` is filtered out of its manifest and
  any `tools/call` to a control tool is scope-denied at the gateway.

### What to verify (production-shape checklist)

- **Multi-project** — one agent (agentA) sees all five team projects through the
  single gateway connection; each app reports under its own projectId.
- **RBAC** — agentB's `tools/list` omits `page.*`; a `page.click` with agentB is
  rejected (`-32001 scope denied`). agentA can drive the browser.
- **Tenant isolation** — each browser window is a distinct visitor; per-principal
  `canSee` filtering applies (loopback/solo sees all, scoped callers see their own).
- **Audit** — every gateway call is appended to `.demo-gateway/audit.jsonl`.
- **Admin** — http://127.0.0.1:47950/admin (`admin` / `demopass`): servers, tokens, audit.
- **Versions** — dashboard header badge + the in-page overlay's `version` row
  both show the running build.

---

## Solo mode — `vue-demo`

Zero friction, the opposite end of the spectrum. The runtime connects to a
loopback daemon on the default port (`47729`); loopback dev is fully trusted
(single principal, sees everything). The agent talks to it over stdio — no
gateway, no RBAC, no audit. `pnpm demo` wires `harness-solo` to the **latest
local-built** dev-cli (`packages/dev-cli/dist/cli.js`), so solo runs the same
build as the team path.

---

> **Fixed test credentials** (throwaway, deliberately not random so the topology
> is stable and the wired `.mcp.json` never churns): central daemon token
> `team-secret-demo`, admin panel `admin` / `demopass`. The two agent gateway
> tokens are issued **once** on the first run and cached in
> `.demo-gateway/agent-tokens.env`, then reused — the gateway stores only a
> scrypt hash, so they can't be re-printed later. To rotate them, delete
> `.demo-gateway/` and re-run.
>
> `HARNESS_TEAM_TOKEN` overrides the central daemon token at both ends at once —
> `scripts/demo.sh` starts the daemon with it and the team app configs read the
> same value (defaulting to `team-secret-demo`). The team apps hard-code the
> daemon target `ws://127.0.0.1:47900` in their plugin config; the solo app sets
> no target and stays on the loopback daemon. The gateway data dir
> (`.demo-gateway/`) is **persistent** across runs and is git-ignored.
