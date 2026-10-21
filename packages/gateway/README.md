# @harness-fe/gateway

> Governance gateway for [Harness-FE](https://github.com/Morphicai/harness-fe) — token + RBAC + project→agent binding + audit + admin, sitting **in front of** one or more daemons. **Team mode only**; solo dev doesn't need it (the agent talks to a loopback daemon directly).

Zero native deps — JSON file store + `node:crypto` scrypt.

> **New to harness-fe?** Start with the [agent setup guide](https://github.com/Morphicai/harness-fe/blob/main/docs/agent-setup.md) and install the [skill](https://github.com/Morphicai/harness-fe/tree/main/packages/agent-skill) first.

## What it does

Agents reach a shared daemon **only** through the gateway, which:

- verifies the caller's token → identity + scope + **project grants**
- gates by **scope (RBAC)**: `control` / `read` / `write`
- **routes** by token → target daemon, injecting the verified caller (`x-harness-caller` + `x-harness-projects`)
- filters `tools/list` by scope (**dynamic manifest** — a `read` token never sees `page.*`)
- **audits** every call (append-only)
- serves an HTML **admin panel** (servers / tokens / audit)

The gateway never implements tools or holds data — that's the [daemon](../core).

## Run

```bash
harness-gateway --port 47950 --data-dir ~/.harness-fe/gateway \
  --admin-user admin --admin-pass "$PW" \
  --add-server  name=team,endpoint=http://127.0.0.1:47900,token="$DAEMON_SECRET" \
  --issue-token name=agentA,server=team,scopes=read+control,projects=my-app
```

| Flag | Meaning |
|---|---|
| `--port` / `--host` | bind (default `47950` / `127.0.0.1`) |
| `--data-dir` | store dir (default `~/.harness-fe/gateway`) |
| `--admin-user` / `--admin-pass` | bootstrap the first admin (only if none exists) |
| `--add-server name=,endpoint=,token=` | register an upstream daemon (idempotent by name) |
| `--issue-token name=,server=,scopes=read+control[,projects=a+b]` | mint a scoped token, printed once. No `projects` ⇒ `*` (all) |

Full guide: **[docs/gateway-team-mode.md](https://github.com/Morphicai/harness-fe/blob/main/docs/gateway-team-mode.md)**. One-command demo: `bash scripts/demo.sh`.

## Library

```js
import { createGateway, GatewayStore } from '@harness-fe/gateway';
const store = new GatewayStore('/path/to/data');
const gw = createGateway({ store });
await gw.listen(47950);
```

## Screenshot results for vision models

`page.screenshot` returns a native MCP `image` content block and a separate
`text` block containing capture metadata (`width`, `height`, `format`, `via`,
and `notCaptured`). PNG is the MCP default; request `webp` or `jpeg` explicitly
for smaller payloads. The image block's `mimeType` reflects the actual encoded
data, including a browser fallback to PNG.

Clients should consume the image block directly rather than read a `dataUrl`
from text. Pixel data is not duplicated in the metadata. Runtime WebSocket
responses still use the existing data URL shape; conversion happens only at
the MCP boundary and applies to both HTTP and solo/stdio clients.

Screenshots use DOM-to-canvas capture. Inspect `notCaptured` before interpreting
blank canvas/video/cross-origin iframe regions. Image delivery requires a
vision-capable model and a client/provider that forwards image content;
receiving a text-only base64 string is not visual verification.

`GET /console/api/meta` includes `gatewayVersion`, the running npm package
version; MCP initialization reports that same package version. These are
independent of `protocolVersion` and the legacy `daemonVersion`. After an npm
upgrade, restart the managed gateway and reload MCP to replace any shared older
process. See the [upgrade instructions](../../docs/agent-setup.md#upgrade-an-existing-machine).

## License

MIT
