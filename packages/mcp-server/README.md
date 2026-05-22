<p align="center">
  <img src="https://raw.githubusercontent.com/Morphicai/harnessa-fe/main/branding/logo.svg" alt="Harnessa-FE" width="96" />
</p>

# @harnessa-fe/mcp-server

> The MCP daemon for [Harnessa-FE](https://github.com/Morphicai/harnessa-fe). Bridges AI agents (Claude, Cursor, Kiro) with running dev servers and browser tabs.

The MCP server exposes tools over **stdio MCP** to AI agents and runs a **WebSocket bridge** for the Vite/Webpack plugin and the browser runtime client. One daemon can serve multiple projects simultaneously.

## Install

```bash
# Run on demand (recommended)
npx @harnessa-fe/mcp-server

# Or install globally
pnpm add -g @harnessa-fe/mcp-server
harnessa-fe
```

## Use with Claude Code

Register the daemon as an MCP server in your Claude Code settings:

```jsonc
{
    "mcpServers": {
        "harnessa-fe": {
            "command": "npx",
            "args": ["-y", "@harnessa-fe/mcp-server"]
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
| Friendly name in banner / dashboard | `"env": { "HARNESSA_FE_LABEL": "my-mono" }` (cosmetic only) |

Data lives at `~/.harnessa/daemons/<port>/data/`. The label is purely
cosmetic — isolation comes from the port, never the label.

Full guide: [docs/multi-daemon.md](https://github.com/Morphicai/harnessa-fe/blob/main/docs/multi-daemon.md)

## LAN mode (real-device debugging)

The daemon binds `127.0.0.1` by default. Token is **entirely
optional** — set one if you want auth, leave it off for a fully open
daemon. The CLI never refuses to start; binding decisions are yours.

| You want… | Run | Behavior |
|-----------|-----|----------|
| Local-only, zero config | `npx @harnessa-fe/mcp-server` | Loopback, no auth |
| Local with auth (defense in depth) | `--token <value>` or `HARNESSA_FE_TOKEN=<value>` | Loopback, auth required for HTTP / WS |
| LAN debug (phone, tablet, other host) — open | `--host 0.0.0.0` | LAN-reachable, no auth. Banner warns you. |
| LAN debug — protected | `--host 0.0.0.0 --token auto` | LAN-reachable, token required. Banner prints the dashboard URL with `?token=` baked in |

The startup banner always prints the dashboard URL. When a token is
configured, the first browser hit on `?token=…` hands it off to a
cookie so the visible URL stays clean for the next 30 days. When no
token is configured, the bare URL works as-is.

Want a remote agent to share the daemon? Mount the MCP HTTP transport:

```bash
npx @harnessa-fe/mcp-server --host 0.0.0.0 --mcp-transport http --mcp-path /mcp
# … with auth:
npx @harnessa-fe/mcp-server --host 0.0.0.0 --token auto \
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

**Full guide:** [docs/lan-mode.md](https://github.com/Morphicai/harnessa-fe/blob/main/docs/lan-mode.md)

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

Matching env vars: `HARNESSA_FE_HOST`, `HARNESSA_FE_PORT`,
`HARNESSA_FE_TOKEN`, `HARNESSA_FE_MCP_TRANSPORT`, `HARNESSA_FE_MCP_PATH`,
`HARNESSA_FE_HEADLESS`.

## What it exposes

Tools across these domains (see [Architecture](https://github.com/Morphicai/harnessa-fe/blob/main/ARCHITECTURE.md)):

- **page** — `navigate`, `click`, `type`, `dom_query`, `evaluate`, `screenshot`, …
- **console / network / errors** — tail and search runtime events
- **session** — list, replay, slice rrweb recordings
- **project** — `source`, `where_is`, `module_graph` (source-code intelligence)
- **tasks** — point-and-task annotation queue

Persistence lives in `~/.harnessa/` (JSONL event logs + JSON records).

## Docs

- [Root README](https://github.com/Morphicai/harnessa-fe#readme)
- [Architecture](https://github.com/Morphicai/harnessa-fe/blob/main/ARCHITECTURE.md)

## License

MIT
