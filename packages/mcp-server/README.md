# @harnessa-fe/mcp-server

> The MCP daemon for [Harnessa-FE](https://github.com/morphixai/harnessa-fe). Bridges AI agents (Claude, Cursor, Kiro) with running dev servers and browser tabs.

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

## What it exposes

Tools across these domains (see [Architecture](https://github.com/morphixai/harnessa-fe/blob/main/ARCHITECTURE.md)):

- **page** — `navigate`, `click`, `type`, `dom_query`, `evaluate`, `screenshot`, …
- **console / network / errors** — tail and search runtime events
- **session** — list, replay, slice rrweb recordings
- **project** — `source`, `where_is`, `module_graph` (source-code intelligence)
- **tasks** — point-and-task annotation queue

Persistence lives in `~/.harnessa/` (JSONL event logs + JSON records).

## Docs

- [Root README](https://github.com/morphixai/harnessa-fe#readme)
- [Architecture](https://github.com/morphixai/harnessa-fe/blob/main/ARCHITECTURE.md)

## License

MIT
