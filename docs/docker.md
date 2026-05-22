# Self-hosting harnessa-fe with Docker

Useful when:

- A team wants a single shared daemon on a dev VM instead of each
  developer running `npx`.
- You want a reproducible container instead of relying on the host's
  Node version.
- You're running CI / preview environments that need to spin up a
  daemon alongside a dev server.

Not useful when:

- You're a single developer on a laptop. `npx @harnessa-fe/mcp-server`
  is simpler and faster.
- You expect source-aware MCP tools (`project_source`,
  `project_where_is`) to work across many projects from a central
  daemon. Those tools read the source tree from disk; centralised
  multi-project source access isn't supported yet — track this in
  ROADMAP "Phase B" notes.

## Image

```
morphixai/harnessa-fe:<version>
morphixai/harnessa-fe:latest
```

Published from [`.github/workflows/docker.yml`](../.github/workflows/docker.yml)
on every successful npm release of `@harnessa-fe/mcp-server`. Multi-arch
(`linux/amd64` + `linux/arm64`).

## Quick start

```bash
docker run --rm -p 47729:47729 \
  -e HARNESSA_FE_TOKEN="$(openssl rand -base64 24)" \
  -v harnessa-data:/data \
  morphixai/harnessa-fe:latest
```

Container defaults that differ from `npx`:

| Env | Default in image | Why |
|---|---|---|
| `HARNESSA_FE_HOST` | `0.0.0.0` | Only sensible bind from inside a container |
| `HARNESSA_FE_MCP_TRANSPORT` | `http` | stdio doesn't work across the container boundary |
| `HOME` | `/data` | Daemon's `~/.harnessa` lands on the mounted volume |

You **must** provide `HARNESSA_FE_TOKEN`. The daemon refuses to start
on a non-loopback bind without one.

## docker-compose

A reference compose file lives at
[`examples/docker/docker-compose.example.yml`](../examples/docker/docker-compose.example.yml).
Copy it next to a `.env`:

```bash
cd examples/docker
cp .env.example .env
# Edit .env, set HARNESSA_FE_TOKEN=...
docker compose up -d
docker compose logs -f
```

Stop / wipe:

```bash
docker compose down            # keep volume
docker compose down -v         # wipe sessions + recordings + tasks
```

## Persistence

Everything the daemon writes — sessions, timeline JSONL, rrweb chunks,
task records, persistent memory — lives under the `/data` volume. Mount
a named volume (compose default) or a host path:

```bash
-v /srv/harnessa:/data
```

Back up by snapshotting that path. Restore by replacing it before
container start.

## Connecting clients

### Build plugin

```ts
harnessaFE({
  mcpUrl: 'ws://<docker-host>:47729',
  token: process.env.HARNESSA_FE_TOKEN,   // same token as the container
})
```

Same env var on the dev machine + the container = no extra config.

### Browser

Visit `http://<docker-host>:47729/?token=<token>` once. The daemon
sets a cookie; subsequent navigation works without the query string.

### Remote agent (Claude Code / Cursor)

```jsonc
{
  "type": "http",
  "url": "http://<docker-host>:47729/mcp",
  "headers": { "Authorization": "Bearer <token>" }
}
```

(The image enables the MCP HTTP transport by default — see the env
defaults above.)

## Outbound URLs and `--public-host`

When the daemon prints links (dashboard, replay viewer), it picks the
first non-internal IPv4 it sees. **Inside a container that's almost
always the bridge network address**, which nobody outside can reach.

Set `HARNESSA_FE_PUBLIC_HOST` to your docker host's LAN IP or DNS name:

```yaml
environment:
  HARNESSA_FE_PUBLIC_HOST: dev.example.internal
```

## TLS

Not built in. If you expose this beyond a trusted LAN, terminate TLS at
a reverse proxy (nginx / Caddy / Traefik) in front of the container.
Token auth alone doesn't protect traffic in transit.

## What's NOT included (yet)

Phase A is intentionally a thin single-token image. Things the next
phase would add for real multi-tenant team use:

- Multiple tokens with per-token ACL / audit trail
- Per-user / per-team session isolation
- Remote `project_source` (build plugin uploads source content so the
  daemon doesn't need filesystem access to each project)

If your team needs any of these, file an issue describing the use case.

## Building locally

For testing the Dockerfile against unreleased changes:

```bash
docker build -t harnessa-fe:dev \
  --build-arg VERSION=2.0.0 \
  packages/mcp-server/
```

The image always installs the package from npm — there's no path that
copies in local source. To test pre-release code, publish a prerelease
tag (`@harnessa-fe/mcp-server@x.y.z-rc.1`) first.
