<p align="center">
  <img src="https://raw.githubusercontent.com/Morphicai/harness-fe/main/branding/logo.svg" alt="Harness-FE" width="96" />
</p>

# @harness-fe/mcp-server

> The MCP daemon for [Harness-FE](https://github.com/Morphicai/harness-fe). Bridges AI agents (Claude, Cursor, Kiro) with running dev servers and browser tabs.

The MCP server exposes tools over **stdio MCP** to AI agents and runs a **WebSocket bridge** for the Vite/Webpack plugin and the browser runtime client. One daemon can serve multiple projects simultaneously.

## Install

```bash
# Run on demand (recommended)
npx @harness-fe/mcp-server

# Or install globally
pnpm add -g @harness-fe/mcp-server
harness-fe
```

## Use with Claude Code

Register the daemon as an MCP server in your Claude Code settings:

```jsonc
{
    "mcpServers": {
        "harness-fe": {
            "command": "npx",
            "args": ["-y", "@harness-fe/mcp-server"]
        }
    }
}
```

Cursor, Kiro, and other MCP-compatible clients use the same pattern.

## Multiple daemons (port = identity)

The daemon's identity is its listening port. Same port = same daemon
= same on-disk store. Different port = independent daemons with
independent stores.

This means:

- **All IDEs targeting default 47729 share one daemon automatically.**
  No extra config needed. Cursor + Claude Desktop + Kiro on the same
  machine see the same sessions, browser tabs, and projects.
- **Want isolation? Pick a different `--port`.** That's the whole
  isolation knob.

| Scenario | Config |
|---|---|
| Single shared daemon (default) | Nothing extra |
| One project gets its own daemon | `"args": ["...", "--port", "47730"]` in that IDE's mcp.json |
| Monorepo: aggregate everything | All IDEs use default port — they pool automatically |
| Friendly name in banner / dashboard | `"env": { "HARNESS_FE_LABEL": "my-mono" }` (cosmetic only) |

Data lives at `~/.harness/daemons/<port>/data/`. The label is purely
cosmetic — isolation comes from the port, never the label.

Full guide: [docs/multi-daemon.md](https://github.com/Morphicai/harness-fe/blob/main/docs/multi-daemon.md)

## LAN mode (real-device debugging)

The daemon binds `127.0.0.1` by default. Token is **entirely
optional** — set one if you want auth, leave it off for a fully open
daemon. The CLI never refuses to start; binding decisions are yours.

| You want… | Run | Behavior |
|-----------|-----|----------|
| Local-only, zero config | `npx @harness-fe/mcp-server` | Loopback, no auth |
| Local with auth (defense in depth) | `--token <value>` or `HARNESS_FE_TOKEN=<value>` | Loopback, auth required for HTTP / WS |
| LAN debug (phone, tablet, other host) — open | `--host 0.0.0.0` | LAN-reachable, no auth. Banner warns you. |
| LAN debug — protected | `--host 0.0.0.0 --token auto` | LAN-reachable, token required. Banner prints the dashboard URL with `?token=` baked in |

The startup banner always prints the dashboard URL. When a token is
configured, the first browser hit on `?token=…` hands it off to a
cookie so the visible URL stays clean for the next 30 days. When no
token is configured, the bare URL works as-is.

Want a remote agent to share the daemon? Mount the MCP HTTP transport:

```bash
npx @harness-fe/mcp-server --host 0.0.0.0 --mcp-transport http --mcp-path /mcp
# … with auth:
npx @harness-fe/mcp-server --host 0.0.0.0 --token auto \
  --mcp-transport http --mcp-path /mcp
```

Remote Claude Code / Cursor config:

```jsonc
// No-auth daemon:
{ "type": "http", "url": "http://<lan-ip>:47729/mcp" }

// Token-protected daemon:
{
  "type": "http",
  "url": "http://<lan-ip>:47729/mcp",
  "headers": { "Authorization": "Bearer <token>" }
}
```

**Full guide:** [docs/lan-mode.md](https://github.com/Morphicai/harness-fe/blob/main/docs/lan-mode.md)

## All CLI flags

```
--host <addr>           Bind address (default 127.0.0.1; use 0.0.0.0 for LAN)
--port <number>         TCP port (default 47729)
--token <value|auto>    Optional. When set, all HTTP/WS requests must carry it
                        (header / cookie / query / WS subprotocol). When unset,
                        auth is disabled entirely.
--mcp-transport <kind>  stdio (default) | http
--mcp-path <path>       Default /mcp
--public-host <addr>    Override the host printed in outbound URLs
-h, --help
```

Matching env vars: `HARNESS_FE_HOST`, `HARNESS_FE_PORT`,
`HARNESS_FE_TOKEN`, `HARNESS_FE_MCP_TRANSPORT`, `HARNESS_FE_MCP_PATH`,
`HARNESS_FE_HEADLESS`.

## Embedding the daemon programmatically

You can also run the daemon as a library inside another Node.js
process — no `npx`, no sidecar, no second port:

```ts
import { createDaemon, MemoryEventStore } from '@harness-fe/mcp-server';

const daemon = createDaemon({
  port: 47729,
  host: '127.0.0.1',
  // Replace the built-in token check with your own auth.
  // Sync because the WS upgrade handshake completes inline.
  authorize: (req) => verifyMyJwt(req.headers.authorization),
  // Optional: plug in a custom IStore (Supabase, S3, in-memory…).
  // Omit for the default port-keyed JSONL store.
  // store: mySupabaseStore,
  // Optional: persistent event store for SSE resumability across
  // daemon restarts. Defaults to an in-memory ring (1000 events /
  // 5 minutes / 50 MiB). Pass `null` to disable resumability.
  // eventStore: new MyRedisEventStore(redis),
});

await daemon.start();
console.log(`harness-fe listening on :${daemon.getBoundPort()} at ${daemon.mcpPath}`);

process.on('SIGTERM', () => daemon.stop());
```

The factory accepts the same data-isolation knobs as the CLI
(`port`, `dataDir`, `label`), plus host-injection hooks
(`authorize`, `store`, `taskStore`, `memoryStore`, `eventStore`).
See `DaemonOptions` in the package types for the full list.

A minimal end-to-end example lives at
[`examples/embed-express/`](./examples/embed-express/).

> **Scope of v1.** `createDaemon` owns its own listener; attaching the
> daemon to a host's existing `http.Server` (Express middleware /
> Next.js route handler) requires deeper Bridge surgery and is tracked
> as a follow-up. Today: same process, separate port. Tomorrow: same
> origin via host-server attachment.

## What it exposes

Tools across these domains (see [Architecture](https://github.com/Morphicai/harness-fe/blob/main/ARCHITECTURE.md)):

- **page** — `navigate`, `click`, `type`, `dom_query`, `evaluate`, `screenshot`, …
- **console / network / errors** — tail and search runtime events
- **session** — list, replay, slice rrweb recordings
- **project** — `source`, `where_is`, `module_graph` (source-code intelligence)
- **tasks** — point-and-task annotation queue

Persistence lives in `~/.harness/` (JSONL event logs + JSON records).

## Docs

- [Root README](https://github.com/Morphicai/harness-fe#readme)
- [Architecture](https://github.com/Morphicai/harness-fe/blob/main/ARCHITECTURE.md)

## License

MIT
