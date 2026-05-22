<p align="center">
  <img src="https://raw.githubusercontent.com/Morphicai/harness-fe/main/branding/logo.svg" alt="Harness-FE" width="96" />
</p>

# @harness-fe/dashboard-ui

> React SPA for the Harness-FE dev dashboard. Built with Vite + Tailwind, served as static assets by [`@harness-fe/mcp-server`](../mcp-server).

End users don't install this directly — it ships inside the mcp-server package.

## Local dev

```bash
pnpm -F @harness-fe/dashboard-ui dev
# Visit http://localhost:5174
```

The SPA expects a running mcp-server to talk to. Start one in another terminal:

```bash
pnpm -F @harness-fe/mcp-server dev
# or
npx @harness-fe/mcp-server
```

Pass `?token=<HARNESS_FE_TOKEN>` in the URL — the dev server reuses whatever the daemon prints to stderr.

## Build

```bash
pnpm -F @harness-fe/dashboard-ui build
# outputs dist/
```

`packages/mcp-server` reads `dist/` through `require.resolve('@harness-fe/dashboard-ui/package.json')` at runtime — no copy step required, the workspace symlink is enough in dev and `pnpm deploy` packs the dist into the published tarball.

## Design

Linear / Vercel-style dark theme. Palette tokens live in `tailwind.config.ts` under `theme.extend.colors` — keep them small and semantic (`surface-*`, `ink-*`, `accent-*`). Don't add ad-hoc color values in components.

Animation budget is intentionally low — 150-200ms ease, used for state transitions, never as decoration.
