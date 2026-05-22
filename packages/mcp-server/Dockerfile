# syntax=docker/dockerfile:1.6
#
# harness-fe MCP daemon — single-user self-hosted image.
#
# Pulls @harness-fe/mcp-server from npm at build time so this Dockerfile
# stays independent of the source tree. The CI workflow passes the version
# being released via VERSION build-arg; local builds default to the latest
# published version.
#
# Usage:
#   docker run --rm -p 47729:47729 \
#     -e HARNESS_FE_TOKEN=$(openssl rand -base64 24) \
#     -v harness-data:/data \
#     morphixai/harness-fe:latest
#
# Defaults are tuned for container use:
#   - HARNESS_FE_HOST=0.0.0.0 (the only sensible bind inside a container)
#   - HOME=/data so the daemon's ~/.harness lands on the mounted volume
#   - HARNESS_FE_MCP_TRANSPORT=http (stdio doesn't make sense from outside)
#
# Token MUST be supplied via -e HARNESS_FE_TOKEN=... — the daemon refuses
# to start with a non-loopback bind and no token.

FROM node:20-alpine AS runtime

ARG VERSION=latest

RUN apk add --no-cache tini \
    && npm install -g --omit=dev @harness-fe/mcp-server@${VERSION} \
    && npm cache clean --force

# Run as non-root for defence in depth. /data is the volume mount and
# becomes $HOME so the daemon writes ~/.harness/data inside the volume.
RUN addgroup -S harness && adduser -S -G harness -h /data harness \
    && mkdir -p /data \
    && chown -R harness:harness /data
USER harness
WORKDIR /data

ENV HOME=/data \
    HARNESS_FE_HOST=0.0.0.0 \
    HARNESS_FE_MCP_TRANSPORT=http \
    NODE_ENV=production

EXPOSE 47729
VOLUME ["/data"]

# tini reaps zombies and forwards SIGTERM so `docker stop` works cleanly.
ENTRYPOINT ["/sbin/tini", "--", "harness-fe"]
CMD []
