# Harnessa-FE Roadmap

Public, rough, and subject to change. File a GitHub issue if you want to push something up the list.

## Shipped (0.1.x – 1.0.x)

Foundation through general availability across the supported stack.

- [x] Source-aware JSX transform (`data-morphix-loc` / `data-morphix-comp`)
- [x] `@harnessa-fe/react-jsx` — `jsxImportSource` runtime; works in any React 17+ toolchain without a bundler plugin
- [x] MCP daemon with WebSocket bridge + HTTP-batch endpoint (for Edge) + JSONL persistence
- [x] Runtime client — console / network / errors / rrweb + in-page "H" overlay + annotated tasks
- [x] Vite + React, Vite + Vue 3 — stable
- [x] Webpack + React, Webpack + Vue 3 — stable
- [x] Session recording + replay
- [x] Point-and-task annotation overlay
- [x] Source intelligence tools (`project.source`, `project.where_is`, `project.module_graph`)
- [x] First-class Next.js integration (App + Pages Router, webpack + Turbopack, Node + Edge)
- [x] `@harnessa-fe/node-runtime` — server-side capture, ALS + DI sessionId resolution, dual transport
- [x] `@harnessa-fe/next` — `<HarnessaScript>` Server Component auto-boots node-runtime and seeds the same `sessionId` into SSR + client
- [x] `@harnessa-fe/log` — isomorphic structured logger; same call works in Server Components, Route Handlers, and Client Components
- [x] Stable wire-format `PROTOCOL_VERSION` (locked at 1.0)
- [x] OIDC-trusted-publisher npm releases (plus `--provenance`) with NPM_TOKEN fallback
- [x] Disk auto-purge + write-time size limits — retention policy bounds disk usage
- [x] `@harnessa-fe/skill` — agent playbook published as a standalone npm

## Next — 1.1.x

- [ ] **Streaming phase 4** — child-agent `spawn` → stream mode (execution visible in real time)
- [ ] **Streaming phase 5** — SSE `Last-Event-ID` reconnection for long-running tool runs
- [ ] **Rspack + esbuild + Rollup adapters** via unplugin
- [ ] **Documentation site** (Vitepress) — currently READMEs only
- [ ] **Solid / Svelte / Qwik transforms**

## Later — 1.2.x +

- [ ] **Remote MCP mode** — daemon hosted, browser tabs report via authenticated WS
- [ ] **Pluggable persistence backend** — `IStore` → SQLite / Postgres / S3
- [ ] **Multi-user sessions** for pair-debugging
- [ ] **Agent SDK helpers** — typed wrappers over the MCP tools
- [ ] **`data-scope-isolation`** — per-app data isolation in mini-app shells
- [ ] **`workspace-sharing`** — multi-user collaboration on the same workspace
- [ ] **`workspace-versioning`** — version history & rollback

## Architectural follow-ups (no schedule)

- [ ] Extract a `@harnessa-fe/react-session` micro-package and stop having `@harnessa-fe/next` self-register into node-runtime — the current side-effect DI works but a tiny dedicated package would be the textbook layering
- [ ] React Native runtime client (rrweb-equivalent native capture is the hard part)

## Not on the roadmap

- Production analytics / RUM — Harnessa-FE is a **dev-time** tool. We will not add prod runtime hooks.
- Cloud-hosted dashboard — out of scope. The daemon is local-first by design.
- Telemetry phoning home from the user's machine — the dev tool stays silent unless the user explicitly opts in.
