FROM node:20-alpine

# Install a specific version at build time so image tags are reproducible.
# Pass --build-arg VERSION=4.0.0-next.6 (or omit for "latest @next").
ARG VERSION=latest
ARG NPM_TAG=latest

# Install @harness-fe/cli globally so `harness` is on PATH.
RUN npm install -g @harness-fe/cli@${VERSION} --tag ${NPM_TAG} --no-fund --no-audit

# Gateway data dir (audit log, token store, session data).
# Mount a named volume here for persistence.
ENV HARNESS_DATA_DIR=/data
VOLUME ["/data"]

# Default to listening on all interfaces inside the container.
ENV HARNESS_HOST=0.0.0.0
ENV HARNESS_PORT=47950

# ── Retention / storage tunables ─────────────────────────────────────────────
# Total data-dir cap (bytes). Default 1 GiB. Set to 0 to disable.
ENV HARNESS_MAX_STORAGE_BYTES=1073741824
# How many days to keep a session. Default 7.
ENV HARNESS_MAX_AGE_DAYS=7
# Max sessions to retain globally. Default 200.
ENV HARNESS_MAX_SESSIONS=200
# How many days to keep rrweb recording files (shorter than sessions). Default 3.
ENV HARNESS_RECORDING_RETENTION_DAYS=3
# Max rrweb recording bytes per session. Default 250 MiB.
ENV HARNESS_MAX_RECORDING_BYTES_PER_SESSION=262144000
# Purge interval in ms. Default 3600000 (1 h).
ENV HARNESS_PURGE_INTERVAL_MS=3600000

EXPOSE 47950

# Entrypoint: run `harness` with any extra args passed to `docker run`.
# Typical governed usage:
#   docker run ... morphixai/harness-fe \
#     --governed --admin-user admin --admin-pass "$PW" \
#     --issue-token name=runtime,scopes=write \
#     --issue-token name=agentA,scopes=read+control,projects=my-app
ENTRYPOINT ["harness"]
CMD ["serve"]
