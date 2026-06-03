# Running harness-fe on the LAN

The gateway defaults to `127.0.0.1` — only your own dev machine can reach it. This is the right default: `console_tail`, `network_tail`, `session.recordings.*` and the console expose console, network requests, and full DOM recordings of whatever's running. None of that should be on a public socket.

For real-device debugging (phone browser, second machine, RN device) you can bind the gateway to a routable IP. Token auth becomes mandatory the moment you do — use `harness --governed`.

## Three modes at a glance

| Mode | Bind | Auth | Use it for |
|---|---|---|---|
| Local-only (default) | `127.0.0.1` | none | Day-to-day on your own machine |
| LAN with token | `0.0.0.0` (or a specific LAN IP) | governed token | Mobile / second device testing |
| Remote team | LAN + `harness --governed` HTTP-MCP | scoped tokens per agent | Sharing one gateway across machines/agents |

## Local-only (solo)

```bash
# .mcp.json
{ "mcpServers": { "harness-fe": { "type": "stdio", "command": "npx", "args": ["-y", "@harness-fe/cli", "mcp"] } } }
```

`harness mcp` auto-spawns a shared gateway on `127.0.0.1:47729`. Nothing else can connect.

## LAN with token (governed, `--host 0.0.0.0`)

```bash
harness --governed \
  --host 0.0.0.0 \
  --port 47950 \
  --admin-user admin --admin-pass "$PW" \
  --issue-token name=runtime,scopes=write \
  --issue-token name=agentA,scopes=read+control,projects=my-app
```

The gateway prints each token in the banner. Point your app's build plugin at the LAN IP:

```ts
harnessFE({ mcpUrl: 'ws://192.168.1.20:47950/ws', token: '<runtime-token>', projectId: 'my-app' })
```

And your agent at `/mcp`:

```jsonc
{ "mcpServers": { "harness-fe": {
  "type": "http",
  "url": "http://192.168.1.20:47950/mcp",
  "headers": { "Authorization": "Bearer <agentA-token>" }
} } }
```

## Auth flow detail

A request is authorized if **any** of these match:

1. `Authorization: Bearer <token>` header — for agents, CLIs, server-to-server.
2. `Cookie: harness_fe_token=<token>` — set by the admin panel on first login.
3. URL query `?token=<token>` — works for both HTTP and WS upgrade.
4. WS subprotocol `harness-fe.token.<token>` — the only way browsers can pass a token through the WebSocket API.

Loopback binds (`127.*`, `localhost`, `::1`) in Open (solo/serve) mode skip the check entirely.

## Picking a public host

If you bind `0.0.0.0` the gateway picks the first non-internal IPv4 interface for the URLs it prints. On a multi-homed machine that might not be the right one. Override with `--public-host 192.168.x.y`.

## Safety reminder

LAN mode is *not* a substitute for putting the gateway behind a proper reverse proxy if you're sharing it with a team. Governed-mode token auth is defence-in-depth for casual same-WiFi probing — not the access control layer of a production service. Don't expose it to the public internet.
