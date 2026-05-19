# `react-demo`

Vite + React playground. Reference setup for the source-aware harness.

## What it shows

- Source-aware JSX tagging: every element carries `data-morphix-loc` + `data-morphix-comp` so the daemon can answer `project.where_is` / `project.source`
- Live console / network / error capture via the runtime client
- rrweb session recording — `session.recordings.list` then `session.replay.create` to inspect it
- Point-and-task annotation overlay

## Run

```bash
pnpm install
pnpm --filter harnessa-fe-react-demo dev   # http://localhost:5173
```

The Vite plugin auto-connects to the MCP daemon at `ws://127.0.0.1:47729` (override with `HARNESSA_FE_URL`).

## Verify

```bash
pnpm --filter harnessa-fe-react-demo e2e
```

Runs four standalone scripts (all `tsx`, no Playwright runner):

- `bridge.e2e.ts` — spawns an in-process bridge, asserts plugin connect + projectId registration
- `inject.e2e.ts` — exercises the `transformIndexHtml` handler and asserts the runtime config script is injected
- `source-aware.e2e.ts` — spins up Vite + bridge, asserts `project.where_is` finds a tagged element
- `closed-loop.e2e.ts` — full stack: plugin + runtime + bridge, agent issues a `page.click`, runtime executes and reports

## Source of truth

- App: `src/App.tsx`
- Vite config: `vite.config.ts`
- E2E: `e2e/*.ts`
