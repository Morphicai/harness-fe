# @harness-fe/gateway

## 4.1.1

### Patch Changes

- Updated dependencies [9fd5d8d]
  - @harness-fe/core@4.1.1

## 4.1.0

### Patch Changes

- 2a94faa: wujie/Electron issue cluster (#158–#162)

  - Unified `window.__HARNESS_FE__` injection behind a single builder so the Vite and webpack plugins no longer drift; webpack now injects `overlay`/`consent` too.
  - New build-time runtime knobs: `deferStart` (start after load + idle), `rrwebBlockSelector` (skip a subtree rrweb can't serialize, e.g. wujie's `wujie-app`), `idbThrottleMs` (sample IndexedDB telemetry), and `rrwebCheckoutEveryNms` (now reachable at build time).
  - First `hello.ack` no longer re-takes a FullSnapshot (the start() baseline is already delivered) — avoids serializing the DOM twice on first paint.
  - Recording retention default lowered to 30 min (`recordingRetentionMs`, configurable; legacy `recordingRetentionDays` still honored), and pruning is now baseline-aware so a short window stays replayable — the FullSnapshot the surviving chunks depend on is never evicted.
  - Console visibility fixes: a read token issued without an explicit `projects=` now sees all projects (the documented "undefined = all"); the session list no longer drops sessions whose project-owning participant is empty or not first (admin saw an empty list).

- Updated dependencies [2a94faa]
  - @harness-fe/core@4.1.0

## 4.0.0

### Minor Changes

- 706ef1b: Browser Consent (4.0 · P2) — control commands now require in-page user
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

- 7274a6c: New browser interaction commands, consent UI, overlay option, and full file upload pipeline.

  **New MCP tools (all control-scoped)**

  - `page.upload` — inject files into `<input type="file">` via DataTransfer; files provided as base64 by the agent
  - `page.select` — set `<select>` value and fire change/input events
  - `page.check` — set checkbox/radio `.checked` and fire change/input events
  - `page.paste` — dispatch ClipboardEvent with synthetic clipboard data (fire-and-forget, no dialog)
  - `page.set_dialog_handler` — pre-register return values for agent-triggered `alert`/`confirm`/`prompt` (read-scope)

  **Consent UI (runtime-only, modern design)**

  - New plugin option `consent?: 'off' | 'session' | 'always'` on `harnessFE()` / `<HarnessScript>`
  - Plugin config takes priority over gateway `hello.ack`; gateway/CLI unchanged
  - Permanent grant stored in `localStorage.__hfe_consent_grant__:<projectId>`; survives page refresh
  - Rebuilt consent panel: blur backdrop + card UI, four buttons (始终允许 / 本次会话 / 仅此次 / 拒绝)
  - Fixed: consent panel now shows `page.click(#submit-btn)` instead of `page.click([object Object])`

  **Overlay hide option**

  - New plugin option `overlay?: boolean` (default `true`) on `harnessFE()` / `<HarnessScript>`
  - `overlay: false` hides the "H" floating icon; data capture is unaffected

  **Sandbox: dialogs channel**

  - New `dialogs` sandbox channel intercepts `alert` / `confirm` / `prompt` / `print` / `beforeunload`
  - Only intercepts when agent is in progress (`__hfe_agent_in_progress__` flag); user calls pass through unchanged

  **Sandbox: forms channel**

  - New `forms` sandbox channel covers the full file upload pipeline to backend:
    - `HTMLInputElement.prototype.click` (file inputs): suppresses native picker when agent-triggered
    - `window.FormData` constructor: injects `__hfe_injected_files__` so `new FormData(form)` + fetch sends real files
    - `HTMLFormElement.prototype.submit`: converts to fetch when agent has injected files; fallback to native on error
  - `page.upload` sets `__hfe_injected_files__` on the input element (auto-cleared after 60s)

- 7042d17: Caller identity (4.0 · P1) — the auth boundary now carries _who_, not just
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

- 8938c30: Command-target scoping (4.0 · A) — an agent's commands only drive tabs it may
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

- 090dd46: Console: revive the rich dashboard UI on the new gateway.

  The console data face was a thin MVP; bring back the proven dashboard experience
  (project list, session detail with logs / timeline / rrweb replay, live-status
  header) on top of the gateway's in-process core:

  - **gateway `/console/api/*`** now serves the full data contract the dashboard
    expects — `meta`, `projects` ({project, recentSessions}), `sessions`,
    `sessions/:id` ({session, summary, chunks, timeline, exports}), and
    `POST sessions/:id/replay` (via `createReplayExport`). Reads go straight to the
    in-process store (the authenticated operator sees everything).
  - **console-ui** recovers the dashboard's `ProjectList` / `SessionDetail` /
    `Header` / hooks / styling and repoints them at `/console/api/*` and the
    gateway `/ws` (live `dashboard.update` feed). The governance face
    (tokens / servers / audit) stays as a second tab in the shared header.

  Deep links use `/console/sessions/:id` (the runtime overlay's "open dashboard"
  button + `deriveDashboardUrl` aligned). Known limitation: the live WS feed needs
  a write-scope socket, so under the Governed policy the operator console falls
  back to manual refresh (Solo gets live updates).

- 20e8f0b: Console data API: scope by the caller's identity, and add a system-acceptance e2e.

  - **Scoped `/console/api/*`** — the data face now resolves a principal and filters
    by it: an **agent token** sees only the projects it's bound to (read scope
    required; write-only → 403), an **admin session** sees everything, solo (Open)
    sees all, and a Governed request with no credential is rejected (401). Sessions
    outside a token's projects return 404 (no existence leak). The admin session
    cookie is now `Path=/` so it also authenticates the console data API;
    `createAdminHandler` returns `{ handle, isAuthed }`.
  - **`system.e2e.test.ts`** — one governed gateway + in-process core exercised
    through real clients across every surface, so a green run means the product
    wires up without a manual demo: MCP (agentA drives, agentB read-only denied,
    no-token 401, audited), `/ws` upload (a write-token runtime's event lands in
    the store), `/console` (token-scoped vs admin-all vs 401), and `/admin` API
    gating.

- db9751f: Console: a real sign-in, a clean empty state, and an overlay shortcut that isn't an auth grant.

  - **Sign-in entry** — the console now has a unified sign-in: an **agent read token**
    (pasted, kept in sessionStorage, sent as Bearer → scoped to the token's projects)
    or an **admin** session (sees all). Under Open (solo) no sign-in is needed.
    New `GET /console/api/whoami` reports `{ mode, authenticated, kind, projects }`
    (never 401s) so the SPA gates on it.
  - **No more weird empty `/`** — a Governed viewer with no credential gets the
    sign-in screen instead of a raw 401; authenticated/Open viewers get the data.
  - **Overlay = pure shortcut** — `deriveDashboardUrl` no longer appends the
    runtime token; the "open dashboard" button is plain navigation to
    `/console/sessions/:id`. The viewer authorizes in the console itself (the
    runtime's write token could never read anyway). The console credential is read
    from sessionStorage, never the URL.

- fa12ebb: Gateway CLI launcher — `@harness-fe/gateway` ships a `harness-gateway` bin, so
  the governance gateway can run as a standalone process (it was library-only
  before, which meant it couldn't actually be deployed).

  ```
  harness-gateway --port 47950 \
    --admin-user admin --admin-pass secret \
    --add-server name=team,endpoint=http://127.0.0.1:47900,token=DAEMON_SECRET \
    --issue-token name=agentA,server=team,scopes=read+control
  ```

  - `--add-server` registers an upstream daemon (idempotent by name).
  - `--issue-token` mints a scoped gateway token and prints it once.
  - `--admin-user/--admin-pass` bootstraps the first admin (never clobbers an
    existing one); tokens/servers/audit are also manageable from the `/admin` panel.

  Verified end to end against a real daemon: scope-gated RBAC (a `read` token is
  denied `page.click`; a `read+control` token is forwarded), token→server routing,
  caller injection, audit logging, and a multi-user topology (multiple browsers →
  one central daemon → agents via the gateway). See examples/DEMO.md.

- b3ffe9d: Rebuild ② — the gateway becomes the only front door, embedding `@harness-fe/core`
  in-process instead of forwarding to a remote daemon.

  - `/mcp` — hosts the MCP server directly against the core capability API (no
    HTTP forwarding). The session's `Principal` is resolved through the Policy and
    baked in, so `tools/list` is the scoped manifest (a read-only token never even
    sees `page.*`) and every call re-checks scope in core. Calls are audited.
  - `/ws` — terminates the runtime WebSocket, resolves a write-scope principal,
    adapts the socket to core's `PeerSocket`, and hands it to `acceptPeer`.
  - `/events` — HTTP-batch ingest → `core.handleHttpBatch`.
  - `/console` — replay viewer + a capability-backed JSON data API + an SPA mount
    (the React console-ui lands in step ③). `/admin` governance panel kept.
  - **Policy**: `Open` (loopback solo — no tokens, no audit) | `Governed` (team
    tokens → scoped principal + project grants + audit). A `write` token is just a
    scoped gateway token, so a leaked browser token can never read or drive.
  - Auth + principal resolution now live in the gateway (`principal.ts` /
    `policy.ts`); core only consumes a resolved `Principal`.

  The old forwarding `createGateway({ store })` shape is replaced by
  `createGateway({ coreClient, policy, store })`. The old daemon / mcp-server /
  dev-cli packages are untouched and still work until the later steps retire them.

- 7df5b6f: Publish @harness-fe/gateway (5.0 · P6 · C6) — the governance gateway is now
  functionally complete and verified end-to-end, so it leaves `private`.

  End-to-end: a real daemon (createDaemon + token + HTTP MCP) behind the gateway;
  an MCP `initialize` flows agent → gateway → daemon — exercising routing,
  daemon-token auth, `x-harness-caller` injection, and `mcp-session-id`
  passthrough (fixed a gap where stateful MCP sessions weren't forwarded).

  Complete feature set: argon2-free scrypt token lifecycle, token→server
  routing + MCP forwarding, scope RBAC + dynamic manifest, append-only audit,
  and a plain-HTML admin panel. Zero native deps (JSON store + node:crypto).

- cd87c57: Per-call caller identity for MCP tools (4.0 · P4) — the MCP layer now
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

- 1ea47d1: Package split (5.0 · P5) — the monolithic `@harness-fe/gateway` is split
  into three packages along the architecture's layering, with **zero behaviour
  change** and **no user-facing breakage**.

  - **`@harness-fe/core`** (new) — the daemon core: capability API, event
    store, browser control, WS bridge, identity/auth/consent/scoping. Everything
    that touches data or the browser connection.
  - **`@harness-fe/gateway`** — now a thin MCP protocol layer
    (`createMcpServer` + stdio/HTTP transports + `createDaemon`), depending on
    `@harness-fe/core`. Re-exports daemon's public API so existing imports keep
    working; keeps a `harness-fe` bin shim that forwards to dev-cli.
  - **`@harness-fe/cli`** (new) — the solo-dev launcher (`harness-fe` bin):
    arg parsing, leader/follower, banner, open-browser. Glue over daemon +
    mcp-server.

  Layering is single-directional (`dev-cli → mcp-server → daemon`, no cycles).
  `createDaemon` stays in mcp-server (it orchestrates Bridge + MCP HTTP, so it
  can't live in daemon without a cycle). `openBrowser` lives in daemon (the
  `dashboard.open` tool needs it). Full suites green: daemon 282 + mcp-server 29
  = the pre-split 311, plus runtime-client 110 — zero regression.

- 13aeb1e: Project→agent binding — make the team (multi-user) path actually usable.

  Before this, a gateway token bound only to a _server_ (daemon), and the daemon
  isolated data by _who created each row_ (`createdBy`). In a team setup the
  runtime that creates a session and the agent that reads it are different
  principals, so `canSeeProject` filtered everything out: an agent through the
  gateway saw **zero** sessions and couldn't drive any tab (`creator ≠ consumer`).

  Now authorization is by **project membership**, injected end to end:

  - **gateway** — a token carries `projects` (`['*']` = all, or a specific list).
    `harness-gateway --issue-token name=…,server=…,scopes=…,projects=react-demo`.
    The proxy forwards the grants to the daemon via a new `x-harness-projects`
    header (companion to `x-harness-caller`); no list ⇒ `*`.
  - **daemon** — `Principal` gains `projects`; `identifyPrincipal` reads the
    forwarded grants. New `projectGrant(principal, projectId)` (local → all,
    explicit grants → membership, none → `null` = fall back to creator-based).
    `canSeeProject(principal, projectId, ownerChain)` and `findTab` (command-target
    scoping) honour grants first, then fall back to `createdBy` — so **solo /
    single-token behaviour is unchanged** while a bound agent sees a project's
    whole data set and can drive its tabs regardless of who created the data.

  Verified live through the gateway with a `projects=react-demo` token: the agent
  now lists react-demo sessions (was empty), is denied an un-granted project
  (`some-other-app` → empty), and `page.click` reaches the tab and triggers the
  browser consent gate (was unreachable). New unit tests cover `projectGrant` and
  the grant/fallback paths in `canSeeProject`.

- db373bc: Project→agent binding + host/sub-app tagging (4.0 · A) — tenant isolation now
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

- ded521b: Shared auto-spawn gateway + unified console sign-in.

  - **cli**: `harness serve` (headless shared gateway) and `harness mcp` (stdio↔http proxy) subcommands; default-locate `@harness-fe/console-ui` dist so `/console` serves the real UI with no `--console-dir`.
  - **ensureSharedGateway**: a dev server (vite/unplugin and native webpack) or the mcp launcher — whoever starts first — auto-spawns one shared Open gateway; the other end reuses it. Team (explicit token) never spawns.
  - **gateway**: `startMcpStdioProxy`; removed the server-rendered `/admin` + `/admin/login` HTML pages — sign-in unified at `/console`.
  - **console-ui**: sign-in takes effect without a hard reload; governance tab admin-only.
  - **demo**: `demo.sh` reclaims a stale harness gateway instead of refusing to start.

- 344f806: Task resolution back-link (4.0 · P7) — close the feedback loop from a reported
  problem to its fix and the re-test that proved it.

  - `Task` gains an optional `resolution` object: `{ type, commit, prUrl,
verificationSessionId, verifiedAt }` (`TaskResolution` / `TaskResolutionType`
    exported from protocol). `type` is one of `code-fix` / `config` / `wontfix` /
    `duplicate` / `cannot-reproduce`.
  - `tasks.resolve` accepts a `resolution` arg (after `note`). The daemon defaults
    `verifiedAt` to now when a `verificationSessionId` is supplied without one, and
    records the resolution in the persisted task event. Plain
    `tasks.resolve(id, note)` stays valid — fully backward compatible.
  - `bridge.resolveTask(id, note?, resolution?, principal?)` and the RemoteBridge
    RPC carry the resolution through leader/follower.
  - `@harness-fe/skill` Flow 5 is extended into the full loop: fix → re-drive the
    reported flow (replay to recall the steps, reproduce with `page_*`) → verify
    clean (`errors_tail` / `session_tail`) → `tasks.resolve` with the structured
    resolution.

  Scope: the daemon owns the data link (report → fix → verification session);
  the L1–L4 automation and git writeback remain agent/skill responsibilities,
  driven through harness tools + host git. Additive + optional throughout — no
  behaviour change for existing callers.

- 5303152: Tenant read-isolation for MCP list tools (4.0 · P3) — agents now only see the
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

### Patch Changes

- 704fb71: Align the linked package group onto a single 4.0.0-next line.

  The gateway/console work only touched some packages, so changesets left the linked
  group split — `log`/`react-jsx` were still 3.x, `next`/`node-runtime` on older 4.0
  prereleases, while gateway/runtime/etc were at next.5. This is a version-only bump
  (no code change) so consumers (morphix, tanka) can install ONE consistent
  4.0.0-next.x set without mixing `@harness-fe/protocol` majors.

- 21297dc: Fix two governance bugs that blocked the multi-agent (team) path, found while
  verifying the gateway end to end.

  - **mcp-server: MCP HTTP is now per-session.** It used a single shared
    transport+server created once at mount, so the _second_ `initialize` (a second
    agent through the gateway, or any reconnect) hit `-32600 "Server already
initialized"` and locked out everyone but the first client. Now each
    `mcp-session-id` gets its own transport+server (the spec's stateful model),
    created on initialize and torn down on close; unknown session ids are rejected
    with 400. Multiple agents can now share one daemon concurrently.
  - **gateway: dynamic manifest filtering now works over SSE.** `tools/list`
    replies come back as `text/event-stream`, and the proxy only filtered plain
    JSON — so a `read`-only token still saw every `control` tool (`page.click`,
    `page.type`, …). The proxy now rewrites the JSON-RPC payload inside each
    SSE `data:` line. Verified live: a `read` token's manifest drops from 11
    `page.*` tools to 2 (the read-only `page.dom_query` / `page.screenshot`),
    while `read,control` keeps all 11.

  Both are bug fixes — no API change. Covered by a new per-session regression test
  (two concurrent initializes get distinct session ids) plus the existing
  filterManifest unit tests; manifest-over-SSE was confirmed with a live two-token
  client run through the gateway.

- Updated dependencies [704fb71]
- Updated dependencies [706ef1b]
- Updated dependencies [7274a6c]
- Updated dependencies [7042d17]
- Updated dependencies [2453e70]
- Updated dependencies [b3ffe9d]
- Updated dependencies [2784158]
- Updated dependencies [1ea47d1]
- Updated dependencies [13aeb1e]
- Updated dependencies [6b01815]
- Updated dependencies [344f806]
- Updated dependencies [fa12ebb]
  - @harness-fe/protocol@4.0.0
  - @harness-fe/core@4.0.0

## 4.0.0-next.12

### Patch Changes

- Updated dependencies [2453e70]
  - @harness-fe/protocol@4.0.0-next.12
  - @harness-fe/core@4.0.0-next.12

## 4.0.0-next.8

### Minor Changes

- 7274a6c: New browser interaction commands, consent UI, overlay option, and full file upload pipeline.

  **New MCP tools (all control-scoped)**

  - `page.upload` — inject files into `<input type="file">` via DataTransfer; files provided as base64 by the agent
  - `page.select` — set `<select>` value and fire change/input events
  - `page.check` — set checkbox/radio `.checked` and fire change/input events
  - `page.paste` — dispatch ClipboardEvent with synthetic clipboard data (fire-and-forget, no dialog)
  - `page.set_dialog_handler` — pre-register return values for agent-triggered `alert`/`confirm`/`prompt` (read-scope)

  **Consent UI (runtime-only, modern design)**

  - New plugin option `consent?: 'off' | 'session' | 'always'` on `harnessFE()` / `<HarnessScript>`
  - Plugin config takes priority over gateway `hello.ack`; gateway/CLI unchanged
  - Permanent grant stored in `localStorage.__hfe_consent_grant__:<projectId>`; survives page refresh
  - Rebuilt consent panel: blur backdrop + card UI, four buttons (始终允许 / 本次会话 / 仅此次 / 拒绝)
  - Fixed: consent panel now shows `page.click(#submit-btn)` instead of `page.click([object Object])`

  **Overlay hide option**

  - New plugin option `overlay?: boolean` (default `true`) on `harnessFE()` / `<HarnessScript>`
  - `overlay: false` hides the "H" floating icon; data capture is unaffected

  **Sandbox: dialogs channel**

  - New `dialogs` sandbox channel intercepts `alert` / `confirm` / `prompt` / `print` / `beforeunload`
  - Only intercepts when agent is in progress (`__hfe_agent_in_progress__` flag); user calls pass through unchanged

  **Sandbox: forms channel**

  - New `forms` sandbox channel covers the full file upload pipeline to backend:
    - `HTMLInputElement.prototype.click` (file inputs): suppresses native picker when agent-triggered
    - `window.FormData` constructor: injects `__hfe_injected_files__` so `new FormData(form)` + fetch sends real files
    - `HTMLFormElement.prototype.submit`: converts to fetch when agent has injected files; fallback to native on error
  - `page.upload` sets `__hfe_injected_files__` on the input element (auto-cleared after 60s)

### Patch Changes

- Updated dependencies [7274a6c]
  - @harness-fe/protocol@4.0.0-next.8
  - @harness-fe/core@4.0.0-next.8

## 4.0.0-next.6

### Patch Changes

- 46775be: Align the linked package group onto a single 4.0.0-next line.

  The gateway/console work only touched some packages, so changesets left the linked
  group split — `log`/`react-jsx` were still 3.x, `next`/`node-runtime` on older 4.0
  prereleases, while gateway/runtime/etc were at next.5. This is a version-only bump
  (no code change) so consumers (morphix, tanka) can install ONE consistent
  4.0.0-next.x set without mixing `@harness-fe/protocol` majors.

- Updated dependencies [46775be]
  - @harness-fe/protocol@4.0.0-next.6
  - @harness-fe/core@4.0.0-next.6

## 4.0.0-next.5

### Minor Changes

- c03d01c: Console: revive the rich dashboard UI on the new gateway.

  The console data face was a thin MVP; bring back the proven dashboard experience
  (project list, session detail with logs / timeline / rrweb replay, live-status
  header) on top of the gateway's in-process core:

  - **gateway `/console/api/*`** now serves the full data contract the dashboard
    expects — `meta`, `projects` ({project, recentSessions}), `sessions`,
    `sessions/:id` ({session, summary, chunks, timeline, exports}), and
    `POST sessions/:id/replay` (via `createReplayExport`). Reads go straight to the
    in-process store (the authenticated operator sees everything).
  - **console-ui** recovers the dashboard's `ProjectList` / `SessionDetail` /
    `Header` / hooks / styling and repoints them at `/console/api/*` and the
    gateway `/ws` (live `dashboard.update` feed). The governance face
    (tokens / servers / audit) stays as a second tab in the shared header.

  Deep links use `/console/sessions/:id` (the runtime overlay's "open dashboard"
  button + `deriveDashboardUrl` aligned). Known limitation: the live WS feed needs
  a write-scope socket, so under the Governed policy the operator console falls
  back to manual refresh (Solo gets live updates).

- 20c0a85: Console data API: scope by the caller's identity, and add a system-acceptance e2e.

  - **Scoped `/console/api/*`** — the data face now resolves a principal and filters
    by it: an **agent token** sees only the projects it's bound to (read scope
    required; write-only → 403), an **admin session** sees everything, solo (Open)
    sees all, and a Governed request with no credential is rejected (401). Sessions
    outside a token's projects return 404 (no existence leak). The admin session
    cookie is now `Path=/` so it also authenticates the console data API;
    `createAdminHandler` returns `{ handle, isAuthed }`.
  - **`system.e2e.test.ts`** — one governed gateway + in-process core exercised
    through real clients across every surface, so a green run means the product
    wires up without a manual demo: MCP (agentA drives, agentB read-only denied,
    no-token 401, audited), `/ws` upload (a write-token runtime's event lands in
    the store), `/console` (token-scoped vs admin-all vs 401), and `/admin` API
    gating.

- 68e4785: Console: a real sign-in, a clean empty state, and an overlay shortcut that isn't an auth grant.

  - **Sign-in entry** — the console now has a unified sign-in: an **agent read token**
    (pasted, kept in sessionStorage, sent as Bearer → scoped to the token's projects)
    or an **admin** session (sees all). Under Open (solo) no sign-in is needed.
    New `GET /console/api/whoami` reports `{ mode, authenticated, kind, projects }`
    (never 401s) so the SPA gates on it.
  - **No more weird empty `/`** — a Governed viewer with no credential gets the
    sign-in screen instead of a raw 401; authenticated/Open viewers get the data.
  - **Overlay = pure shortcut** — `deriveDashboardUrl` no longer appends the
    runtime token; the "open dashboard" button is plain navigation to
    `/console/sessions/:id`. The viewer authorizes in the console itself (the
    runtime's write token could never read anyway). The console credential is read
    from sessionStorage, never the URL.

- 2fa80f1: Rebuild ② — the gateway becomes the only front door, embedding `@harness-fe/core`
  in-process instead of forwarding to a remote daemon.

  - `/mcp` — hosts the MCP server directly against the core capability API (no
    HTTP forwarding). The session's `Principal` is resolved through the Policy and
    baked in, so `tools/list` is the scoped manifest (a read-only token never even
    sees `page.*`) and every call re-checks scope in core. Calls are audited.
  - `/ws` — terminates the runtime WebSocket, resolves a write-scope principal,
    adapts the socket to core's `PeerSocket`, and hands it to `acceptPeer`.
  - `/events` — HTTP-batch ingest → `core.handleHttpBatch`.
  - `/console` — replay viewer + a capability-backed JSON data API + an SPA mount
    (the React console-ui lands in step ③). `/admin` governance panel kept.
  - **Policy**: `Open` (loopback solo — no tokens, no audit) | `Governed` (team
    tokens → scoped principal + project grants + audit). A `write` token is just a
    scoped gateway token, so a leaked browser token can never read or drive.
  - Auth + principal resolution now live in the gateway (`principal.ts` /
    `policy.ts`); core only consumes a resolved `Principal`.

  The old forwarding `createGateway({ store })` shape is replaced by
  `createGateway({ coreClient, policy, store })`. The old daemon / mcp-server /
  dev-cli packages are untouched and still work until the later steps retire them.

- c7736ab: Shared auto-spawn gateway + unified console sign-in.

  - **cli**: `harness serve` (headless shared gateway) and `harness mcp` (stdio↔http proxy) subcommands; default-locate `@harness-fe/console-ui` dist so `/console` serves the real UI with no `--console-dir`.
  - **ensureSharedGateway**: a dev server (vite/unplugin and native webpack) or the mcp launcher — whoever starts first — auto-spawns one shared Open gateway; the other end reuses it. Team (explicit token) never spawns.
  - **gateway**: `startMcpStdioProxy`; removed the server-rendered `/admin` + `/admin/login` HTML pages — sign-in unified at `/console`.
  - **console-ui**: sign-in takes effect without a hard reload; governance tab admin-only.
  - **demo**: `demo.sh` reclaims a stale harness gateway instead of refusing to start.

### Patch Changes

- Updated dependencies [2fa80f1]
  - @harness-fe/core@4.0.0-next.5

## 4.0.0-next.4

### Minor Changes

- dbaf5ad: Gateway CLI launcher — `@harness-fe/gateway` ships a `harness-gateway` bin, so
  the governance gateway can run as a standalone process (it was library-only
  before, which meant it couldn't actually be deployed).

  ```
  harness-gateway --port 47950 \
    --admin-user admin --admin-pass secret \
    --add-server name=team,endpoint=http://127.0.0.1:47900,token=DAEMON_SECRET \
    --issue-token name=agentA,server=team,scopes=read+control
  ```

  - `--add-server` registers an upstream daemon (idempotent by name).
  - `--issue-token` mints a scoped gateway token and prints it once.
  - `--admin-user/--admin-pass` bootstraps the first admin (never clobbers an
    existing one); tokens/servers/audit are also manageable from the `/admin` panel.

  Verified end to end against a real daemon: scope-gated RBAC (a `read` token is
  denied `page.click`; a `read+control` token is forwarded), token→server routing,
  caller injection, audit logging, and a multi-user topology (multiple browsers →
  one central daemon → agents via the gateway). See examples/DEMO.md.

- 59d8248: Project→agent binding — make the team (multi-user) path actually usable.

  Before this, a gateway token bound only to a _server_ (daemon), and the daemon
  isolated data by _who created each row_ (`createdBy`). In a team setup the
  runtime that creates a session and the agent that reads it are different
  principals, so `canSeeProject` filtered everything out: an agent through the
  gateway saw **zero** sessions and couldn't drive any tab (`creator ≠ consumer`).

  Now authorization is by **project membership**, injected end to end:

  - **gateway** — a token carries `projects` (`['*']` = all, or a specific list).
    `harness-gateway --issue-token name=…,server=…,scopes=…,projects=react-demo`.
    The proxy forwards the grants to the daemon via a new `x-harness-projects`
    header (companion to `x-harness-caller`); no list ⇒ `*`.
  - **daemon** — `Principal` gains `projects`; `identifyPrincipal` reads the
    forwarded grants. New `projectGrant(principal, projectId)` (local → all,
    explicit grants → membership, none → `null` = fall back to creator-based).
    `canSeeProject(principal, projectId, ownerChain)` and `findTab` (command-target
    scoping) honour grants first, then fall back to `createdBy` — so **solo /
    single-token behaviour is unchanged** while a bound agent sees a project's
    whole data set and can drive its tabs regardless of who created the data.

  Verified live through the gateway with a `projects=react-demo` token: the agent
  now lists react-demo sessions (was empty), is denied an un-granted project
  (`some-other-app` → empty), and `page.click` reaches the tab and triggers the
  browser consent gate (was unreachable). New unit tests cover `projectGrant` and
  the grant/fallback paths in `canSeeProject`.

### Patch Changes

- 95d9b56: Fix two governance bugs that blocked the multi-agent (team) path, found while
  verifying the gateway end to end.

  - **mcp-server: MCP HTTP is now per-session.** It used a single shared
    transport+server created once at mount, so the _second_ `initialize` (a second
    agent through the gateway, or any reconnect) hit `-32600 "Server already
initialized"` and locked out everyone but the first client. Now each
    `mcp-session-id` gets its own transport+server (the spec's stateful model),
    created on initialize and torn down on close; unknown session ids are rejected
    with 400. Multiple agents can now share one daemon concurrently.
  - **gateway: dynamic manifest filtering now works over SSE.** `tools/list`
    replies come back as `text/event-stream`, and the proxy only filtered plain
    JSON — so a `read`-only token still saw every `control` tool (`page.click`,
    `page.type`, …). The proxy now rewrites the JSON-RPC payload inside each
    SSE `data:` line. Verified live: a `read` token's manifest drops from 11
    `page.*` tools to 2 (the read-only `page.dom_query` / `page.screenshot`),
    while `read,control` keeps all 11.

  Both are bug fixes — no API change. Covered by a new per-session regression test
  (two concurrent initializes get distinct session ids) plus the existing
  filterManifest unit tests; manifest-over-SSE was confirmed with a live two-token
  client run through the gateway.

- Updated dependencies [25a6106]
  - @harness-fe/protocol@4.0.0-next.4

## 4.0.0-next.3

### Minor Changes

- 44a7cc7: Publish @harness-fe/gateway (5.0 · P6 · C6) — the governance gateway is now
  functionally complete and verified end-to-end, so it leaves `private`.

  End-to-end: a real daemon (createDaemon + token + HTTP MCP) behind the gateway;
  an MCP `initialize` flows agent → gateway → daemon — exercising routing,
  daemon-token auth, `x-harness-caller` injection, and `mcp-session-id`
  passthrough (fixed a gap where stateful MCP sessions weren't forwarded).

  Complete feature set: argon2-free scrypt token lifecycle, token→server
  routing + MCP forwarding, scope RBAC + dynamic manifest, append-only audit,
  and a plain-HTML admin panel. Zero native deps (JSON store + node:crypto).
