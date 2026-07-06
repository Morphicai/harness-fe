# Shared base image for all three harness-bench conditions (harness-fe /
# chrome-devtools-mcp / none). Condition only differs by which .mcp.json is
# mounted and whether the harness-fe prewarm script runs — the image itself
# is identical across conditions so Inspect AI's sandbox config can reuse one
# Dockerfile for every sample. See harness-bench-tech-design.md §3.2.

FROM node:20-bookworm-slim

# playwright's own base image bundles the right Chromium build + all the
# system libs it needs (fonts, libnss3, etc.) — pulling headless Chrome in
# manually on debian-slim is a well-known footgun (missing shared libs), so
# we install playwright's browser via its own installer instead of apt.
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates curl git \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@9 --activate

# Claude Code CLI — the system under test, invoked headless (`claude -p`)
# by solver.py. See harness-bench-tech-design.md §3.1 for the exact flags.
RUN npm install -g @anthropic-ai/claude-code

WORKDIR /bench

# Playwright + its Chromium build, used by:
#   - bench/prewarm/harness_prewarm.ts (Condition A only)
#   - fixtures/*/oracle.ts for UI-tier bugs (all conditions, post-hoc scoring)
COPY prewarm/package.json prewarm/package-lock.json* ./prewarm/
RUN cd prewarm && npm install && npx playwright install --with-deps chromium

# Each sample gets its own checkout of the target demo app applied under
# /work/<sample-id> at runtime by solver.py — the image itself carries no
# app source, keeping one image reusable across every bug/app combination.

ENTRYPOINT ["/bin/bash"]
