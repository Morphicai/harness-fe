# @harness-fe/protocol

## 4.5.1

### Patch Changes

- b92e4ce: fix(runtime-client): make network.idle track real in-flight requests

  `page.wait_for({predicate: 'network.idle'})` was a fixed ~200ms sleep that resolved unconditionally, and `network.wait_for_idle` resolved once the network ring buffer stopped growing — which falsely reports idle the instant a request's `req` entry stops triggering new pushes, even if its `res` never arrives. Both now poll a real in-flight fetch/XHR count (derived from the buffer's req/res pairing) until it's been zero for `idleMs` (default 500). `page.wait_for` gained an `idleMs` param to match.

- b92e4ce: feat(sandbox): tee Server-Sent Events frames into network_tail/network_get

  A `text/event-stream` response previously only surfaced `{status, durationMs}` — no visibility into individual SSE frames as they streamed in. The fetch interceptor now tees the body (`.clone()`, background read — the app's own consumption is untouched) when content-type matches, parses frames, and emits them as `phase: 'frame'` network entries (`sseEvent`/`sseData`/`sseId`) alongside the existing req/res entries for the same request id. Verified end-to-end against a real streaming endpoint in a real browser (harness-fe#204). XHR-based SSE is not covered (rare in practice).

- b92e4ce: feat(tab_list, page.snapshot): richer tab metadata + compact clickable-element index

  `tab_list` gains `isIframe` (`window.top !== window.self`, disambiguates rows sharing a tabId with their same-origin parent) and `referrer` (a cross-origin iframe's only legitimate signal of what embeds it). `url`/`title`/`isIframe` now refresh live on both full page loads and client-side (SPA) navigation instead of freezing at connect time.

  Adds `page.snapshot` (harness-fe#202): a token-bounded, Snapshot+Refs-style index of visible `<a>`/`<button>` elements, each with a short-lived `ref` usable as `{selector: {ref}}` in `page.click`/`page.type` — no selector to write, refs invalidate on the next snapshot call.

## 4.0.0

### Minor Changes

- 706ef1b: Browser Consent (4.0 · P2) — control commands now require in-page user
  approval before they run, once the daemon is exposed.

  - The daemon pushes a consent policy in `hello.ack`: `off` on loopback solo
    dev (zero-friction, unchanged) and `session` once auth is enabled
    (exposed). Override via `createDaemon({ consent: { mode } })`.
  - Control commands (`page.click/type/scroll/navigate/reload/set_html/
set_style/evaluate/wait_for`) are gated; read-only commands (screenshot,
    dom*query, *\_tail, project.\_) are not. `page.evaluate` always prompts.
  - The runtime client gates `handleCommand`: in `session` mode the first
    control command prompts and the rest of the pageload runs once granted;
    `always` prompts every time; `off` never prompts. No prompter registered ⇒
    fail-safe deny (a policy that can't ask must not silently allow).
  - The in-page overlay shows a consent modal (command preview + Allow once /
    Allow for session / Deny) and registers itself as the prompter.

  Client-side gate by design: consent is the browser-side user's real-time
  approval, closest to the user; it reuses the existing command→response round
  trip (a denied command returns `ok:false` / `CONSENT_DENIED`), so the daemon's
  `sendCommand` path is unchanged. Behaviour is unchanged on loopback (consent
  off). New `hello.ack.consent` field is optional.

- 7274a6c: New browser interaction commands, consent UI, overlay option, and full file upload pipeline.

  **New MCP tools (all control-scoped)**

  - `page.upload` — inject files into `<input type="file">` via DataTransfer; files provided as base64 by the agent
  - `page.select` — set `<select>` value and fire change/input events
  - `page.check` — set checkbox/radio `.checked` and fire change/input events
  - `page.paste` — dispatch ClipboardEvent with synthetic clipboard data (fire-and-forget, no dialog)
  - `page.set_dialog_handler` — pre-register return values for agent-triggered `alert`/`confirm`/`prompt` (read-scope)

  **Consent UI (runtime-only, modern design)**

  - New plugin option `consent?: 'off' | 'session' | 'always'` on `harnessFE()` / `<HarnessScript>`
  - Plugin config takes priority over gateway `hello.ack`; gateway/CLI unchanged
  - Permanent grant stored in `localStorage.__hfe_consent_grant__:<projectId>`; survives page refresh
  - Rebuilt consent panel: blur backdrop + card UI, four buttons (始终允许 / 本次会话 / 仅此次 / 拒绝)
  - Fixed: consent panel now shows `page.click(#submit-btn)` instead of `page.click([object Object])`

  **Overlay hide option**

  - New plugin option `overlay?: boolean` (default `true`) on `harnessFE()` / `<HarnessScript>`
  - `overlay: false` hides the "H" floating icon; data capture is unaffected

  **Sandbox: dialogs channel**

  - New `dialogs` sandbox channel intercepts `alert` / `confirm` / `prompt` / `print` / `beforeunload`
  - Only intercepts when agent is in progress (`__hfe_agent_in_progress__` flag); user calls pass through unchanged

  **Sandbox: forms channel**

  - New `forms` sandbox channel covers the full file upload pipeline to backend:
    - `HTMLInputElement.prototype.click` (file inputs): suppresses native picker when agent-triggered
    - `window.FormData` constructor: injects `__hfe_injected_files__` so `new FormData(form)` + fetch sends real files
    - `HTMLFormElement.prototype.submit`: converts to fetch when agent has injected files; fallback to native on error
  - `page.upload` sets `__hfe_injected_files__` on the input element (auto-cleared after 60s)

- 7042d17: Caller identity (4.0 · P1) — the auth boundary now carries _who_, not just
  allow/deny.

  - New `identity` module: `Principal` type + `resolvePrincipal(req, auth)`
    (loopback → `local`, token → hashed `token:…` id, custom-authorize → `host`),
    layered on the existing auth primitives so the two never disagree on who is
    allowed in.
  - WS connections resolve a `Principal` at upgrade and carry it on
    `PeerSession.principal`.
  - Project / session metadata and `Task` gain optional `createdBy` (write-once)
    and `Task.agentId`; the bridge tags project/session creation with the
    connection's principal and stamps `agentId` on task claim/resolve.

  Phase 1 only **establishes and tags** identity — reads are not yet filtered by
  owner (that is P3 tenant isolation). Behaviour is unchanged: loopback solo dev
  stays a single implicit `local` principal, tokens are still never
  auto-generated, and all new fields are optional.

- 344f806: Task resolution back-link (4.0 · P7) — close the feedback loop from a reported
  problem to its fix and the re-test that proved it.

  - `Task` gains an optional `resolution` object: `{ type, commit, prUrl,
verificationSessionId, verifiedAt }` (`TaskResolution` / `TaskResolutionType`
    exported from protocol). `type` is one of `code-fix` / `config` / `wontfix` /
    `duplicate` / `cannot-reproduce`.
  - `tasks.resolve` accepts a `resolution` arg (after `note`). The daemon defaults
    `verifiedAt` to now when a `verificationSessionId` is supplied without one, and
    records the resolution in the persisted task event. Plain
    `tasks.resolve(id, note)` stays valid — fully backward compatible.
  - `bridge.resolveTask(id, note?, resolution?, principal?)` and the RemoteBridge
    RPC carry the resolution through leader/follower.
  - `@harness-fe/skill` Flow 5 is extended into the full loop: fix → re-drive the
    reported flow (replay to recall the steps, reproduce with `page_*`) → verify
    clean (`errors_tail` / `session_tail`) → `tasks.resolve` with the structured
    resolution.

  Scope: the daemon owns the data link (report → fix → verification session);
  the L1–L4 automation and git writeback remain agent/skill responsibilities,
  driven through harness tools + host git. Additive + optional throughout — no
  behaviour change for existing callers.

### Patch Changes

- 704fb71: Align the linked package group onto a single 4.0.0-next line.

  The gateway/console work only touched some packages, so changesets left the linked
  group split — `log`/`react-jsx` were still 3.x, `next`/`node-runtime` on older 4.0
  prereleases, while gateway/runtime/etc were at next.5. This is a version-only bump
  (no code change) so consumers (morphix, downstream apps) can install ONE consistent
  4.0.0-next.x set without mixing `@harness-fe/protocol` majors.

- 2453e70: **consent `deny` mode + 1 GiB storage cap**

  - Add `consent: 'deny'` mode — all control commands (`page.click`, `page.type`, etc.) are rejected immediately without any user prompt. Safe default for production deployments.
  - **Change default consent from `off` to `deny`**. Previously unguarded control commands ran freely unless `--governed` was passed; now control is disabled by default and must be explicitly enabled.
  - Add `maxTotalBytes` to `RetentionPolicy` (default 1 GiB). After all other pruning passes, oldest sessions are evicted until the data directory falls below the cap.
  - Add `HARNESS_MAX_STORAGE_BYTES` environment variable and `--max-storage-bytes` support. Override the cap with `-e HARNESS_MAX_STORAGE_BYTES=<bytes>` in Docker. Set to `0` to disable.
  - Docker image now sets `ENV HARNESS_MAX_STORAGE_BYTES=1073741824` (1 GiB) by default.

## 4.0.0-next.12

### Patch Changes

- 2453e70: **consent `deny` mode + 1 GiB storage cap**

  - Add `consent: 'deny'` mode — all control commands (`page.click`, `page.type`, etc.) are rejected immediately without any user prompt. Safe default for production deployments.
  - **Change default consent from `off` to `deny`**. Previously unguarded control commands ran freely unless `--governed` was passed; now control is disabled by default and must be explicitly enabled.
  - Add `maxTotalBytes` to `RetentionPolicy` (default 1 GiB). After all other pruning passes, oldest sessions are evicted until the data directory falls below the cap.
  - Add `HARNESS_MAX_STORAGE_BYTES` environment variable and `--max-storage-bytes` support. Override the cap with `-e HARNESS_MAX_STORAGE_BYTES=<bytes>` in Docker. Set to `0` to disable.
  - Docker image now sets `ENV HARNESS_MAX_STORAGE_BYTES=1073741824` (1 GiB) by default.

## 4.0.0-next.8

### Minor Changes

- 7274a6c: New browser interaction commands, consent UI, overlay option, and full file upload pipeline.

  **New MCP tools (all control-scoped)**

  - `page.upload` — inject files into `<input type="file">` via DataTransfer; files provided as base64 by the agent
  - `page.select` — set `<select>` value and fire change/input events
  - `page.check` — set checkbox/radio `.checked` and fire change/input events
  - `page.paste` — dispatch ClipboardEvent with synthetic clipboard data (fire-and-forget, no dialog)
  - `page.set_dialog_handler` — pre-register return values for agent-triggered `alert`/`confirm`/`prompt` (read-scope)

  **Consent UI (runtime-only, modern design)**

  - New plugin option `consent?: 'off' | 'session' | 'always'` on `harnessFE()` / `<HarnessScript>`
  - Plugin config takes priority over gateway `hello.ack`; gateway/CLI unchanged
  - Permanent grant stored in `localStorage.__hfe_consent_grant__:<projectId>`; survives page refresh
  - Rebuilt consent panel: blur backdrop + card UI, four buttons (始终允许 / 本次会话 / 仅此次 / 拒绝)
  - Fixed: consent panel now shows `page.click(#submit-btn)` instead of `page.click([object Object])`

  **Overlay hide option**

  - New plugin option `overlay?: boolean` (default `true`) on `harnessFE()` / `<HarnessScript>`
  - `overlay: false` hides the "H" floating icon; data capture is unaffected

  **Sandbox: dialogs channel**

  - New `dialogs` sandbox channel intercepts `alert` / `confirm` / `prompt` / `print` / `beforeunload`
  - Only intercepts when agent is in progress (`__hfe_agent_in_progress__` flag); user calls pass through unchanged

  **Sandbox: forms channel**

  - New `forms` sandbox channel covers the full file upload pipeline to backend:
    - `HTMLInputElement.prototype.click` (file inputs): suppresses native picker when agent-triggered
    - `window.FormData` constructor: injects `__hfe_injected_files__` so `new FormData(form)` + fetch sends real files
    - `HTMLFormElement.prototype.submit`: converts to fetch when agent has injected files; fallback to native on error
  - `page.upload` sets `__hfe_injected_files__` on the input element (auto-cleared after 60s)

## 4.0.0-next.6

### Patch Changes

- 46775be: Align the linked package group onto a single 4.0.0-next line.

  The gateway/console work only touched some packages, so changesets left the linked
  group split — `log`/`react-jsx` were still 3.x, `next`/`node-runtime` on older 4.0
  prereleases, while gateway/runtime/etc were at next.5. This is a version-only bump
  (no code change) so consumers (morphix, downstream apps) can install ONE consistent
  4.0.0-next.x set without mixing `@harness-fe/protocol` majors.

## 4.0.0-next.4

### Minor Changes

- 25a6106: Task resolution back-link (4.0 · P7) — close the feedback loop from a reported
  problem to its fix and the re-test that proved it.

  - `Task` gains an optional `resolution` object: `{ type, commit, prUrl,
verificationSessionId, verifiedAt }` (`TaskResolution` / `TaskResolutionType`
    exported from protocol). `type` is one of `code-fix` / `config` / `wontfix` /
    `duplicate` / `cannot-reproduce`.
  - `tasks.resolve` accepts a `resolution` arg (after `note`). The daemon defaults
    `verifiedAt` to now when a `verificationSessionId` is supplied without one, and
    records the resolution in the persisted task event. Plain
    `tasks.resolve(id, note)` stays valid — fully backward compatible.
  - `bridge.resolveTask(id, note?, resolution?, principal?)` and the RemoteBridge
    RPC carry the resolution through leader/follower.
  - `@harness-fe/skill` Flow 5 is extended into the full loop: fix → re-drive the
    reported flow (replay to recall the steps, reproduce with `page_*`) → verify
    clean (`errors_tail` / `session_tail`) → `tasks.resolve` with the structured
    resolution.

  Scope: the daemon owns the data link (report → fix → verification session);
  the L1–L4 automation and git writeback remain agent/skill responsibilities,
  driven through harness tools + host git. Additive + optional throughout — no
  behaviour change for existing callers.

## 4.0.0-next.0

### Minor Changes

- 9a3c5e1: Browser Consent (4.0 · P2) — control commands now require in-page user
  approval before they run, once the daemon is exposed.

  - The daemon pushes a consent policy in `hello.ack`: `off` on loopback solo
    dev (zero-friction, unchanged) and `session` once auth is enabled
    (exposed). Override via `createDaemon({ consent: { mode } })`.
  - Control commands (`page.click/type/scroll/navigate/reload/set_html/
set_style/evaluate/wait_for`) are gated; read-only commands (screenshot,
    dom*query, *\_tail, project.\_) are not. `page.evaluate` always prompts.
  - The runtime client gates `handleCommand`: in `session` mode the first
    control command prompts and the rest of the pageload runs once granted;
    `always` prompts every time; `off` never prompts. No prompter registered ⇒
    fail-safe deny (a policy that can't ask must not silently allow).
  - The in-page overlay shows a consent modal (command preview + Allow once /
    Allow for session / Deny) and registers itself as the prompter.

  Client-side gate by design: consent is the browser-side user's real-time
  approval, closest to the user; it reuses the existing command→response round
  trip (a denied command returns `ok:false` / `CONSENT_DENIED`), so the daemon's
  `sendCommand` path is unchanged. Behaviour is unchanged on loopback (consent
  off). New `hello.ack.consent` field is optional.

- a3bd7ea: Caller identity (4.0 · P1) — the auth boundary now carries _who_, not just
  allow/deny.

  - New `identity` module: `Principal` type + `resolvePrincipal(req, auth)`
    (loopback → `local`, token → hashed `token:…` id, custom-authorize → `host`),
    layered on the existing auth primitives so the two never disagree on who is
    allowed in.
  - WS connections resolve a `Principal` at upgrade and carry it on
    `PeerSession.principal`.
  - Project / session metadata and `Task` gain optional `createdBy` (write-once)
    and `Task.agentId`; the bridge tags project/session creation with the
    connection's principal and stamps `agentId` on task claim/resolve.

  Phase 1 only **establishes and tags** identity — reads are not yet filtered by
  owner (that is P3 tenant isolation). Behaviour is unchanged: loopback solo dev
  stays a single implicit `local` principal, tokens are still never
  auto-generated, and all new fields are optional.

## 3.2.0

### Minor Changes

- 2671c1c: **New `@harness-fe/sandbox` package + runtime refactor + 3 new MCP tools.** The runtime's browser-API patching is now a standalone lib with observer + interceptor middleware across 9 channels.

  ## New package: `@harness-fe/sandbox`

  A reusable browser sandbox / interceptor framework. Used internally by `@harness-fe/runtime`, but standalone-usable in any project (micro-frontend hosts, custom MorphixAI base, etc.).

  ### 9 channels

  | Channel            | Observe | Intercept                                                     |
  | ------------------ | ------- | ------------------------------------------------------------- |
  | `fetch`            | ✓       | onRequest / onResponse (async-aware)                          |
  | `xhr`              | ✓       | onRequest / onResponse                                        |
  | `ws`               | ✓       | onConstruct / onSend / onMessage / onClose                    |
  | `storage`          | ✓       | onGet / onSet / onRemove / onClear (local + session + cookie) |
  | `navigation` (new) | ✓       | onPush / onReplace / onAssign / onHash                        |
  | `console`          | ✓       | —                                                             |
  | `errors`           | ✓       | —                                                             |
  | `globals` (new)    | ✓       | onGet / onSet / onDelete (per-key watch list)                 |
  | `indexeddb` (new)  | ✓       | onOpen / onPut / onGet / onDelete / onClear                   |

  ### Safety properties

  - **Identity preserved.** typeof / instanceof / constructor / prototype chain / for...in / JSON.stringify all behave bit-identically to native.
  - **`.call()` bypass closed.** Proxy + prototype double patch on Storage / WebSocket / XHR — `Storage.prototype.setItem.call(...)` etc. route through the interceptor.
  - **`new.target` check.** `WebSocket(...)` without `new` throws TypeError (matches spec).
  - **Global reentry guard.** Consumer code recursively touching a patched API (e.g. `onSet: (k,v) => localStorage.setItem('echo:'+k, v)`) does NOT loop — inner calls bypass interceptors. Guard counter lives on `globalThis` so cross-module-instance installs (HMR dup) share it.
  - **Silent graceful degradation.** Every patch step in try/catch — if the engine refuses, the channel skips, business code never sees a sandbox error.

  ## `@harness-fe/runtime` consumes the sandbox

  - Deleted in-tree `fetchPatch.ts` / `xhrPatch.ts` / `wsPatch.ts` / `storagePatch.ts` / `initiator.ts` (1142 LOC of patch code).
  - `capture.ts` is now a thin adapter (~175 LOC) that maps `SandboxEvent` → `NetworkEntry / WsEntry / StorageEntry / ConsoleEntry / ErrorEntry / NavigationEntry / GlobalsEntry / IndexedDbEntry` and pushes through the existing bridge.
  - **Public API unchanged**: `RuntimeClient` + auto-start work exactly as before; this is a pure internal refactor.

  ## 3 new MCP tools

  | Tool              | Filters                       | Use case                                       |
  | ----------------- | ----------------------------- | ---------------------------------------------- |
  | `navigation.tail` | `kind`, `filter`              | track SPA route changes / `location.*` setters |
  | `globals.tail`    | `op`, `key`, `filter`         | detect global pollution / watch app state      |
  | `indexeddb.tail`  | `op`, `store`, `db`, `filter` | who reads/writes IDB                           |

  Each follows the existing `*.tail` family:

  - `filter` + `match` (contains / regex)
  - typed narrows
  - per-tab default with `tabId` override
  - `session.tail({ type: 'X' })` for cross-navigate history

  ## Protocol additions (all additive)

  - `NavigationEntry` / `GlobalsEntry` / `IndexedDbEntry` zod schemas + types
  - 3 new `COMMAND` codes
  - `EventType` union gains `'navigation' | 'globals' | 'indexeddb'` literals

  ## Bug fixes carried by the refactor

  - **`storage.setItem` no longer crashes when given non-string values.** The 3.1.x in-tree `storagePatch` forwarded raw values into a `clip(value).slice(...)` call and threw `TypeError: s.slice is not a function` for `setItem(key, Date.now())` / `setItem(key, true)` / `setItem(key, {...})` etc. Native Storage implicitly `ToString`s the value (Web Storage spec), and a lot of business code relies on that. The sandbox rewrite stringifies the value at every setItem entry (proxy method, proxy `set` trap, `Storage.prototype.setItem.call(...)` bypass path) before any clipping. 5 regression tests pin the behaviour.

  ## Tests

  - `@harness-fe/sandbox`: 84 unit / 2 skip / 86 total
  - `@harness-fe/runtime`: 84 / 84 (post-refactor, deleted patch tests migrated to sandbox)
  - `@harness-fe/mcp-server`: 265 / 265
  - Real-browser Playwright e2e: 26 / 26 in Chromium 1223 (V8/Blink)

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

## 3.0.0

### Patch Changes

- 65f2b96: Add MCP tool `dashboard.open` so agents can surface the dev dashboard
  to the human user.

  The tool returns the dashboard URL (with token pre-populated when auth
  is configured) and optionally launches the user's default browser via
  `open` (macOS) / `xdg-open` (Linux) / `cmd /c start ""` (Windows). Set
  `HARNESS_FE_HEADLESS=1` to suppress browser-launch attempts in remote
  or Docker contexts.

  A `sessionId` argument deep-links into `/dashboard/sessions/:id` so
  agents can point users at a specific recording.

  ### What's new

  - `protocol`: `COMMAND.DASHBOARD_OPEN = 'dashboard.open'`
  - `mcp-server`:
    - new `openBrowser.ts` — cross-platform launcher with dependency-injection seams for unit testing
    - new `dashboardUrl.ts` — pure URL composer (handles token, session deep-link, missing port)
    - `IBridge.getAuthToken()` getter so the URL composer can read the configured token without reaching into private fields
    - tool registration in `mcp.ts`

  13 new unit tests pin the cross-platform spawn behavior and URL shape.

- 88e41a2: Wire up the React SPA dashboard end-to-end (PR C of A-E).

  ### `@harness-fe/dashboard-ui`

  - Real routes — `ProjectList` (`/`) and `SessionDetail` (`/sessions/:id`) — replacing the placeholder hero
  - Glass header with a live-pill indicator that flashes green on each `dashboard.update`
  - Tab/recording/timeline/exports panels matching the legacy HTML dashboard's information density, in a Linear-style dark layout
  - Inline "Create replay" buttons that POST to `/api/sessions/:id/replay` and reveal a link to `/replay/:exportId`
  - `useApi` / `useLiveBridge` hooks: GET wrapper with token auth + singleton WS subscriber with backoff reconnect
  - ~64 KB gzip total bundle

  ### `@harness-fe/mcp-server`

  - New `dashboardSpa.ts` handler — serves the SPA at `/dashboard/*` from `@harness-fe/dashboard-ui/dist`. Hashed assets get long-lived immutable cache; `index.html` is `no-store`. Path traversal blocked
  - WS subscriber registry: clients sending `hello { role: 'dashboard-client' }` get added to `dashboardSubscribers` and receive `dashboard.update` frames
  - Broadcast hooks at `upsertSession` (new/update), `closeSession`, `appendRecording` (debounced 200ms per session), and `writeExport` (via API callback)
  - `notifyDashboard()` public method so future code paths can push their own update kinds

  ### `@harness-fe/protocol`

  - New peer role `dashboard-client`
  - New `dashboardUpdateFrameSchema` carrying `{ kind, sessionId?, projectId?, ts }`
  - `frameSchema` discriminated union extended

  Old `/` and `/sessions/:id` HTML routes remain in place during this PR;
  the redirect + legacy deletion lands in PR D.

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

## 2.0.0

### Minor Changes

- 5d02bbf: LAN-friendly daemon with token auth, MCP-over-HTTP transport, and Vue 2
  syntax hardening.

  **Daemon (`@harness-fe/mcp-server`)**

  - New CLI flags: `--host`, `--port`, `--token [value|auto]`,
    `--mcp-transport <stdio|http>`, `--mcp-path`, `--public-host`. Matching
    env vars: `HARNESS_FE_HOST`, `HARNESS_FE_TOKEN`, etc.
  - Refuses to bind a non-loopback host without `--token` to prevent
    accidental LAN exposure of console / network / DOM recordings.
  - Token auth is enforced once at the bridge HTTP/WS edge, so the
    dashboard, replay viewer, events handler, and MCP HTTP transport all
    share the same gate. Browsers get an HTML login form; agents/CLIs use
    `Authorization: Bearer`. Cookie, query, and WS subprotocol carriers
    are also accepted.
  - MCP-over-HTTP transport via `StreamableHTTPServerTransport`, mounted
    on the bridge HTTP server at `--mcp-path` (default `/mcp`). Lets a
    remote Claude Code / Cursor share one daemon with the dev machine.
  - `npx @harness-fe/mcp-server` now works (shebang fixed, postbuild
    chmod, `engines.node >= 18`).

  **Protocol (`@harness-fe/protocol`)**

  - Added `DEFAULT_HOST`, `isLoopbackHost`, `buildWsUrl`, `buildHttpUrl`.

  **Plugin (`@harness-fe/unplugin` + vite/webpack wrappers)**

  - `HarnessFEOptions.token` — appended to the daemon WS URL and threaded
    through `__HARNESS_FE__` so the runtime client connects under LAN
    mode.
  - `HarnessFEOptions.safeMode` (default `true`) — Vue SFC transform
    now strict-downgrades on `compiler-sfc` errors, wraps walk in
    try/catch, and re-parses its own output. Legacy Vue 2 syntax (filters,
    `<template functional>`, …) is silently skipped instead of risking a
    corrupt template fed downstream.
  - `HARNESS_FE_DRY_RUN=1` builds without injecting, then prints a
    coverage report (files attempted/injected, skip counts, first 20
    skipped paths) on process exit. Use it to scope adoption in legacy
    Vue projects.

  See `docs/lan-mode.md` and `docs/vue2-compat.md` for the developer
  guides.

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

## 0.7.0

### Minor Changes

- c4a1f59: feat: Edge Runtime HTTP transport (Phase 1)

  - `@harness-fe/protocol`: add `httpBatchSchema` / `HttpBatch` for stateless POST /events
  - `@harness-fe/mcp-server`: new `POST /events` + `GET /events/ping` HTTP endpoints; `Bridge.handleHttpBatch()` routes batches into the same session timeline as the WebSocket path
  - `@harness-fe/node-runtime`: `Transport` interface + `WsTransport` (existing behaviour) + `HttpBatchTransport` (fetch-based, 500ms flush, 50-event batching, 5xx retry, outbox cap); automatic selection via `NEXT_RUNTIME=edge` / `HARNESS_FE_TRANSPORT=http`; `ws` moved to optional peer dependency; new `./auto-edge` export
  - `@harness-fe/next`: webpack plugin injects `@harness-fe/node-runtime/auto-edge` into edge-runtime bundles (webworker target)
