# Deploying harness-fe with Docker

Run a governed gateway on a team VM or CI environment — one shared gateway for all developers and agents.

## Quick start

```bash
docker run --rm \
  -p 47950:47950 \
  -v harness-data:/data \
  morphixai/harness-fe:latest \
  --governed \
  --host 0.0.0.0 \
  --port 47950 \
  --admin-user admin \
  --admin-pass "$(openssl rand -base64 24)" \
  --data-dir /data/gateway \
  --core-data-dir /data/core \
  --issue-token name=runtime,scopes=write \
  --issue-token name=agent,scopes=read+control,projects='*'
```

The gateway prints each token in the startup banner. Use the runtime token in your build plugin; use the agent token in your `.mcp.json`.

## docker-compose

Copy the reference compose file:

```bash
cd examples/docker
cp .env.example .env    # set HARNESS_ADMIN_PASS
docker compose up -d
docker compose logs -f
```

Stop / wipe:

```bash
docker compose down        # keep volume
docker compose down -v     # wipe all data
```

## Connecting clients

### Build plugin (browser runtime → gateway `/ws`)

```ts
// vite.config.ts
harnessFE({ mcpUrl: 'ws://<docker-host>:47950/ws', token: '<runtime-token>', projectId: 'my-app' })

// next.config.mjs
withHarness({}, { mcpUrl: 'ws://<docker-host>:47950/ws', token: '<runtime-token>', projectId: 'my-app' })
```

### Agent MCP (agent → gateway `/mcp`)

```jsonc
{
  "mcpServers": {
    "harness-fe": {
      "type": "http",
      "url": "http://<docker-host>:47950/mcp",
      "headers": { "Authorization": "Bearer <agent-token>" }
    }
  }
}
```

### Console

Visit `http://<docker-host>:47950/console` — log in with the admin credentials set at startup.

## Image tags

| Tag | Source | Use for |
|---|---|---|
| `morphixai/harness-fe:latest` | npm `@harness-fe/cli` (stable) | production / stable team deploys |
| `morphixai/harness-fe:next` | npm `@harness-fe/cli@next` | prerelease / early adopters |
| `morphixai/harness-fe:<version>` | exact npm version | pinned deploys |

The image is multi-arch (`linux/amd64` + `linux/arm64`). Built automatically on every npm release via `.github/workflows/docker.yml`.

## Persistence

All data lives under the mounted volume (`/data`):

```
/data/
├── gateway/    ← token store, audit log, admin session
└── core/       ← sessions, timeline JSONL, rrweb recordings, tasks
```

Back up by snapshotting the volume. Wipe sessions only: `docker exec <container> rm -rf /data/core`.

## `npx` alternative (no Docker)

```bash
npx @harness-fe/cli --governed \
  --port 47950 \
  --admin-user admin --admin-pass "$PW" \
  --issue-token name=runtime,scopes=write \
  --issue-token name=agent,scopes=read+control,projects='*'
```

Same flags, same behaviour — no container required. Useful for one-shot team sessions or CI environments where Docker is unavailable.

## TLS

Not built in. Terminate TLS at a reverse proxy (nginx / Caddy / Traefik) in front of the container. Token auth alone doesn't protect traffic in transit.

## Building the image locally

```bash
docker build -t harness-fe:dev \
  --build-arg VERSION=4.0.0-next.6 \
  --build-arg NPM_TAG=next \
  packages/cli/
```
