# syntax=docker/dockerfile:1.6
#
# harnessa-fe MCP daemon — single-user self-hosted image.
#
# Pulls @harnessa-fe/mcp-server from npm at build time so this Dockerfile
# stays independent of the source tree. The CI workflow passes the version
# being released via VERSION build-arg; local builds default to the latest
# published version.
#
# Usage:
#   docker run --rm -p 47729:47729 \
#     -e HARNESSA_FE_TOKEN=$(openssl rand -base64 24) \
#     -v harnessa-data:/data \
#     ghcr.io/morphicai/harnessa-fe:latest
#
# Defaults are tuned for container use:
#   - HARNESSA_FE_HOST=0.0.0.0 (the only sensible bind inside a container)
#   - HOME=/data so the daemon's ~/.harnessa lands on the mounted volume
#   - HARNESSA_FE_MCP_TRANSPORT=http (stdio doesn't make sense from outside)
#
# Token MUST be supplied via -e HARNESSA_FE_TOKEN=... — the daemon refuses
# to start with a non-loopback bind and no token.

FROM node:20-alpine AS runtime

ARG VERSION=latest

RUN apk add --no-cache tini \
    && npm install -g --omit=dev @harnessa-fe/mcp-server@${VERSION} \
    && npm cache clean --force

# Run as non-root for defence in depth. /data is the volume mount and
# becomes $HOME so the daemon writes ~/.harnessa/data inside the volume.
RUN addgroup -S harnessa && adduser -S -G harnessa -h /data harnessa \
    && mkdir -p /data \
    && chown -R harnessa:harnessa /data
USER harnessa
WORKDIR /data

ENV HOME=/data \
    HARNESSA_FE_HOST=0.0.0.0 \
    HARNESSA_FE_MCP_TRANSPORT=http \
    NODE_ENV=production

EXPOSE 47729
VOLUME ["/data"]

# tini reaps zombies and forwards SIGTERM so `docker stop` works cleanly.
ENTRYPOINT ["/sbin/tini", "--", "harnessa-fe"]
CMD []
