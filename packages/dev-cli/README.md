# @harness-fe/dev-cli

> Solo launcher for [Harness-FE](https://github.com/Morphicai/harness-fe) — boots the WS bridge + MCP server (stdio or HTTP) in one command. Provides the `harness-fe` binary.

> **New to harness-fe?** Install the [skill](https://github.com/Morphicai/harness-fe/tree/main/packages/agent-skill) first (`npx @harness-fe/skill install`), then wire this in `.mcp.json`. See [agent-setup.md](https://github.com/Morphicai/harness-fe/blob/main/docs/agent-setup.md).

## Usual use — your agent spawns it

You normally don't run it by hand; your agent's `.mcp.json` launches it over stdio:

```jsonc
{
  "mcpServers": {
    "harness-fe": { "type": "stdio", "command": "npx", "args": ["-y", "@harness-fe/dev-cli"] }
  }
}
```

Loopback is fully trusted — no token. Run it manually if you want a long-lived daemon / dashboard:

```bash
npx @harness-fe/dev-cli                                   # 127.0.0.1, stdio MCP
npx @harness-fe/dev-cli --host 0.0.0.0 --token auto --mcp-transport http
```

**Leader / follower:** the first process binds the WS port (leader = in-process daemon); later processes attach as followers — so multiple agent windows share one daemon (and the same browser connections).

## Options

| Flag | Default | Meaning |
|---|---|---|
| `--host` | `127.0.0.1` | bind address (`0.0.0.0` for LAN — requires `--token`) |
| `--port` | `47729` | TCP port |
| `--token <value\|auto>` | — | auth token; `auto` generates one. Required off-loopback |
| `--mcp-transport <stdio\|http>` | `stdio` | `http` mounts `/mcp` on the bridge |
| `--mcp-path` | `/mcp` | HTTP MCP endpoint path |

## Solo vs team

This CLI is the **solo** path: loopback, no token, zero config. For a shared daemon across a team (token + RBAC + project→agent binding + audit), put the [gateway](../gateway) in front — see [docs/gateway-team-mode.md](https://github.com/Morphicai/harness-fe/blob/main/docs/gateway-team-mode.md).

## License

MIT
