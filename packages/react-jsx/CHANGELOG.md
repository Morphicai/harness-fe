# @harness-fe/react-jsx

## 3.1.0

### Minor Changes

- b63c378: **Multi-tab observability** — fill the gaps that made Electron / multi-tab / WebSocket-driven bugs hard to diagnose. All schema changes are additive; existing jsonl data continues to work.

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

## 1.0.2

### Patch Changes

- 74be490: 1.0.2 — coordinated patch across the linked group

  **Functional changes:**

  - `@harness-fe/node-runtime` — auto-captured server-side `console.*` calls now inherit the request's `sessionId` automatically when used with `@harness-fe/next`. Previously they became orphans unless the handler was wrapped with `withHarnessTracing`. Mechanism: a new `setSessionIdProvider(fn)` dependency-injection setter; the Next adapter pushes its `cache()`-backed getter in on first render. ALS still wins when populated; orphan behaviour unchanged when no adapter is loaded.
  - `@harness-fe/log` — node-side emit path simplified to delegate sessionId resolution to `node-runtime.getRequestSessionId()`. Same observable behaviour; less duplicated logic. Peer-dependency declarations cleaned up — the dynamic-import contract is described in the README instead.
  - `@harness-fe/next` — `sessionId.ts` module side-effect-registers its `cache()` getter with node-runtime via `setSessionIdProvider`. No new exports.

  **Release plumbing:**

  - Republish `@harness-fe/log` after the 24-hour cooldown from a prior unpublish. Defensive listing covering all 10 linked packages so the bump is genuinely lockstep.
  - `scripts/release-publish.sh` handles the npm "Cannot implicitly apply latest tag to a version lower than current latest" case by publishing under a staging tag and then explicitly moving `latest` via `npm dist-tag add`.

  **Docs (shipping with the release):**

  - New READMEs for `packages/log`, `packages/next`, `packages/node-runtime`.
  - New `VISION.md` (three nested mission directions) and `docs/troubleshooting.md`.
  - `ARCHITECTURE.md` — new section explaining server-side sessionId resolution chain (ALS → adapter provider → orphan).
  - `ROADMAP.md` reframed around the three mission directions.

## 1.0.0

### Minor Changes

- 2019214: Version alignment: reset `@harness-fe/log` and `@harness-fe/next` to the 0.9.x line, locking all core packages together via `linked` in `.changeset/config.json`

  Background: `@harness-fe/log`'s initial Changesets minor bump took it to **1.0.0** (Changesets treats brand-new packages as starting at 1.0.0 unless explicitly minor-bumped from a prior 0.x), then the next minor pushed it to 2.0.0 — leaving the rest of the ecosystem at 0.6–0.9 while `log` and `next` (which transitively bumped) sat at 2.0. Functionally fine, but cosmetically off.

  With no public consumer of this package yet, accepting the inconvenience of a version downgrade is cheap. The previous `log@{1.0.0, 2.0.0, 2.0.1}` and `next@{1.0.0, 2.0.0}` releases will be deprecated on npmjs.com pointing to 0.9.x as the canonical line.

  This changeset bumps **every** core package by `minor` so they all land at the same 0.x.0 going forward, plus locks them via `linked` so future bumps stay in lockstep. Also includes the Turbopack-fix browser/node split for `@harness-fe/log` that was previously queued as a patch.
