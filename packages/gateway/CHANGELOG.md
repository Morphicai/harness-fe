# @harness-fe/gateway

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
