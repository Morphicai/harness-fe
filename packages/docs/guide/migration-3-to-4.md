# Migrating 3.x → 4.0

4.0 keeps the **solo developer experience** intact but rebuilds the internals to
add the **team line**: one shared daemon that many people use without colliding —
identity, tenant isolation, and a governance gateway. This guide lists what
changed and how to move a 3.x project to 4.0.

> If you only ever run the daemon on loopback for yourself, the short version is:
> **`consent` now defaults to `deny`** — opt in (or use the overlay toggle) to let
> agents drive the page. Everything else is internal.

## Breaking changes

### 1. Control consent defaults to `deny`
In 3.x, agent control commands (`page.click`, `page.type`, …) ran unguarded. In
4.0 the secure default is **`deny`**: control commands are rejected unless you opt
in. Set it per app via the plugin / `<HarnessScript>` `consent` option:

```ts
harnessFE({ consent: 'off' })       // loopback solo: run freely, no prompt
harnessFE({ consent: 'session' })   // ask the user once per page-load
harnessFE({ consent: 'deny' })      // block control entirely (default)
```

New in 4.0, the **user** can also allow/block control from the in-page overlay
(a one-tap toggle); their choice is persisted and **overrides** the app default.
See [runtime opt-in](#runtime-opt-in-new).

### 2. The gateway is the only front door (architecture rebuild)
The monolithic daemon was split into composable packages:

| Package | Role |
|---|---|
| `@harness-fe/core` | transport-agnostic backend (the daemon library) |
| `@harness-fe/gateway` | governance: token lifecycle, scope RBAC, project→agent binding, audit, admin panel |
| `@harness-fe/cli` | the single `harness` launcher |
| `@harness-fe/console-ui` | the dashboard SPA the gateway serves |

The browser **runtime connects to the gateway `/ws` by default**. For solo dev
the CLI still spawns everything for you — no config change needed.

### 3. Project visibility is default-deny for scoped tokens
A gateway token with **no explicit project grants** can no longer enumerate or
read projects/sessions (previously unowned data was visible to any token). Bind
tokens to the projects they need:

```bash
harness --issue-token name=agentA,scopes=read+control,projects=my-app
```

`local` / loopback solo is unaffected — it still sees everything.

### 4. Linked-group major bump
All core packages move to `4.0.0` together (e.g. `@harness-fe/runtime`
`3.4.0 → 4.0.0`), even those without an individual API change — they share one
version line. Pin to `4` and upgrade them as a set.

## Migrating

### Solo (zero-config) — essentially unchanged
Your existing setup keeps working. The one thing to decide is control consent:
leave it `deny` (agents can't drive the page) or set `consent: 'off'` / use the
overlay toggle to allow it. The daemon config (`npx @harness-fe/mcp-server` in
`.mcp.json`) is unchanged.

### Team (new in 4.0)
Run one shared gateway, issue scoped tokens, bind agents to projects. Full setup:
[Gateway / team mode](../gateway-team-mode.md). In short:

1. `harness serve --governed` — start the shared, consent-gated gateway.
2. Issue a write token for the app runtime and a read+control token per agent,
   each bound to its project(s) with `--issue-token`.
3. Point each app's plugin / `<HarnessScript token=…>` at the gateway URL.

## New capabilities (4.0) {#runtime-opt-in-new}

- **Caller identity + tenant isolation** — every call carries *who*; an agent
  only sees the projects/sessions it's authorized for.
- **Project→agent binding** — a token sees a bound project's whole data set
  regardless of which runtime client created each row.
- **Browser consent + runtime opt-in** — control commands require approval; the
  user can allow/block agent control from the overlay and the choice persists.
- **Task resolution back-link** — `tasks.resolve` records the fix commit / PR /
  re-test session, closing the report → fix → proof loop.
- **Console dashboard** — the gateway serves a rich, identity-scoped dashboard.

For the why behind the team architecture, see the
[Roadmap](https://github.com/Morphicai/harness-fe/blob/main/ROADMAP.md).
