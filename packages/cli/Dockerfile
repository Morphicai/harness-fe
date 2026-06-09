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

# Storage cap (bytes). Default 1 GiB — override with -e HARNESS_MAX_STORAGE_BYTES=<n>.
# Set to 0 to disable the cap.
ENV HARNESS_MAX_STORAGE_BYTES=1073741824

EXPOSE 47950

# Entrypoint: run `harness` with any extra args passed to `docker run`.
# Typical governed usage:
#   docker run ... morphixai/harness-fe \
#     --governed --admin-user admin --admin-pass "$PW" \
#     --issue-token name=runtime,scopes=write \
#     --issue-token name=agentA,scopes=read+control,projects=my-app
ENTRYPOINT ["harness"]
CMD ["serve"]
