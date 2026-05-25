# @harness-fe/runtime

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

### Patch Changes

- Updated dependencies [b63c378]
  - @harness-fe/protocol@3.1.0

## 3.0.1

### Patch Changes

- 3cb3cc8: Add an "Open dashboard" button to the in-page overlay info card. The
  button derives the daemon's dashboard URL from the runtime's `mcpUrl`
  (swap `ws://`/`wss://` → `http://`/`https://`, point at `/dashboard/`,
  carry the token query), deep-links to the current session, and pops it
  in a new tab on click. Hidden when no `mcpUrl` is configured.

  If the host page blocks popups (sandboxed iframe, strict CSP), the
  button falls back to copying the URL so the user can paste it.

## 3.0.0

### Minor Changes

- 10d669c: Overlay UX + screenshot fixes:

  ### Draggable FAB with position persistence

  The floating "H" button can now be dragged anywhere on screen. The
  position is saved to `localStorage` (`__harness_fe_fab_pos__`) and
  clamped into the viewport on every load — resilient to monitor
  swaps, dev-tools panel changes, and viewport resizes. Follower cards
  (info / reports / question) anchor relative to the FAB and flip side
  based on available space, so they're always reachable no matter where
  you drop the button.

  A 5px movement threshold separates click from drag; clicking the FAB
  still opens the info card, dragging it never does.

  ### Dark, glass-style cards

  The info / reports / question panels switched to a dark theme with
  backdrop blur, matching the new dashboard SPA's Linear-style palette.
  Info pills, primary/secondary buttons, and status dots refreshed for
  contrast and clarity on both light and dark host pages.

  ### Screenshot fixes

  - **Overlay no longer bleeds into screenshots.** The "H" FAB and any
    open info card used to land in the corner of every shot. The
    `PAGE_SCREENSHOT` handler now flips `visibility: hidden` on the
    overlay host for the duration of the capture, restoring it
    (try/finally — survives capture errors) immediately after.
  - **Default to opaque background.** Captures were rendering blank for
    pages with no explicit body background. Default is now `#ffffff`;
    callers can pass `backgroundColor: '#0a0a0f'` (or any CSS color)
    for a dark backdrop, or `backgroundColor: null` to opt back into a
    transparent capture (PNG/WebP only — JPEG has no alpha).

  ### Tests

  9 new tests:

  - 4 in `overlay.test.ts` — default position, persisted restore, viewport clamp on shrink, malformed-storage fallback
  - 5 in `commands.test.ts` (new file) — default opaque background, transparent opt-in via null, custom color, overlay-hidden during capture, overlay restored on error

### Patch Changes

- 953339f: Fix: rrweb FullSnapshot baseline was silently dropped in the "record-first,
  upload-later" scenario, leaving sessions permanently unreplayable with
  `window contains no rrweb FullSnapshot (type:2) baseline, and no earlier
baseline could be found — replay would be blank`.

  ### Root cause

  Two compounding bugs:

  1. **Outbox FIFO eviction dropped the FullSnapshot first.** The outbox
     capped at 500 frames / 8 MB and evicted via `shift()` (oldest-first).
     rrweb emits the FullSnapshot at `record.start()` — making it the
     _oldest_ frame in the outbox. If the daemon was unreachable for any
     meaningful stretch (laptop sleep, daemon restart, slow first connect
     in dev), incremental snapshots filled the buffer and evicted the
     baseline before drain.
  2. **rrweb only emits FullSnapshot once.** After eviction, no later code
     path re-emitted it. WebSocket reconnects (incl. daemon restart) reused
     the existing `record()` lifecycle, which produces only incremental
     (type:3) events after the initial emit.

  ### Fix (two layers)

  - **Layer 1 — Re-baseline on every connection.** `client.onHelloAck` now
    calls `recorder.takeFullSnapshot()`, which wraps rrweb's
    `record.takeFullSnapshot(true)`. Every successful ack — first connect,
    reconnect after daemon restart, network blip recovery — gets a fresh
    type:2 baseline.
  - **Layer 2 — Outbox sticky protection.** Frames flagged `sticky` (today:
    any rrweb chunk containing a type:2 event) survive eviction even when
    the cap is busted. Non-sticky frames are evicted FIFO; if outbox is
    _all-sticky and still over cap_, the oldest sticky is dropped as a last
    resort (replay only needs the most recent baseline).

  Outbox logic is now extracted to `src/outbox.ts` with 9 unit tests pinning
  the eviction guarantees, including a regression test that reproduces the
  original bug shape and proves the sticky frame survives.

- Updated dependencies [65f2b96]
- Updated dependencies [88e41a2]
- Updated dependencies [10d669c]
  - @harness-fe/protocol@3.0.0

## 2.0.0

### Patch Changes

- Updated dependencies [5d02bbf]
  - @harness-fe/protocol@2.0.0

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

- Updated dependencies [74be490]
  - @harness-fe/protocol@1.0.2

## 1.0.0

### Minor Changes

- 2019214: Version alignment: reset `@harness-fe/log` and `@harness-fe/next` to the 0.9.x line, locking all core packages together via `linked` in `.changeset/config.json`

  Background: `@harness-fe/log`'s initial Changesets minor bump took it to **1.0.0** (Changesets treats brand-new packages as starting at 1.0.0 unless explicitly minor-bumped from a prior 0.x), then the next minor pushed it to 2.0.0 — leaving the rest of the ecosystem at 0.6–0.9 while `log` and `next` (which transitively bumped) sat at 2.0. Functionally fine, but cosmetically off.

  With no public consumer of this package yet, accepting the inconvenience of a version downgrade is cheap. The previous `log@{1.0.0, 2.0.0, 2.0.1}` and `next@{1.0.0, 2.0.0}` releases will be deprecated on npmjs.com pointing to 0.9.x as the canonical line.

  This changeset bumps **every** core package by `minor` so they all land at the same 0.x.0 going forward, plus locks them via `linked` so future bumps stay in lockstep. Also includes the Turbopack-fix browser/node split for `@harness-fe/log` that was previously queued as a patch.

### Patch Changes

- Updated dependencies [2019214]
  - @harness-fe/protocol@1.0.0

## 0.6.4

### Patch Changes

- 88af49d: UX: screenshots are now optional, with inline preview

  The "Report a problem" flow no longer auto-launches the annotate modal on every element pick. After locking an element the user goes straight to the question textarea; a "📷 Add screenshot" button is available if they want to attach an annotated PNG. When attached, the question panel shows a thumbnail preview with Edit + Remove controls. Esc inside annotate preserves any prior attachment and returns to the question step.

## 0.6.3

### Patch Changes

- Updated dependencies [c4a1f59]
  - @harness-fe/protocol@0.7.0
