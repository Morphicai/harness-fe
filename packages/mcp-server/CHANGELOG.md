# @harness-fe/mcp-server

## 4.0.0-next.3

### Minor Changes

- cf5de3c: Command-target scoping (4.0 · A) — an agent's commands only drive tabs it may
  control, instead of any tab on the daemon.

  - `sessionRouter.findTab(tabId?, principal?)` restricts candidate tabs via
    `canSee(principal, tab.principal?.id)`: `local` drives anything (zero change
    for solo dev), unowned tabs are drivable by all, otherwise only the tab's
    creator. An explicit `tabId` can no longer target someone else's tab.
  - New `callerContext` (AsyncLocalStorage): the HTTP MCP transport wraps each
    request in `runWithCaller(identifyPrincipal(headers))`, and `bridge.sendCommand`
    reads `currentCaller()` — so scoping applies to every command without
    threading `principal` through ~20 tool handlers. stdio has no ambient caller
    ⇒ no scoping (local trust). Explicit `opts.principal` still wins.

  Zero behaviour change for solo/stdio dev (no ambient caller / local → no
  filtering). Tests: findTab scoping (6) + callerContext ALS (4); full suite 304.

- 3752536: Package split (5.0 · P5) — the monolithic `@harness-fe/mcp-server` is split
  into three packages along the architecture's layering, with **zero behaviour
  change** and **no user-facing breakage**.

  - **`@harness-fe/daemon`** (new) — the daemon core: capability API, event
    store, browser control, WS bridge, identity/auth/consent/scoping. Everything
    that touches data or the browser connection.
  - **`@harness-fe/mcp-server`** — now a thin MCP protocol layer
    (`createMcpServer` + stdio/HTTP transports + `createDaemon`), depending on
    `@harness-fe/daemon`. Re-exports daemon's public API so existing imports keep
    working; keeps a `harness-fe` bin shim that forwards to dev-cli.
  - **`@harness-fe/dev-cli`** (new) — the solo-dev launcher (`harness-fe` bin):
    arg parsing, leader/follower, banner, open-browser. Glue over daemon +
    mcp-server.

  Layering is single-directional (`dev-cli → mcp-server → daemon`, no cycles).
  `createDaemon` stays in mcp-server (it orchestrates Bridge + MCP HTTP, so it
  can't live in daemon without a cycle). `openBrowser` lives in daemon (the
  `dashboard.open` tool needs it). Full suites green: daemon 282 + mcp-server 29
  = the pre-split 311, plus runtime-client 110 — zero regression.

- cb0a310: Project→agent binding + host/sub-app tagging (4.0 · A) — tenant isolation now
  keys on project ownership (with host→sub-app routing) instead of per-row tags.

  - New `canSeeProject(principal, ownerChain)`: visible when the caller owns the
    project itself **or any ancestor** (walked via `parentProjectId`) — a host
    agent sees its sub-apps' data, but a sub-app owner doesn't see up the tree.
    `local` sees all; unowned links stay visible (backward compat).
  - `project.sessions` / `session.list` / `tasks.pending` filter by project
    ownership via `ownerChainOf(projectId, store)` — owning a project grants its
    whole session/task set, regardless of which runtime client created each row
    (fixes the creator≠consumer mismatch that per-row `createdBy` filtering had).

  Zero behaviour change for solo dev (loopback → local → sees all; full suite
  311 green). Tests: canSeeProject ownership + host-subtree (7).

### Patch Changes

- Updated dependencies [1e00293]
- Updated dependencies [3752536]
  - @harness-fe/daemon@4.0.0-next.3

## 4.0.0-next.2

### Minor Changes

- d1f7e2a: Tenant read-isolation for MCP list tools (4.0 · P3) — agents now only see the
  data they own, using the `createdBy` tags from P1 and the per-call principal
  from P4.

  - New `canSee(principal, createdBy)`: `local` (loopback / stdio solo) sees
    everything; unowned data (no `createdBy` — legacy rows) is visible to all;
    otherwise a record is visible only to the principal that created it.
  - `project.sessions`, `session.list`, and `tasks.pending` filter their results
    through `canSee` using the per-call principal (`extra.requestInfo` headers).

  Zero behaviour change for solo dev: loopback resolves to `local`, which sees
  everything (verified — full suite green). Named-token isolation is exact in
  today's single-token reality; the full `project → agent` binding for the
  creator ≠ consumer case (once P6 splits write/read scopes) is deferred to P6.
  Command-target scoping is also deferred (it needs the same ownership model).

## 4.0.0-next.1

### Minor Changes

- 71bcc3e: Per-call caller identity for MCP tools (4.0 · P4) — the MCP layer now
  identifies _which_ caller made each tool call instead of collapsing every
  agent to one principal.

  Rather than rebuild the HTTP transport per-session, this uses the MCP SDK's
  per-request `extra.requestInfo` (the originating HTTP request's headers),
  which every tool handler already receives. A new `identifyPrincipal(headers,
auth)` _identifies_ (never re-authorizes — the request already cleared the
  bridge auth wrapper) the caller: token mode reads the `Authorization` header
  into a `token:` principal; stdio (no requestInfo) and loopback resolve to
  `local`; custom-authorize resolves to `host`.

  `tasks.claim` / `tasks.resolve` now stamp `Task.agentId` with this per-call
  principal (falling back to the daemon's local principal for stdio). This
  unblocks P3 tenant filtering, which needs a real per-call principal at the
  MCP layer to be meaningful. Behaviour is unchanged for solo/stdio dev.

## 4.0.0-next.0

### Minor Changes

- 9a3c5e1: Browser Consent (4.0 · P2) — control commands now require in-page user
  approval before they run, once the daemon is exposed.

  - The daemon pushes a consent policy in `hello.ack`: `off` on loopback solo
    dev (zero-friction, unchanged) and `session` once auth is enabled
    (exposed). Override via `createDaemon({ consent: { mode } })`.
  - Control commands (`page.click/type/scroll/navigate/reload/set_html/
set_style/evaluate/wait_for`) are gated; read-only commands (screenshot,
    dom*query, *\_tail, project.\_) are not. `page.evaluate` always prompts.
  - The runtime client gates `handleCommand`: in `session` mode the first
    control command prompts and the rest of the pageload runs once granted;
    `always` prompts every time; `off` never prompts. No prompter registered ⇒
    fail-safe deny (a policy that can't ask must not silently allow).
  - The in-page overlay shows a consent modal (command preview + Allow once /
    Allow for session / Deny) and registers itself as the prompter.

  Client-side gate by design: consent is the browser-side user's real-time
  approval, closest to the user; it reuses the existing command→response round
  trip (a denied command returns `ok:false` / `CONSENT_DENIED`), so the daemon's
  `sendCommand` path is unchanged. Behaviour is unchanged on loopback (consent
  off). New `hello.ack.consent` field is optional.

- a3bd7ea: Caller identity (4.0 · P1) — the auth boundary now carries _who_, not just
  allow/deny.

  - New `identity` module: `Principal` type + `resolvePrincipal(req, auth)`
    (loopback → `local`, token → hashed `token:…` id, custom-authorize → `host`),
    layered on the existing auth primitives so the two never disagree on who is
    allowed in.
  - WS connections resolve a `Principal` at upgrade and carry it on
    `PeerSession.principal`.
  - Project / session metadata and `Task` gain optional `createdBy` (write-once)
    and `Task.agentId`; the bridge tags project/session creation with the
    connection's principal and stamps `agentId` on task claim/resolve.

  Phase 1 only **establishes and tags** identity — reads are not yet filtered by
  owner (that is P3 tenant isolation). Behaviour is unchanged: loopback solo dev
  stays a single implicit `local` principal, tokens are still never
  auto-generated, and all new fields are optional.

### Patch Changes

- Updated dependencies [9a3c5e1]
- Updated dependencies [a3bd7ea]
  - @harness-fe/protocol@4.0.0-next.0
  - @harness-fe/dashboard-ui@0.2.0

## 3.4.0

### Minor Changes

- 31915be: **Optional experimental-tool gate.** The MCP server can register tools that are still in the testing phase via a new `registerExperimentalTools()` section in `mcp.ts`. By default these are **fully on** — a plain dev setup gets them with zero config (lowest mental burden). They only get restricted when the host opts in by naming an env var to gate on; the tools then show up only on machines where that var is set to a non-empty value.

  **Why:** the common case (the developer who owns this daemon) shouldn't have to set anything to use in-flight tools. Gating is the exception — for when you want to ship the tools but expose them only in specific environments.

  **Configuration:** the gate env-var _name_ is supplied end-to-end — `createMcpServer(bridge, { experimentalEnvVar })`, `startMcpStdioServer`/`startMcpHttpServer`, `createDaemon({ experimentalEnvVar })`, and the CLI (`--experimental-env-var <name>` / `HARNESS_FE_EXPERIMENTAL_ENV_VAR`). Omit it for fully-on; supply it to restrict.

  **Mechanism:** exported `experimentalEnabled(envVar?)` helper — returns `true` when no name is given, otherwise checks `process.env[name]` (presence semantics: any non-empty value enables). Ships with one probe tool, `experimental.ping`, as the canonical example; when a feature graduates, move its `registerTool` call into `registerTools`.

## 3.2.0

### Minor Changes

- 2671c1c: **New `@harness-fe/sandbox` package + runtime refactor + 3 new MCP tools.** The runtime's browser-API patching is now a standalone lib with observer + interceptor middleware across 9 channels.

  ## New package: `@harness-fe/sandbox`

  A reusable browser sandbox / interceptor framework. Used internally by `@harness-fe/runtime`, but standalone-usable in any project (Tanka MF, custom MorphixAI base, etc.).

  ### 9 channels

  | Channel            | Observe | Intercept                                                     |
  | ------------------ | ------- | ------------------------------------------------------------- |
  | `fetch`            | ✓       | onRequest / onResponse (async-aware)                          |
  | `xhr`              | ✓       | onRequest / onResponse                                        |
  | `ws`               | ✓       | onConstruct / onSend / onMessage / onClose                    |
  | `storage`          | ✓       | onGet / onSet / onRemove / onClear (local + session + cookie) |
  | `navigation` (new) | ✓       | onPush / onReplace / onAssign / onHash                        |
  | `console`          | ✓       | —                                                             |
  | `errors`           | ✓       | —                                                             |
  | `globals` (new)    | ✓       | onGet / onSet / onDelete (per-key watch list)                 |
  | `indexeddb` (new)  | ✓       | onOpen / onPut / onGet / onDelete / onClear                   |

  ### Safety properties

  - **Identity preserved.** typeof / instanceof / constructor / prototype chain / for...in / JSON.stringify all behave bit-identically to native.
  - **`.call()` bypass closed.** Proxy + prototype double patch on Storage / WebSocket / XHR — `Storage.prototype.setItem.call(...)` etc. route through the interceptor.
  - **`new.target` check.** `WebSocket(...)` without `new` throws TypeError (matches spec).
  - **Global reentry guard.** Consumer code recursively touching a patched API (e.g. `onSet: (k,v) => localStorage.setItem('echo:'+k, v)`) does NOT loop — inner calls bypass interceptors. Guard counter lives on `globalThis` so cross-module-instance installs (HMR dup) share it.
  - **Silent graceful degradation.** Every patch step in try/catch — if the engine refuses, the channel skips, business code never sees a sandbox error.

  ## `@harness-fe/runtime` consumes the sandbox

  - Deleted in-tree `fetchPatch.ts` / `xhrPatch.ts` / `wsPatch.ts` / `storagePatch.ts` / `initiator.ts` (1142 LOC of patch code).
  - `capture.ts` is now a thin adapter (~175 LOC) that maps `SandboxEvent` → `NetworkEntry / WsEntry / StorageEntry / ConsoleEntry / ErrorEntry / NavigationEntry / GlobalsEntry / IndexedDbEntry` and pushes through the existing bridge.
  - **Public API unchanged**: `RuntimeClient` + auto-start work exactly as before; this is a pure internal refactor.

  ## 3 new MCP tools

  | Tool              | Filters                       | Use case                                       |
  | ----------------- | ----------------------------- | ---------------------------------------------- |
  | `navigation.tail` | `kind`, `filter`              | track SPA route changes / `location.*` setters |
  | `globals.tail`    | `op`, `key`, `filter`         | detect global pollution / watch app state      |
  | `indexeddb.tail`  | `op`, `store`, `db`, `filter` | who reads/writes IDB                           |

  Each follows the existing `*.tail` family:

  - `filter` + `match` (contains / regex)
  - typed narrows
  - per-tab default with `tabId` override
  - `session.tail({ type: 'X' })` for cross-navigate history

  ## Protocol additions (all additive)

  - `NavigationEntry` / `GlobalsEntry` / `IndexedDbEntry` zod schemas + types
  - 3 new `COMMAND` codes
  - `EventType` union gains `'navigation' | 'globals' | 'indexeddb'` literals

  ## Bug fixes carried by the refactor

  - **`storage.setItem` no longer crashes when given non-string values.** The 3.1.x in-tree `storagePatch` forwarded raw values into a `clip(value).slice(...)` call and threw `TypeError: s.slice is not a function` for `setItem(key, Date.now())` / `setItem(key, true)` / `setItem(key, {...})` etc. Native Storage implicitly `ToString`s the value (Web Storage spec), and a lot of business code relies on that. The sandbox rewrite stringifies the value at every setItem entry (proxy method, proxy `set` trap, `Storage.prototype.setItem.call(...)` bypass path) before any clipping. 5 regression tests pin the behaviour.

  ## Tests

  - `@harness-fe/sandbox`: 84 unit / 2 skip / 86 total
  - `@harness-fe/runtime`: 84 / 84 (post-refactor, deleted patch tests migrated to sandbox)
  - `@harness-fe/mcp-server`: 265 / 265
  - Real-browser Playwright e2e: 26 / 26 in Chromium 1223 (V8/Blink)

### Patch Changes

- Updated dependencies [2671c1c]
  - @harness-fe/protocol@3.2.0
  - @harness-fe/dashboard-ui@0.2.0

## 3.1.0

### Minor Changes

- b63c378: **Multi-tab observability** — fill the gaps that made Electron / multi-tab / WebSocket-driven bugs hard to diagnose. All schema changes are additive; existing jsonl data continues to work.

  ### New runtime captures

  - **WebSocket frame capture** (`wsPatch.ts`) — every `new WebSocket(...)` is wrapped to emit `open / send / recv / close` frames with payload (text/JSON auto-parsed, binary as size marker), connection id, and `initiator.stack` on open/send. The daemon URL itself is denylisted so the bridge ws does not self-loop.
  - **Storage trap** (`storagePatch.ts`) — `localStorage` / `sessionStorage` `setItem / removeItem / clear` and `document.cookie` mutations are intercepted with `initiator.stack`. Cross-tab events (native `storage` event) are tagged `crossTab: true`.
  - **REST initiator stack** — `fetchPatch` and `xhrPatch` now stamp each `req` entry with `initiator.stack` so "who issued this request" is answerable without a debugger.

  ### New MCP tools

  - `ws.tail` / `storage.tail` — same tail family as `network.tail` / `console.tail`.
  - `network.get({ reqId })` / `ws.get({ wsId })` — pull a single entry's full body when `*.tail` truncates.
  - `network.wait_for({ urlContains|urlRegex, method?, statusCode?, timeoutMs })` — Playwright-style request wait, baseline-anchored so pre-existing matches don't satisfy.
  - `network.wait_for_idle({ idleMs, timeoutMs })` — resolves after a quiet window.
  - `visitor.timeline({ visitorId, types?, tabIds?, sessionIds?, since?, until?, limit? })` — merge all sessions belonging to one visitor into one ascending event stream. Each event carries `tab` + `sessionId` so cross-tab causality (a ws frame in tab A causing a storage write in tab B) is visible in one call.

  ### Filter discoverability fix

  All `*.tail` tools now accept `filter` + `match: 'contains' | 'regex'`, plus narrow params (`level`, `urlContains`, `method`, `statusCode`, `phase`, `which`, `op`, `key`). Previously these were silently stripped by zod when not in the schema.

  ### Cross-reference docs

  `session.tail` description points users to `visitor.timeline` for cross-tab cases. The `*.tail` descriptions now mention that buffers clear on navigate, and `session.tail` is the persistent equivalent.

  ### Schema (additive only)

  - `EventType` union: `+ 'ws'`
  - `NetworkEntry`: `+ initiator?: { stack? }`
  - New `wsEntrySchema` / `storageEntrySchema`
  - `storagePayloadSchema`: `+ initiator?: { stack? }`
  - 6 new `COMMAND` codes; old codes unchanged.

  ### Tests

  +65 tests added across unit and E2E:

  - 9 wsPatch unit + 9 storagePatch unit + 12 filter unit + 8 visitor.timeline unit
  - 6 bridge-ingestion E2E (runtime → bridge → jsonl with real ws)
  - 6 MCP-protocol E2E (real `McpServer` + `Client` via `InMemoryTransport`)
  - 9 runtime command E2E (real async polling for `wait_for*` / `network.get` / `ws.get`)
  - 5 full-stack E2E (`RuntimeClient` + happy-dom + real Bridge + real `JsonlStore`)

  Zero regressions.

### Patch Changes

- Updated dependencies [b63c378]
  - @harness-fe/protocol@3.1.0
  - @harness-fe/dashboard-ui@0.2.0

## 3.0.1

### Patch Changes

- b756c92: Token is now fully optional — the daemon never refuses to start over
  auth policy. Whether to require a token, and at what bind address, is
  entirely the operator's call.

  Concretely:

  - **Previous behavior**: `--host 0.0.0.0` without `--token` was
    refused at startup with a hard error.
  - **New behavior**: the CLI starts. When binding to a non-loopback
    host without a token, a stderr warning prints — "no token set —
    anyone on this network can read console / network / recordings"
    — and that's it.

  The startup banner now **always** prints the dashboard URL, regardless
  of token state:

  - No token: `http://<host>:<port>` — bare URL, auth disabled
  - With token: `http://<host>:<port>?token=<token>` — first browser
    hit hands the token off to a 30-day cookie via mcp-server's
    existing handoff redirect

  Same applies to the `--mcp-transport http` agent-config hint: when
  no token is set, the printed JSON snippet omits the `Authorization`
  header line. `HARNESS_FE_TOKEN` env var continues to be honored as
  an equivalent to `--token`.

  README updated with a behavior table so the four common scenarios
  (local open / local + auth / LAN open / LAN + auth) are spelled out
  in one place.

## 3.0.0

### Minor Changes

- 9e70d1e: Cut over from the legacy server-rendered dashboard to the React SPA.

  - `GET /` now 302-redirects into `/dashboard/?token=…` (preserves token)
  - `GET /sessions/:id` 302-redirects to `/dashboard/sessions/:id?token=…` so old bookmarks keep working
  - Legacy `dashboard.ts` module deleted (332 lines of inlined HTML). All
    data correctness it covered is now exercised by `dashboardApi.test.ts`
    (JSON shapes) and `dashboardSpa.test.ts` (routing + caching)

  Visitors hitting the daemon root land in the SPA. No new endpoints, no
  breaking changes to the JSON API or WS subscription introduced in PR C.

- 541cbba: Add a JSON API under `/api/*` for the upcoming React SPA dashboard.

  Routes:

  - `GET /api/projects` — projects with their 10 most recent sessions inline
  - `GET /api/sessions?projectId=&tabId=&buildId=&limit=` — sessions list with optional filters
  - `GET /api/sessions/:id` — session detail (meta + summary + chunks + timeline tail + exports)
  - `POST /api/sessions/:id/replay` — create a replay export (same logic as the form POST; returns JSON instead of a 302)

  Routes are chained ahead of the legacy HTML dashboard handler so `/api/*`
  never falls into the HTML 404 page. Non-`/api/*` paths still hit the
  existing handlers unchanged. Auth (token) is enforced upstream in
  `bridge.ts` as before.

  No user-facing change yet — the React SPA that consumes this lands in
  the next PR.

- 65f2b96: Add MCP tool `dashboard.open` so agents can surface the dev dashboard
  to the human user.

  The tool returns the dashboard URL (with token pre-populated when auth
  is configured) and optionally launches the user's default browser via
  `open` (macOS) / `xdg-open` (Linux) / `cmd /c start ""` (Windows). Set
  `HARNESS_FE_HEADLESS=1` to suppress browser-launch attempts in remote
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

- 88e41a2: Wire up the React SPA dashboard end-to-end (PR C of A-E).

  ### `@harness-fe/dashboard-ui`

  - Real routes — `ProjectList` (`/`) and `SessionDetail` (`/sessions/:id`) — replacing the placeholder hero
  - Glass header with a live-pill indicator that flashes green on each `dashboard.update`
  - Tab/recording/timeline/exports panels matching the legacy HTML dashboard's information density, in a Linear-style dark layout
  - Inline "Create replay" buttons that POST to `/api/sessions/:id/replay` and reveal a link to `/replay/:exportId`
  - `useApi` / `useLiveBridge` hooks: GET wrapper with token auth + singleton WS subscriber with backoff reconnect
  - ~64 KB gzip total bundle

  ### `@harness-fe/mcp-server`

  - New `dashboardSpa.ts` handler — serves the SPA at `/dashboard/*` from `@harness-fe/dashboard-ui/dist`. Hashed assets get long-lived immutable cache; `index.html` is `no-store`. Path traversal blocked
  - WS subscriber registry: clients sending `hello { role: 'dashboard-client' }` get added to `dashboardSubscribers` and receive `dashboard.update` frames
  - Broadcast hooks at `upsertSession` (new/update), `closeSession`, `appendRecording` (debounced 200ms per session), and `writeExport` (via API callback)
  - `notifyDashboard()` public method so future code paths can push their own update kinds

  ### `@harness-fe/protocol`

  - New peer role `dashboard-client`
  - New `dashboardUpdateFrameSchema` carrying `{ kind, sessionId?, projectId?, ts }`
  - `frameSchema` discriminated union extended

  Old `/` and `/sessions/:id` HTML routes remain in place during this PR;
  the redirect + legacy deletion lands in PR D.

### Patch Changes

- a7d8c96: Fix: visiting `/dashboard/?token=…` rendered a blank page because the SPA
  bundle (loaded via `<script src="/dashboard/assets/index-XXX.js">` —
  without the token query) hit 401 and never executed.

  The dashboard handler now does a one-hop token handoff: when a request
  arrives with `?token=…` but no `harness_fe_token` cookie, the response
  is a 302 with `Set-Cookie: harness_fe_token=…; Path=/; SameSite=Lax`
  and a clean Location. From that point every same-origin request (SPA
  assets, `/api/*`, WS upgrade) carries the cookie automatically.

  The redirect also normalizes `/dashboard` → `/dashboard/` in the same
  hop, so a typical first-load chain is a single redirect rather than two.

  No behavior change for users already authenticated via cookie, header,
  or query — the handoff only fires once per session.

- Updated dependencies [65f2b96]
- Updated dependencies [88e41a2]
- Updated dependencies [7d3f830]
- Updated dependencies [10d669c]
  - @harness-fe/protocol@3.0.0
  - @harness-fe/dashboard-ui@0.2.0

## 2.1.0

### Patch Changes

- 09c3da4: Add a self-hosted Docker image (`morphixai/harness-fe`) for teams
  who want to run the daemon on a shared dev VM instead of `npx` on each
  laptop. Multi-arch (amd64 + arm64), publishes automatically on every
  mcp-server release.

  Container defaults differ from `npx`: `HARNESS_FE_HOST=0.0.0.0`,
  `HARNESS_FE_MCP_TRANSPORT=http`, and `HOME=/data` so the volume mount
  captures all persistence. Token (`HARNESS_FE_TOKEN`) is still required.

  See [docs/docker.md](https://github.com/Morphicai/harness-fe/blob/main/docs/docker.md)
  for the full guide and [examples/docker/docker-compose.example.yml](https://github.com/Morphicai/harness-fe/blob/main/examples/docker/docker-compose.example.yml)
  for a reference compose file.

## 2.0.0

### Minor Changes

- 5d02bbf: LAN-friendly daemon with token auth, MCP-over-HTTP transport, and Vue 2
  syntax hardening.

  **Daemon (`@harness-fe/mcp-server`)**

  - New CLI flags: `--host`, `--port`, `--token [value|auto]`,
    `--mcp-transport <stdio|http>`, `--mcp-path`, `--public-host`. Matching
    env vars: `HARNESS_FE_HOST`, `HARNESS_FE_TOKEN`, etc.
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
  - `npx @harness-fe/mcp-server` now works (shebang fixed, postbuild
    chmod, `engines.node >= 18`).

  **Protocol (`@harness-fe/protocol`)**

  - Added `DEFAULT_HOST`, `isLoopbackHost`, `buildWsUrl`, `buildHttpUrl`.

  **Plugin (`@harness-fe/unplugin` + vite/webpack wrappers)**

  - `HarnessFEOptions.token` — appended to the daemon WS URL and threaded
    through `__HARNESS_FE__` so the runtime client connects under LAN
    mode.
  - `HarnessFEOptions.safeMode` (default `true`) — Vue SFC transform
    now strict-downgrades on `compiler-sfc` errors, wraps walk in
    try/catch, and re-parses its own output. Legacy Vue 2 syntax (filters,
    `<template functional>`, …) is silently skipped instead of risking a
    corrupt template fed downstream.
  - `HARNESS_FE_DRY_RUN=1` builds without injecting, then prints a
    coverage report (files attempted/injected, skip counts, first 20
    skipped paths) on process exit. Use it to scope adoption in legacy
    Vue projects.

  See `docs/lan-mode.md` and `docs/vue2-compat.md` for the developer
  guides.

### Patch Changes

- Updated dependencies [5d02bbf]
  - @harness-fe/protocol@2.0.0

## 1.0.2

### Patch Changes

- 74be490: 1.0.2 — coordinated patch across the linked group

  **Functional changes:**

  - `@harness-fe/node-runtime` — auto-captured server-side `console.*` calls now inherit the request's `sessionId` automatically when used with `@harness-fe/next`. Previously they became orphans unless the handler was wrapped with `withHarnessTracing`. Mechanism: a new `setSessionIdProvider(fn)` dependency-injection setter; the Next adapter pushes its `cache()`-backed getter in on first render. ALS still wins when populated; orphan behaviour unchanged when no adapter is loaded.
  - `@harness-fe/log` — node-side emit path simplified to delegate sessionId resolution to `node-runtime.getRequestSessionId()`. Same observable behaviour; less duplicated logic. Peer-dependency declarations cleaned up — the dynamic-import contract is described in the README instead.
  - `@harness-fe/next` — `sessionId.ts` module side-effect-registers its `cache()` getter with node-runtime via `setSessionIdProvider`. No new exports.

  **Release plumbing:**

  - Republish `@harness-fe/log` after the 24-hour cooldown from a prior unpublish. Defensive listing covering all 10 linked packages so the bump is genuinely lockstep.
  - `scripts/release-publish.sh` handles the npm "Cannot implicitly apply latest tag to a version lower than current latest" case by publishing under a staging tag and then explicitly moving `latest` via `npm dist-tag add`.

  **Docs (shipping with the release):**

  - New READMEs for `packages/log`, `packages/next`, `packages/node-runtime`.
  - New `VISION.md` (three nested mission directions) and `docs/troubleshooting.md`.
  - `ARCHITECTURE.md` — new section explaining server-side sessionId resolution chain (ALS → adapter provider → orphan).
  - `ROADMAP.md` reframed around the three mission directions.

- Updated dependencies [74be490]
  - @harness-fe/protocol@1.0.2

## 1.0.0

### Minor Changes

- 2019214: Version alignment: reset `@harness-fe/log` and `@harness-fe/next` to the 0.9.x line, locking all core packages together via `linked` in `.changeset/config.json`

  Background: `@harness-fe/log`'s initial Changesets minor bump took it to **1.0.0** (Changesets treats brand-new packages as starting at 1.0.0 unless explicitly minor-bumped from a prior 0.x), then the next minor pushed it to 2.0.0 — leaving the rest of the ecosystem at 0.6–0.9 while `log` and `next` (which transitively bumped) sat at 2.0. Functionally fine, but cosmetically off.

  With no public consumer of this package yet, accepting the inconvenience of a version downgrade is cheap. The previous `log@{1.0.0, 2.0.0, 2.0.1}` and `next@{1.0.0, 2.0.0}` releases will be deprecated on npmjs.com pointing to 0.9.x as the canonical line.

  This changeset bumps **every** core package by `minor` so they all land at the same 0.x.0 going forward, plus locks them via `linked` so future bumps stay in lockstep. Also includes the Turbopack-fix browser/node split for `@harness-fe/log` that was previously queued as a patch.

### Patch Changes

- Updated dependencies [2019214]
  - @harness-fe/protocol@1.0.0

## 0.7.2

### Patch Changes

- 0cd04d9: feat(log): new `@harness-fe/log` isomorphic logger package

  Introduces `@harness-fe/log` — a zero-config structured logger that works
  identically in Server Components, Route Handlers, Server Actions, Client
  Components, and shared utilities.

  - `log.info('msg', { meta })` from any environment lands in
    `~/.harness/data/sessions/{sid}/timeline.jsonl` as `t: 'app-log'`
  - Session identity is resolved fresh on every call (via React `cache()` /
    AsyncLocalStorage) — no cross-request contamination possible
  - No userId in payload — agents resolve user via `sessionId → visitor` lookup
  - Scope chaining: `log.scope('a').scope('b')` emits `scope='a.b'`
  - Silent on missing runtime (optional peer deps on node-runtime and runtime)

  **@harness-fe/node-runtime**: adds `reportAppLog()` method + `AppLogContext`
  type for the new explicit log path (distinct from auto-captured console).

  **@harness-fe/mcp-server**: adds `EventType = 'app-log'`, bridge now writes
  `t: 'app-log'` rows for `app.log` frames (previously would have stored `t:
'app.log'` — now consistent with `server-log` / `server-err` naming), and
  the dashboard renders app-log events with a distinct soft-purple tag.

## 0.7.1

### Patch Changes

- ff8cc7d: Fix: bridge now stamps `visitorId` on every event row

  Pre-fix, `~/.harness/data/sessions/{sid}/timeline.jsonl` rows carried `projectId` and `buildId` but not `visitorId`, even though the bridge knew the visitor identity from the peer's hello frame. As a result, agents could read the visitor's metadata (firstSeenAt / sessionCount / tabIds) and could enumerate the visitor's sessions via `visitor.journey`, but couldn't filter a single session's timeline rows to events from one specific visitor — important when the same session has parent + iframe child apps with separate visitors.

  The bridge now stamps `visitorId` from `frame.visitorId ?? peer.visitorId` on every `appendEvent` call. `StoreEvent.visitorId` is the new optional field.

## 0.7.0

### Minor Changes

- c4a1f59: feat: Edge Runtime HTTP transport (Phase 1)

  - `@harness-fe/protocol`: add `httpBatchSchema` / `HttpBatch` for stateless POST /events
  - `@harness-fe/mcp-server`: new `POST /events` + `GET /events/ping` HTTP endpoints; `Bridge.handleHttpBatch()` routes batches into the same session timeline as the WebSocket path
  - `@harness-fe/node-runtime`: `Transport` interface + `WsTransport` (existing behaviour) + `HttpBatchTransport` (fetch-based, 500ms flush, 50-event batching, 5xx retry, outbox cap); automatic selection via `NEXT_RUNTIME=edge` / `HARNESS_FE_TRANSPORT=http`; `ws` moved to optional peer dependency; new `./auto-edge` export
  - `@harness-fe/next`: webpack plugin injects `@harness-fe/node-runtime/auto-edge` into edge-runtime bundles (webworker target)

### Patch Changes

- c4a1f59: chore: remove pre-1.0 read-compat shims (Phase 2)

  **Breaking change for on-disk data older than v0.4:**

  - Removed `LegacyBuildSessionMeta` and `LegacyLoadMeta` types
  - Removed `TailOptions.loadId` and `SearchOptions.loadId` deprecated fields
  - Removed `_detectLegacyLayout()` — replaced by per-chunk stderr warning when a recording chunk lacks `chunkId`
  - Removed 8 `load: loadId` double-stamp fields from bridge event rows

  If you have on-disk data from a daemon older than v0.4, run `rm -rf ~/.harness/data` to start fresh.

- Updated dependencies [c4a1f59]
  - @harness-fe/protocol@0.7.0
