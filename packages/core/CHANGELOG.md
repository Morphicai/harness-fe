# @harness-fe/core

## 4.2.0

### Minor Changes

- 4daa7cf: Chunk-file session storage (#171) — replace the single per-session `timeline.jsonl` / `recording.jsonl` with rotating numbered chunk files and whole-file eviction.

  Each stream now shards into `sessions/{id}/timeline/NNNNNN.jsonl` and `sessions/{id}/recording/NNNNNN.jsonl`, rotating before a write would exceed a per-file threshold (timeline 8 MB, recording 16 MB) — so no single file approaches V8's ~512 MB string cap that wedged reads and auto-purge (#166/#160). Reads (tail/search/summary/listRecordings/sliceRecordings/markers) stream across the ordered file list; a legacy single file is read transparently as the oldest chunk (no migration pass). Retention now evicts whole oldest files: recording keeps age/count/byte caps with baseline-aware + marker-preserving rescue at file granularity, and timeline gains real intra-session trimming (drop oldest files past `maxTimelineBytesPerSession`/`maxTimelineChunksPerSession`, default 64 MB / 24 files) — keeping recent events instead of the old "drop new events" cap. `session.purge` exposes the new timeline keys. Behaviour behind `IStore` is unchanged; gateway/console/replay untouched.

## 4.1.2

### Patch Changes

- 608dacd: Stream `timeline.jsonl` reads + cap its size (#166 timeline sibling).

  4.1.1 fixed `recording.jsonl` but the event `timeline.jsonl` had the same flaw: `summary`, `search`, and `readMarkerTimestamps` read it whole-file via `readAllLines`. A chatty session can grow timeline.jsonl past V8's ~512 MB string cap (observed at 2.3 GB), which broke the console session-detail page AND — because `readMarkerTimestamps` runs inside purge for every session — aborted the entire auto-purge. Those three reads now stream line-by-line. Added a 384 MB per-session timeline ceiling at append time (in-memory byte counter, no per-event statSync), and isolated each session in the purge loop so one bad file can't wedge all retention.

## 4.1.1

### Patch Changes

- 9fd5d8d: Fix `Cannot create a string longer than 0x1fffffe8 characters` when reading large session recordings (#166).

  `listRecordings` / `sliceRecordings` / `pruneRecordingFile` read `recording.jsonl` whole-file via `readFileSync(_, 'utf-8')`, which throws once the file passes V8's ~512 MB string cap — leaving the session unreadable, unreplayable, and impossible to purge. They now stream the file line-by-line (fixed buffer + StringDecoder), so peak memory is one buffer + one line. Pruning also drops parsed events after computing the FullSnapshot flag to avoid OOM on huge files. Added a 384 MB append-time ceiling on a single session's recording so it can never reach the V8 cap again.

## 4.1.0

### Minor Changes

- 2a94faa: wujie/Electron issue cluster (#158–#162)

  - Unified `window.__HARNESS_FE__` injection behind a single builder so the Vite and webpack plugins no longer drift; webpack now injects `overlay`/`consent` too.
  - New build-time runtime knobs: `deferStart` (start after load + idle), `rrwebBlockSelector` (skip a subtree rrweb can't serialize, e.g. wujie's `wujie-app`), `idbThrottleMs` (sample IndexedDB telemetry), and `rrwebCheckoutEveryNms` (now reachable at build time).
  - First `hello.ack` no longer re-takes a FullSnapshot (the start() baseline is already delivered) — avoids serializing the DOM twice on first paint.
  - Recording retention default lowered to 30 min (`recordingRetentionMs`, configurable; legacy `recordingRetentionDays` still honored), and pruning is now baseline-aware so a short window stays replayable — the FullSnapshot the surviving chunks depend on is never evicted.
  - Console visibility fixes: a read token issued without an explicit `projects=` now sees all projects (the documented "undefined = all"); the session list no longer drops sessions whose project-owning participant is empty or not first (admin saw an empty list).

## 4.0.0

### Minor Changes

- b3ffe9d: Rebuild ① — introduce `@harness-fe/core`, the transport-agnostic backend.

  `core` is a pure library (no HTTP/WS server, binds no port): the `Principal`
  identity model + `canSee`/`canSeeProject`/`projectGrant` visibility (now with a
  `scopes` field so a write-only runtime client is denied every read/control
  capability), the JSONL session / task / memory stores, the session router,
  visitor timeline + replay export, a `Bridge` decoupled from the socket via the
  `PeerSocket` abstraction (`acceptPeer(socket, principal)`), a scope- and
  visibility-enforced capability API, and the `CoreClient` interface with its
  in-process implementation. The gateway will own the front door and drive core
  through `CoreClient`.

  This is the foundation step of the architecture rebuild; the old
  `daemon`/`mcp-server` packages are untouched and continue to work until the
  later steps wire the gateway on top and retire them.

- 2784158: Trusted-upstream caller identity (5.0 · P6 · C1) — the daemon can now honour a
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

- 6b01815: Project visibility default-deny (4.0 security gate) — a scoped gateway token
  (`token` / `forwarded`) with no explicit project grants can no longer enumerate
  or read projects through the unowned-data backward-compat path. `canSeeProject`
  now requires a scoped caller to actually own a project (its id in the owner
  chain); unowned/legacy rows are not enumerable by an unbound token. The
  `projectList` / `projectGet` / `projectTree` capabilities — previously unfiltered
  — now filter by visibility. `local` / `host` (unrestricted) callers and tokens
  with explicit project grants are unaffected; solo behaviour is unchanged.
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

- fa12ebb: Version observability — surface the running version in both the dashboard and
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

- 704fb71: Align the linked package group onto a single 4.0.0-next line.

  The gateway/console work only touched some packages, so changesets left the linked
  group split — `log`/`react-jsx` were still 3.x, `next`/`node-runtime` on older 4.0
  prereleases, while gateway/runtime/etc were at next.5. This is a version-only bump
  (no code change) so consumers (morphix, tanka) can install ONE consistent
  4.0.0-next.x set without mixing `@harness-fe/protocol` majors.

- 2453e70: **consent `deny` mode + 1 GiB storage cap**

  - Add `consent: 'deny'` mode — all control commands (`page.click`, `page.type`, etc.) are rejected immediately without any user prompt. Safe default for production deployments.
  - **Change default consent from `off` to `deny`**. Previously unguarded control commands ran freely unless `--governed` was passed; now control is disabled by default and must be explicitly enabled.
  - Add `maxTotalBytes` to `RetentionPolicy` (default 1 GiB). After all other pruning passes, oldest sessions are evicted until the data directory falls below the cap.
  - Add `HARNESS_MAX_STORAGE_BYTES` environment variable and `--max-storage-bytes` support. Override the cap with `-e HARNESS_MAX_STORAGE_BYTES=<bytes>` in Docker. Set to `0` to disable.
  - Docker image now sets `ENV HARNESS_MAX_STORAGE_BYTES=1073741824` (1 GiB) by default.

- Updated dependencies [704fb71]
- Updated dependencies [706ef1b]
- Updated dependencies [7274a6c]
- Updated dependencies [7042d17]
- Updated dependencies [2453e70]
- Updated dependencies [344f806]
  - @harness-fe/protocol@4.0.0

## 4.0.0-next.12

### Patch Changes

- 2453e70: **consent `deny` mode + 1 GiB storage cap**

  - Add `consent: 'deny'` mode — all control commands (`page.click`, `page.type`, etc.) are rejected immediately without any user prompt. Safe default for production deployments.
  - **Change default consent from `off` to `deny`**. Previously unguarded control commands ran freely unless `--governed` was passed; now control is disabled by default and must be explicitly enabled.
  - Add `maxTotalBytes` to `RetentionPolicy` (default 1 GiB). After all other pruning passes, oldest sessions are evicted until the data directory falls below the cap.
  - Add `HARNESS_MAX_STORAGE_BYTES` environment variable and `--max-storage-bytes` support. Override the cap with `-e HARNESS_MAX_STORAGE_BYTES=<bytes>` in Docker. Set to `0` to disable.
  - Docker image now sets `ENV HARNESS_MAX_STORAGE_BYTES=1073741824` (1 GiB) by default.

- Updated dependencies [2453e70]
  - @harness-fe/protocol@4.0.0-next.12

## 4.0.0-next.8

### Patch Changes

- Updated dependencies [7274a6c]
  - @harness-fe/protocol@4.0.0-next.8

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

## 4.0.0-next.5

### Minor Changes

- 2fa80f1: Rebuild ① — introduce `@harness-fe/core`, the transport-agnostic backend.

  `core` is a pure library (no HTTP/WS server, binds no port): the `Principal`
  identity model + `canSee`/`canSeeProject`/`projectGrant` visibility (now with a
  `scopes` field so a write-only runtime client is denied every read/control
  capability), the JSONL session / task / memory stores, the session router,
  visitor timeline + replay export, a `Bridge` decoupled from the socket via the
  `PeerSocket` abstraction (`acceptPeer(socket, principal)`), a scope- and
  visibility-enforced capability API, and the `CoreClient` interface with its
  in-process implementation. The gateway will own the front door and drive core
  through `CoreClient`.

  This is the foundation step of the architecture rebuild; the old
  `daemon`/`mcp-server` packages are untouched and continue to work until the
  later steps wire the gateway on top and retire them.
