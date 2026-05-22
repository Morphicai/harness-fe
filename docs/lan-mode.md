# Running harness-fe on the LAN

The daemon defaults to `127.0.0.1` — only your own dev machine can reach
it. This is the right default: `console_tail`, `network_tail`,
`session.recordings.*` and the dashboard expose console, network
requests, and full DOM recordings of whatever's running. None of that
should be on a public socket.

For real-device debugging (phone browser, second machine, RN device)
you can bind the daemon to a routable IP. Token auth becomes mandatory
the moment you do.

## Three modes at a glance

| Mode | Bind | Auth | Use it for |
|---|---|---|---|
| Local-only (default) | `127.0.0.1` | none | Day-to-day on your own machine |
| LAN with token | `0.0.0.0` (or a specific LAN IP) | token | Mobile / second device testing |
| Remote MCP | LAN + `--mcp-transport http` | token | Sharing one daemon across machines/agents |

## Local-only

```bash
npx @harness-fe/mcp-server
```

That's it. stdio MCP to whatever spawned the process, WS bridge on
`127.0.0.1:47729`. Nothing else can connect.

## LAN with token

```bash
npx @harness-fe/mcp-server --host 0.0.0.0 --token auto
```

The daemon prints:

```
[harness-fe] leader: WS bridge listening on ws://0.0.0.0:47729
[harness-fe] WARNING: bound to non-loopback host 0.0.0.0.
[harness-fe]   anyone reaching this host:port with the token can read console / network / recordings.
[harness-fe] dashboard: http://192.168.1.20:47729?token=<random>
[harness-fe] token:     <random>
```

Open the dashboard URL on your phone. The token in the query string is
swapped for a cookie on first paint, so subsequent navigation Just
Works.

To wire a plugin or runtime on a second device, pass the same token via
the plugin config:

```ts
harnessFE({ mcpUrl: 'ws://192.168.1.20:47729', token: '<random>' })
```

Or, for the runtime client (when the script tag injects
`__HARNESS_FE__.mcpUrl` for you, the URL already carries the token —
no extra config needed).

## Remote MCP (HTTP transport)

Want an agent on another machine to share the same daemon? Add
`--mcp-transport http`:

```bash
npx @harness-fe/mcp-server \
  --host 0.0.0.0 \
  --token auto \
  --mcp-transport http \
  --mcp-path /mcp
```

The banner adds:

```
[harness-fe] mcp http:  http://192.168.1.20:47729/mcp?token=<random>
[harness-fe]   agent config: { "url": "http://192.168.1.20:47729/mcp", "headers": { "Authorization": "Bearer <random>" } }
```

Drop that JSON into Claude Code / Cursor / Kiro as an HTTP MCP server.

## Auth flow detail

A request is authorized if **any** of these match:

1. `Authorization: Bearer <token>` header — for agents, CLIs, server-to-server.
2. `Cookie: harness_fe_token=<token>` — set by the login page on first visit.
3. URL query `?token=<token>` — works for both HTTP and WS upgrade.
4. WS subprotocol `harness-fe.token.<token>` — the only way browsers
   can pass a token through the WebSocket API.

Loopback binds (`127.*`, `localhost`, `::1`) skip the check entirely.

## What's behind the auth wall

Every HTTP route and every WS upgrade. Concretely:

- The dashboard (`GET /`, `GET /sessions/:id`, …)
- The replay viewer (`GET /replay/:exportId`)
- The events ingest endpoint (`POST /events`)
- The MCP HTTP transport (`POST /mcp`) — when enabled
- The WS bridge that plugin/runtime use to talk to the daemon

Translation: an attacker on the same WiFi cannot watch your console,
read your network requests, scrub through DOM recordings, or pivot via
the MCP tool surface without your token.

## Picking a public host

If you bind `0.0.0.0` the daemon picks the first non-internal IPv4
interface for the URLs it prints. On a multi-homed machine that might
not be the right one. Override with `--public-host 192.168.x.y` (or
`HARNESS_FE_PUBLIC_HOST=...`).

## Environment variables

Every flag has an env var equivalent for `package.json scripts` /
docker / CI:

| Env | Equivalent flag |
|---|---|
| `HARNESS_FE_HOST` | `--host` |
| `HARNESS_FE_TOKEN` | `--token` (use `auto` to generate) |
| `HARNESS_FE_MCP_TRANSPORT` | `--mcp-transport` |
| `HARNESS_FE_MCP_PATH` | `--mcp-path` |
| `HARNESS_FE_URL` | legacy: full `ws://host:port` (overridden by flags) |

## Safety reminder

LAN mode is *not* a substitute for putting the daemon behind a proper
reverse proxy if you're sharing it with a team. Token auth here is
defence-in-depth for casual same-WiFi probing — not the access control
layer of a production service. Don't expose it to the public internet.
