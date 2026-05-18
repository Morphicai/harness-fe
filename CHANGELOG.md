# Changelog

All notable changes to this project will be documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — 2026-05-18

First public release on npm.

### Added

- **Source-aware build transform** — `data-morphix-loc` / `data-morphix-comp` attributes injected into every JSX element (`@morphixai/harnessa-fe.unplugin`)
- **Vite plugin** — stable for React on Vite 5–7 (`@morphixai/harnessa-fe.vite`)
- **Webpack plugin** — beta for React on Webpack 5 (`@morphixai/harnessa-fe.webpack`)
- **Browser runtime client** — console / network / error capture, rrweb session recording, annotation overlay, page command execution (`@morphixai/harnessa-fe.runtime`)
- **MCP server daemon** — stdio MCP bridge for AI agents (Claude, Cursor, Kiro) + WebSocket bridge for plugin/runtime peers + JSONL persistence in `~/.harnessa/` (`@morphixai/harnessa-fe.mcp-server`)
- **Shared protocol** — wire-format types and Zod schemas (`@morphixai/harnessa-fe.protocol`)
- **Session replay** — `session.replay.create` plus rrweb chunk slice tools
- **Source intelligence** — `project.source`, `project.where_is`, `project.module_graph` so agents can resolve DOM nodes back to source files
- **Point-and-task annotation** — in-page overlay lets humans pin a task to a UI element for the agent to pick up

### Known limitations

- Vue 3 SFC transform is incomplete (basic template tagging only)
- Webpack plugin is beta — fast-refresh edge cases may drop the WebSocket
- Wire format (`PROTOCOL_VERSION`) is not yet frozen — pin exact versions in production

[0.1.0]: https://github.com/morphixai/harnessa-fe/releases/tag/v0.1.0
