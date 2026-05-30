# Harness-FE demos — solo vs. team (multi-user)

Two runnable demos show the two ends of the deployment spectrum. They use
**distinct ports** so they can run side by side.

| Mode | App | Vite | Daemon | Gateway | Agent transport |
|---|---|---|---|---|---|
| **Solo** (zero-config) | `vue-demo` | `5174` | loopback `47729` (no token) | — | stdio dev-cli |
| **Team** (governed, multi-user) | `react-demo` | `5173` | central `47900` (token) | `47950` | HTTP-MCP via gateway (scoped token) |

---

## Solo mode — `vue-demo`

Zero friction. The runtime connects to a loopback daemon on the default port
(`47729`); loopback dev is fully trusted (single principal, sees everything).
The agent talks to it over stdio — no gateway, no RBAC, no audit.

```bash
# Agent config: copy examples/vue-demo/.mcp.json.example → .mcp.json
cd examples/vue-demo && pnpm dev          # → http://localhost:5174
```

The agent's stdio dev-cli spawns/attaches the loopback daemon automatically.

---

## Team mode — `react-demo` (multi-user, remote server)

Simulates a real multi-user deployment: many browsers (each a distinct visitor)
report into **one shared central daemon**; agents reach it **only through the
governance gateway**, which enforces token scope (RBAC), tenant isolation, and
audit.

```
browsers (react-demo runtime) ──WS + team token──┐
                                                  ▼
                       central daemon :47900  (token, HTTP-MCP upstream)
                                                  ▲
 agent ──HTTP-MCP + gateway token (RBAC)──> gateway :47950 ─(inject caller)─┘
```

```bash
pnpm build                                # ensure dist is current
bash scripts/demo-multiuser.sh            # boots daemon + gateway, issues tokens,
                                          # wires react-demo/.mcp.json with agentA
# in another terminal:
cd examples/react-demo && pnpm dev        # → http://localhost:5173
# open :5173 in 2-3 browser windows = multiple users
```

`scripts/demo-multiuser.sh` issues two scoped agent tokens:

- **agentA** `[read, control]` — full agent: can read telemetry **and** drive the
  browser (`page.*`).
- **agentB** `[read]` — read-only: `page.*` is filtered out of its manifest and
  any `tools/call` to a control tool is scope-denied at the gateway.

### What to verify (production-shape checklist)

- **RBAC** — agentB's `tools/list` omits `page.*`; a `page.click` with agentB is
  rejected (`-32001 scope denied`). agentA can drive the browser.
- **Tenant isolation** — each browser window is a distinct visitor; per-principal
  `canSee` filtering applies (loopback/solo sees all, scoped callers see their own).
- **Audit** — every gateway call is appended to `.demo-gateway/audit.jsonl`.
- **Admin** — http://127.0.0.1:47950/admin (`admin` / `demopass`): servers, tokens, audit.
- **Versions** — dashboard header badge + the in-page overlay's `version` row
  both show the running build (no more guessing whether it's the latest).

Tear down with Ctrl-C in the `demo-multiuser.sh` terminal.

> Ports are configurable: `HARNESS_FE_URL` / `HARNESS_FE_TOKEN` (react-demo
> runtime target), `HARNESS_TEAM_TOKEN` (central daemon token). The gateway data
> dir (`.demo-gateway/`) is recreated fresh on each run and is git-ignored.
