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

## LAN mode (real-device debugging)

The daemon binds `127.0.0.1` by default — local only, no auth needed.

To debug from a phone, tablet, or another machine on the same WiFi:

```bash
# Generate a one-shot token at startup
npx @harnessa-fe/mcp-server --host 0.0.0.0 --token auto

# Or reuse a stable token from your shell rc
export HARNESSA_FE_TOKEN=...
npx @harnessa-fe/mcp-server --host 0.0.0.0
```

The startup banner prints the dashboard URL with the token baked in —
paste it into your phone's browser once and the daemon cookies the
session.

Want a remote agent to share the daemon? Mount the MCP HTTP transport:

```bash
npx @harnessa-fe/mcp-server --host 0.0.0.0 --token auto \
  --mcp-transport http --mcp-path /mcp
```

Configure your remote Claude Code / Cursor:

```jsonc
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
--token <value|auto>    Required when --host is not loopback
--mcp-transport <kind>  stdio (default) | http
--mcp-path <path>       Default /mcp
--public-host <addr>    Override the host printed in outbound URLs
-h, --help
```

Matching env vars: `HARNESSA_FE_HOST`, `HARNESSA_FE_TOKEN`,
`HARNESSA_FE_MCP_TRANSPORT`, `HARNESSA_FE_MCP_PATH`.

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
