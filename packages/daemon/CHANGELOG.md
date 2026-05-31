# @harness-fe/daemon

## 4.0.0-next.4

### Minor Changes

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

- 25a6106: Task resolution back-link (4.0 · P7) — close the feedback loop from a reported
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

- dbaf5ad: Version observability — surface the running version in both the dashboard and
  the in-page overlay, so you can tell at a glance which build is live.

  - **daemon** exposes `GET /api/meta` → `{ daemonVersion, protocolVersion }`
    (read from its own package.json at module load).
  - **dashboard-ui** header shows a `v<daemonVersion>` badge (protocol version on
    hover).
  - **runtime** overlay info card gains a `version` row showing the injected
    runtime's real version.
  - **Fix:** the runtime's `VERSION` was a hand-maintained constant stuck at
    `3.3.0` while the package was `4.0.0-next.x`. It is now generated from
    package.json at build time (`scripts/gen-version.mjs` → `src/version.ts`), so
    it can never drift again.

  Additive only — no behaviour change for existing callers.

### Patch Changes

- Updated dependencies [25a6106]
- Updated dependencies [dbaf5ad]
  - @harness-fe/protocol@4.0.0-next.4
  - @harness-fe/dashboard-ui@0.3.0-next.0

## 4.0.0-next.3

### Minor Changes

- 1e00293: Trusted-upstream caller identity (5.0 · P6 · C1) — the daemon can now honour a
  caller identity forwarded by a trusted upstream (the gateway).

  `identifyPrincipal` checks the `x-harness-caller` header (exported as
  `FORWARDED_CALLER_HEADER`) and, when present on an **auth-enabled** request,
  resolves to a `forwarded` principal with that id. Only the gateway holds a
  valid credential to clear auth, so only it can forward an identity; on loopback
  (no auth) the header is ignored, so an unauthenticated client cannot spoof a
  caller. This lets the upcoming gateway map `token → identity` and proxy MCP to
  the daemon while preserving per-call tenant isolation.

  Zero behaviour change without a gateway: no `x-harness-caller` header → the
  existing token/local resolution is unchanged.

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
