---
'@harnessa-fe/mcp-server': patch
---

Add a self-hosted Docker image (`morphixai/harnessa-fe`) for teams
who want to run the daemon on a shared dev VM instead of `npx` on each
laptop. Multi-arch (amd64 + arm64), publishes automatically on every
mcp-server release.

Container defaults differ from `npx`: `HARNESSA_FE_HOST=0.0.0.0`,
`HARNESSA_FE_MCP_TRANSPORT=http`, and `HOME=/data` so the volume mount
captures all persistence. Token (`HARNESSA_FE_TOKEN`) is still required.

See [docs/docker.md](https://github.com/Morphicai/harnessa-fe/blob/main/docs/docker.md)
for the full guide and [examples/docker/docker-compose.example.yml](https://github.com/Morphicai/harnessa-fe/blob/main/examples/docker/docker-compose.example.yml)
for a reference compose file.
