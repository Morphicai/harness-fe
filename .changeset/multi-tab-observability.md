---
'@harness-fe/protocol': minor
'@harness-fe/runtime': minor
'@harness-fe/mcp-server': minor
'@harness-fe/node-runtime': minor
'@harness-fe/next': minor
'@harness-fe/vite': minor
'@harness-fe/webpack': minor
'@harness-fe/unplugin': minor
'@harness-fe/log': minor
'@harness-fe/react-jsx': minor
---

**Multi-tab observability** — fill the gaps that made Electron / multi-tab / WebSocket-driven bugs hard to diagnose. All schema changes are additive; existing jsonl data continues to work.

### New runtime captures

- **WebSocket frame capture** (`wsPatch.ts`) — every `new WebSocket(...)` is wrapped to emit `open / send / recv / close` frames with payload (text/JSON auto-parsed, binary as size marker), connection id, and `initiator.stack` on open/send. The daemon URL itself is denylisted so the bridge ws does not self-loop.
- **Storage trap** (`storagePatch.ts`) — `localStorage` / `sessionStorage` `setItem / removeItem / clear` and `document.cookie` mutations are intercepted with `initiator.stack`. Cross-tab events (native `storage` event) are tagged `crossTab: true`.
- **REST initiator stack** — `fetchPatch` and `xhrPatch` now stamp each `req` entry with `initiator.stack` so "who issued this request" is answerable without a debugger.

### New MCP tools

- `ws.tail` / `storage.tail` — same tail family as `network.tail` / `console.tail`.
- `network.get({ reqId })` / `ws.get({ wsId })` — pull a single entry's full body when `*.tail` truncates.
- `network.wait_for({ urlContains|urlRegex, method?, statusCode?, timeoutMs })` — Playwright-style request wait, baseline-anchored so pre-existing matches don't satisfy.
- `network.wait_for_idle({ idleMs, timeoutMs })` — resolves after a quiet window.
- `visitor.timeline({ visitorId, types?, tabIds?, sessionIds?, since?, until?, limit? })` — merge all sessions belonging to one visitor into one ascending event stream. Each event carries `tab` + `sessionId` so cross-tab causality (a ws frame in tab A causing a storage write in tab B) is visible in one call.

### Filter discoverability fix

All `*.tail` tools now accept `filter` + `match: 'contains' | 'regex'`, plus narrow params (`level`, `urlContains`, `method`, `statusCode`, `phase`, `which`, `op`, `key`). Previously these were silently stripped by zod when not in the schema.

### Cross-reference docs

`session.tail` description points users to `visitor.timeline` for cross-tab cases. The `*.tail` descriptions now mention that buffers clear on navigate, and `session.tail` is the persistent equivalent.

### Schema (additive only)

- `EventType` union: `+ 'ws'`
- `NetworkEntry`: `+ initiator?: { stack? }`
- New `wsEntrySchema` / `storageEntrySchema`
- `storagePayloadSchema`: `+ initiator?: { stack? }`
- 6 new `COMMAND` codes; old codes unchanged.

### Tests

+65 tests added across unit and E2E:

- 9 wsPatch unit + 9 storagePatch unit + 12 filter unit + 8 visitor.timeline unit
- 6 bridge-ingestion E2E (runtime → bridge → jsonl with real ws)
- 6 MCP-protocol E2E (real `McpServer` + `Client` via `InMemoryTransport`)
- 9 runtime command E2E (real async polling for `wait_for*` / `network.get` / `ws.get`)
- 5 full-stack E2E (`RuntimeClient` + happy-dom + real Bridge + real `JsonlStore`)

Zero regressions.
