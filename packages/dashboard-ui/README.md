# @harnessa-fe/dashboard-ui

> React SPA for the Harnessa-FE dev dashboard. Built with Vite + Tailwind, served as static assets by [`@harnessa-fe/mcp-server`](../mcp-server).

End users don't install this directly — it ships inside the mcp-server package.

## Local dev

```bash
pnpm -F @harnessa-fe/dashboard-ui dev
# Visit http://localhost:5174
```

The SPA expects a running mcp-server to talk to. Start one in another terminal:

```bash
pnpm -F @harnessa-fe/mcp-server dev
# or
npx @harnessa-fe/mcp-server
```

Pass `?token=<HARNESSA_FE_TOKEN>` in the URL — the dev server reuses whatever the daemon prints to stderr.

## Build

```bash
pnpm -F @harnessa-fe/dashboard-ui build
# outputs dist/
```

`packages/mcp-server` reads `dist/` through `require.resolve('@harnessa-fe/dashboard-ui/package.json')` at runtime — no copy step required, the workspace symlink is enough in dev and `pnpm deploy` packs the dist into the published tarball.

## Design

Linear / Vercel-style dark theme. Palette tokens live in `tailwind.config.ts` under `theme.extend.colors` — keep them small and semantic (`surface-*`, `ink-*`, `accent-*`). Don't add ad-hoc color values in components.

Animation budget is intentionally low — 150-200ms ease, used for state transitions, never as decoration.
