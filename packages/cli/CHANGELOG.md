# @harness-fe/cli

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
