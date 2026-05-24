# Contributing to Harness-FE

Thanks for considering a contribution. This guide covers the minimal workflow to get hacking.

## Prerequisites

- **Node.js** ≥ 20
- **pnpm** 9.15.0 (locked via `packageManager` field; corepack handles this for you)

## Setup

```bash
git clone https://github.com/Morphicai/harness-fe.git
cd harness-fe
pnpm install
pnpm build
```

## Repo layout

```
packages/
  protocol/         # shared types + schemas (no external deps in src)
  unplugin/         # build-time transform core
  vite-plugin/      # vite adapter (thin wrapper over unplugin)
  webpack-plugin/   # webpack adapter
  runtime-client/   # browser SDK
  node-runtime/     # node + edge server SDK (errors, console, ALS + DI sessionId)
  next/             # next.js integration (Server Component + next.config wrapper)
  log/              # isomorphic structured logger (user-facing API)
  react-jsx/        # jsxImportSource runtime for source-tagging
  agent-skill/      # standalone SKILL.md playbook for AI agents
  mcp-server/       # daemon: stdio MCP + WS bridge + HTTP-batch + persistence
examples/
  react-demo/       # Vite + React playground
  vue-demo/         # Vite + Vue 3 playground
  webpack-demo/     # Webpack + React playground
  webpack5-vue3-demo/ # Webpack 5 + Vue 3 playground
  iframe-demo/      # Same-origin iframe identity inheritance
```

For an interactive view of the build graph: `pnpm graph` (DOT to stdout) or `pnpm graph:html` (writes `dep-graph.html`).

## Common commands

```bash
pnpm build                # build all packages (turbo)
pnpm typecheck            # tsc --noEmit across the workspace
pnpm test                 # vitest in every package
pnpm dev                  # watch-mode rebuilds + demo dev servers
pnpm demo                 # build then run the react demo
pnpm restart:mcp          # restart the local MCP daemon
```

Per-package:

```bash
pnpm --filter @harness-fe/vite build
pnpm --filter @harness-fe/mcp-server test
```

## End-to-end run

1. `pnpm build`
2. `pnpm --filter harness-fe-react-demo dev` — opens `http://localhost:5173`
3. The Vite plugin auto-connects to the MCP daemon at the default URL `ws://127.0.0.1:47729`. Override with `HARNESS_FE_URL=ws://host:port` if needed.
4. Connect Claude Code (or any MCP-aware client) to `npx @harness-fe/mcp-server`

## Commit style

We follow Conventional Commits. Common prefixes:

- `feat:` — new functionality
- `fix:` — bug fix
- `chore:` — tooling, deps, infra
- `docs:` — docs only
- `refactor:` — no behavior change
- `test:` — tests only

Keep the subject ≤ 72 chars. Use the body to explain *why*, not *what*.

## PR checklist

- [ ] `pnpm typecheck` passes
- [ ] `pnpm test` passes
- [ ] New behavior has a test (vitest or example)
- [ ] Public API changes are documented in the affected package's README
- [ ] If wire-format changes: bump `PROTOCOL_VERSION` in `packages/protocol/src/index.ts`

## Releasing (maintainers)

See [`docs/release.md`](./docs/release.md) — short version:

```bash
# bump versions, regenerate CHANGELOG
pnpm changeset version

# verify the tarballs
pnpm -r publish --dry-run --access public

# publish in dep order
pnpm -r publish --access public
```

## Reporting issues

File on [GitHub issues](https://github.com/Morphicai/harness-fe/issues). Include:

- Bundler + version (Vite 7.3.3 / Webpack 5.106.x / etc.)
- Framework + version (React 18 / Vue 3.4 / etc.)
- Minimal repro (a `vite.config.ts` + one component is usually enough)
- The `~/.harness/<projectId>/sessions/<sessionId>/` directory if the bug is runtime-related

## License

By contributing you agree your work is licensed under [MIT](./LICENSE).
