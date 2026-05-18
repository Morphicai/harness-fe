# Harnessa-FE Roadmap

Public, rough, and subject to change. File a GitHub issue if you want to push something up the list.

## Now — 0.1.x

Foundation release. Stable for Vite + React.

- [x] Source-aware JSX transform (`data-morphix-loc` / `data-morphix-comp`)
- [x] MCP daemon with WebSocket bridge + JSONL persistence
- [x] Runtime client (console / network / errors / rrweb)
- [x] Vite plugin (React)
- [x] Webpack plugin (React, beta)
- [x] Session recording + replay
- [x] Point-and-task annotation overlay
- [x] Source intelligence tools (`project.source`, `project.where_is`, `project.module_graph`)

## Next — 0.2.x

- [ ] Vue 3 SFC transform — full template + script setup support
- [ ] Webpack plugin promoted from beta
- [ ] Rspack + esbuild + Rollup adapters via unplugin
- [ ] Stable wire-format `PROTOCOL_VERSION` (lock for 1.0)
- [ ] First-class Next.js (App Router) integration
- [ ] Documentation site (Vitepress)

## Later — 0.3.x +

- [ ] Solid / Svelte / Qwik transforms
- [ ] Remote MCP mode (daemon hosted, browser tabs report via authenticated WS)
- [ ] Multi-user sessions for pair-debugging
- [ ] Pluggable persistence backend (IStore → SQLite / Postgres / S3)
- [ ] Agent SDK helpers (typed wrappers over the MCP tools)

## 1.0 — when we get there

- [ ] Stable wire protocol
- [ ] 90%+ test coverage on `protocol` + `unplugin` + `mcp-server`
- [ ] Production-grade error handling and reconnection
- [ ] Security review (browser-side input handling, MCP scope)

## Not on the roadmap

- Production analytics / RUM — Harnessa-FE is a **dev-time** tool. We will not add prod runtime hooks.
- Cloud-hosted dashboard — out of scope. The daemon is local-first by design.
