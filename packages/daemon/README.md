# @harness-fe/daemon

> Core daemon for [Harness-FE](https://github.com/Morphicai/harness-fe) — the always-on layer that holds **capabilities + data + the browser connection**: WS bridge, event store, recording/replay, dashboard, caller identity, and per-project tenant isolation.

Most users **don't depend on this directly.** Use [`@harness-fe/dev-cli`](../dev-cli) (solo launcher) or embed via `createDaemon`. The MCP protocol layer ([`@harness-fe/mcp-server`](../mcp-server)) and the governance [`@harness-fe/gateway`](../gateway) sit on top of it.

## Embedding

```js
import { createDaemon } from '@harness-fe/mcp-server'; // factory: daemon + MCP HTTP in one
const daemon = createDaemon({ port: 47900, token: 'secret', mcpHttp: true });
await daemon.start();
```

Low-level building blocks are exported here:

```js
import { Bridge, RemoteBridge, canSeeProject, projectGrant, identifyPrincipal } from '@harness-fe/daemon';
```

## What's inside

- **Bridge** (WebSocket) + **RemoteBridge** (leader/follower proxy)
- **store** — JSONL sessions, recordings, projects, tasks (per-port data dir)
- **identity** — `Principal`, `canSee` / `canSeeProject`, **project→agent binding** (`projectGrant`), trusted-upstream forwarding
- **replay** — rrweb export + self-contained viewer
- **dashboard** — project/session console (SPA from `@harness-fe/dashboard-ui`)
- **consent** — control-command approval gate (browser-side)

See [ARCHITECTURE.md](https://github.com/Morphicai/harness-fe/blob/main/ARCHITECTURE.md) for the layering and [gateway-team-mode.md](https://github.com/Morphicai/harness-fe/blob/main/docs/gateway-team-mode.md) for daemon-vs-gateway responsibilities.

## License

MIT
