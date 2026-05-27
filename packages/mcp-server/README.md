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
--experimental-env-var <name>
                        Restrict experimental tools to hosts where <name> is
                        set. Omit for fully-on (default).
-h, --help
```

Matching env vars: `HARNESS_FE_HOST`, `HARNESS_FE_PORT`,
`HARNESS_FE_TOKEN`, `HARNESS_FE_MCP_TRANSPORT`, `HARNESS_FE_MCP_PATH`,
`HARNESS_FE_HEADLESS`. Experimental (in-testing) tools are **on by default** —
no config. To restrict them, pass `--experimental-env-var <name>` /
`HARNESS_FE_EXPERIMENTAL_ENV_VAR` (or `createDaemon({ experimentalEnvVar })`
when embedding): the tools then show up only on machines where `<name>` is set
to a non-empty value.

## Embedding into a host app

For most users, running the CLI as a separate process is the right call.
If you're shipping your **own** product and want the harness daemon to live
inside *your* Node process — sharing your auth, your storage, your lifecycle
— use `createDaemon`:

```ts
import { createDaemon } from '@harness-fe/mcp-server';

const daemon = createDaemon({
    port: 47730,                       // pick a port distinct from devs' local 47729
    host: '127.0.0.1',
    authorize: (req) => verifyMyJwt(req.headers.authorization), // your auth
    label: 'my-app',
});

await daemon.start();
process.on('SIGTERM', () => daemon.stop());
```

That call starts the WS bridge **and** mounts the MCP HTTP transport at
`/mcp` on the daemon's own listener. The CLI uses the same factory under
the hood — there is exactly one boot path.

### Picking the right options

| Option | When to use |
|---|---|
| `authorize: (req) => boolean` | You already have an auth layer (JWT, session cookie, etc.). Return `true` to accept the request. The built-in token check is skipped. |
| `token: 'xxxx'` | You want the built-in token gate. Mutually exclusive with `authorize`. Same wire conventions as the CLI's `--token`. |
| `store`, `taskStore`, `memoryStore` | Plug in custom `IStore` implementations to land data in your own DB instead of `~/.harness/`. Pass `null` to disable persistence entirely. |
| `eventStore` | Custom SSE `EventStore` for resumable streaming. Omit for the in-memory default; pass `null` to disable Last-Event-ID resumption. |
| `mcpHttp: false` | Boot only the WS bridge; skip mounting `/mcp`. Use when you want to wire MCP through stdio yourself (this is how the CLI's stdio mode embeds the daemon). |
| `mcpPath: '/agents/mcp'` | Move the MCP HTTP endpoint to a non-default path. |
| `dataDir` | Override the on-disk root for default JSONL stores. |
| `experimentalEnvVar: 'MY_FLAG'` | Restrict experimental (in-testing) tools to hosts where `MY_FLAG` is set to a non-empty value. Omit for fully-on (the default). |

### Resumable SSE

The MCP HTTP transport supports `Last-Event-ID` reconnection out of the
box. Long agent runs survive transient network drops — when a client
reconnects with the `Last-Event-ID` header, the server replays every
event past that id with no duplicates and no gaps.

Defaults: in-memory ring with 1000 events / 5 minutes / 50 MiB cap per
stream. Override with `eventStore: new MemoryEventStore({...})` or plug
in your own backend. Set `eventStore: null` to opt out.

### Working example

A self-contained example lives at
[`examples/embed-express/`](https://github.com/Morphicai/harness-fe/tree/main/packages/mcp-server/examples/embed-express):
an Express app and the harness daemon share one Node process, with a
custom `authorize` hook standing in for the host's real auth.

### Embedding vs running the CLI: which?

- **CLI** is right for development. Devs run `npx @harness-fe/mcp-server`
  alongside their dev server; AI agents (Claude Code / Cursor / Kiro)
  speak to it over stdio MCP. **The CLI is what 99% of users want.**
- **`createDaemon`** is right when your *product* embeds the harness —
  for example, a hosted dev environment that runs the daemon under its
  own auth so users don't have to install or configure anything.

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
