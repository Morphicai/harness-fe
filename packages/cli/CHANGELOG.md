# @harness-fe/cli

## 4.2.0

### Patch Changes

- Updated dependencies [4daa7cf]
  - @harness-fe/core@4.2.0
  - @harness-fe/gateway@4.2.0

## 4.1.2

### Patch Changes

- Updated dependencies [608dacd]
  - @harness-fe/core@4.1.2
  - @harness-fe/gateway@4.1.2

## 4.1.1

### Patch Changes

- Updated dependencies [9fd5d8d]
  - @harness-fe/core@4.1.1
  - @harness-fe/gateway@4.1.1

## 4.1.0

### Patch Changes

- Updated dependencies [2a94faa]
  - @harness-fe/core@4.1.0
  - @harness-fe/gateway@4.1.0

## 4.0.0

### Minor Changes

- b3ffe9d: Rebuild ④ — introduce `@harness-fe/cli`, the single launcher (`harness`).

  - `harness` (solo, zero-config): Open policy. Boots an in-process core + a
    loopback gateway (serving `/ws` for the browser runtime and `/console`) and an
    MCP server over **stdio** for the agent that spawned it. This is what an
    `mcp.json` `command` points at — no tokens, no audit.
  - `harness --governed` (team): Governed policy over HTTP — `/mcp` (agents, RBAC +
    audit), `/ws` (write tokens), `/console` + `/admin`. Bootstraps an admin and
    issues tokens from flags.

  Replaces `@harness-fe/cli` (retired in the final step). Multi-window solo
  (several IDE windows sharing one core via leader/follower) needs the remote
  CoreClient and is intentionally deferred — run one solo instance per machine.

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

- ded521b: Shared auto-spawn gateway + unified console sign-in.

  - **cli**: `harness serve` (headless shared gateway) and `harness mcp` (stdio↔http proxy) subcommands; default-locate `@harness-fe/console-ui` dist so `/console` serves the real UI with no `--console-dir`.
  - **ensureSharedGateway**: a dev server (vite/unplugin and native webpack) or the mcp launcher — whoever starts first — auto-spawns one shared Open gateway; the other end reuses it. Team (explicit token) never spawns.
  - **gateway**: `startMcpStdioProxy`; removed the server-rendered `/admin` + `/admin/login` HTML pages — sign-in unified at `/console`.
  - **console-ui**: sign-in takes effect without a hard reload; governance tab admin-only.
  - **demo**: `demo.sh` reclaims a stale harness gateway instead of refusing to start.

### Patch Changes

- 704fb71: Align the linked package group onto a single 4.0.0-next line.

  The gateway/console work only touched some packages, so changesets left the linked
  group split — `log`/`react-jsx` were still 3.x, `next`/`node-runtime` on older 4.0
  prereleases, while gateway/runtime/etc were at next.5. This is a version-only bump
  (no code change) so consumers (morphix, tanka) can install ONE consistent
  4.0.0-next.x set without mixing `@harness-fe/protocol` majors.

- bd3e306: fix(cli): forward --experimental-env-var to spawned shared gateway

  `harness mcp --experimental-env-var HARNESS_FE_ENABLE` was silently ignored:
  the flag was parsed but never passed to `ensureSharedGateway`, so the spawned
  `harness serve` process started without the gate — experimental tools were
  always enabled regardless of the env var. Adds `experimentalEnvVar` to
  `EnsureSharedGatewayOptions` and appends `--experimental-env-var` to the
  spawn args when provided.

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
- Updated dependencies [8938c30]
- Updated dependencies [2453e70]
- Updated dependencies [090dd46]
- Updated dependencies [20e8f0b]
- Updated dependencies [db9751f]
- Updated dependencies [b3ffe9d]
- Updated dependencies [b3ffe9d]
- Updated dependencies [2784158]
- Updated dependencies [fa12ebb]
- Updated dependencies [b3ffe9d]
- Updated dependencies [7df5b6f]
- Updated dependencies [21297dc]
- Updated dependencies [cd87c57]
- Updated dependencies [1ea47d1]
- Updated dependencies [13aeb1e]
- Updated dependencies [db373bc]
- Updated dependencies [6b01815]
- Updated dependencies [ded521b]
- Updated dependencies [344f806]
- Updated dependencies [5303152]
- Updated dependencies [fa12ebb]
  - @harness-fe/protocol@4.0.0
  - @harness-fe/core@4.0.0
  - @harness-fe/console-ui@4.0.0
  - @harness-fe/gateway@4.0.0

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
  - @harness-fe/core@4.0.0-next.12
  - @harness-fe/gateway@4.0.0-next.12

## 4.0.0-next.11

### Patch Changes

- bd3e306: fix(cli): forward --experimental-env-var to spawned shared gateway

  `harness mcp --experimental-env-var HARNESS_FE_ENABLE` was silently ignored:
  the flag was parsed but never passed to `ensureSharedGateway`, so the spawned
  `harness serve` process started without the gate — experimental tools were
  always enabled regardless of the env var. Adds `experimentalEnvVar` to
  `EnsureSharedGatewayOptions` and appends `--experimental-env-var` to the
  spawn args when provided.

## 4.0.0-next.8

### Patch Changes

- Updated dependencies [7274a6c]
  - @harness-fe/protocol@4.0.0-next.8
  - @harness-fe/gateway@4.0.0-next.8
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
  - @harness-fe/console-ui@4.0.0-next.6
  - @harness-fe/gateway@4.0.0-next.6

## 4.0.0-next.5

### Minor Changes

- 2fa80f1: Rebuild ④ — introduce `@harness-fe/cli`, the single launcher (`harness`).

  - `harness` (solo, zero-config): Open policy. Boots an in-process core + a
    loopback gateway (serving `/ws` for the browser runtime and `/console`) and an
    MCP server over **stdio** for the agent that spawned it. This is what an
    `mcp.json` `command` points at — no tokens, no audit.
  - `harness --governed` (team): Governed policy over HTTP — `/mcp` (agents, RBAC +
    audit), `/ws` (write tokens), `/console` + `/admin`. Bootstraps an admin and
    issues tokens from flags.

  Replaces `@harness-fe/cli` (retired in the final step). Multi-window solo
  (several IDE windows sharing one core via leader/follower) needs the remote
  CoreClient and is intentionally deferred — run one solo instance per machine.

- c7736ab: Shared auto-spawn gateway + unified console sign-in.

  - **cli**: `harness serve` (headless shared gateway) and `harness mcp` (stdio↔http proxy) subcommands; default-locate `@harness-fe/console-ui` dist so `/console` serves the real UI with no `--console-dir`.
  - **ensureSharedGateway**: a dev server (vite/unplugin and native webpack) or the mcp launcher — whoever starts first — auto-spawns one shared Open gateway; the other end reuses it. Team (explicit token) never spawns.
  - **gateway**: `startMcpStdioProxy`; removed the server-rendered `/admin` + `/admin/login` HTML pages — sign-in unified at `/console`.
  - **console-ui**: sign-in takes effect without a hard reload; governance tab admin-only.
  - **demo**: `demo.sh` reclaims a stale harness gateway instead of refusing to start.

### Patch Changes

- Updated dependencies [c03d01c]
- Updated dependencies [20c0a85]
- Updated dependencies [68e4785]
- Updated dependencies [2fa80f1]
- Updated dependencies [2fa80f1]
- Updated dependencies [2fa80f1]
- Updated dependencies [c7736ab]
  - @harness-fe/console-ui@4.0.0-next.5
  - @harness-fe/gateway@4.0.0-next.5
  - @harness-fe/core@4.0.0-next.5
