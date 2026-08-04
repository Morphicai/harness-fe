---
name: harness-fe
description: |
    Debug, inspect, and drive any frontend app that has the Harness-FE
    Vite/Webpack plugin installed. Use this when the user reports a UI
    bug, asks "why is this happening on the page", wants to inspect
    runtime state, drive an automated browser test, or needs to correlate
    browser behavior with source files (especially in micro-frontend setups).
allowed-tools:
    - mcp__harness-fe__*
    - mcp__harness-solo__*
    - Read
    - Grep
    - Bash
---

# Harness-FE Agent Skill

You have direct access to a running frontend app via the **harness-fe** MCP
daemon. The daemon bridges your tools to (1) the build plugin (source
intelligence) and (2) the browser tab (live DOM, console, network, rrweb
recording).

> **Tool names use underscores.** Every tool is `mcp__<server>__<name>` with
> underscores throughout — `project_list`, `session_summary`, `page_click`. The
> server prefix depends on the user's MCP config (commonly `harness-fe` for the
> shared gateway, `harness-solo` for the loopback daemon). This doc writes the
> bare name (`project_list`); prepend whichever prefix your environment exposes.

## Setup — do this first if the project isn't wired up

Before any tool will return data, the host project needs two things: a build-time
plugin (or `jsxImportSource`) and an MCP daemon entry in the agent's config. Pick
the integration path that matches the project:

**Vite (React / Vue) — most common**
1. `pnpm add -D @harness-fe/vite @harness-fe/runtime`
2. Add to `vite.config.ts`:
   ```ts
   import { harnessFE } from '@harness-fe/vite';
   export default defineConfig({ plugins: [react(), harnessFE()] });
   ```
3. Register the daemon in `.mcp.json` (or the equivalent agent config):
   ```jsonc
   { "mcpServers": { "harness-fe": { "command": "npx", "args": ["@harness-fe/mcp-server", "--stdio"] } } }
   ```

**Next.js (App or Pages Router)** — supports SSR session continuity:
1. `pnpm add -D @harness-fe/next @harness-fe/react-jsx @harness-fe/runtime @harness-fe/node-runtime`
2. `tsconfig.json`: `"compilerOptions": { "jsxImportSource": "@harness-fe/react-jsx" }`
3. `next.config.mjs`: `export default withHarness(config, { projectId: '<app-name>' })`
4. `app/layout.tsx`: render `<HarnessScript />` inside `<body>`
5. Same MCP daemon config as above.

**Webpack / Rspack / other React toolchains**: use `@harness-fe/webpack` or
`@harness-fe/unplugin`; the rest is identical.

After setup, run `npx @harness-fe/mcp-server` once (or it auto-spawns via the
agent's stdio config) and start the dev server. `tab_list` should return at
least one tab — you're wired up.

## Documentation — fetch when you need depth

When this skill doesn't cover a specific question — edge-case framework
integration, deployment topologies, advanced API options — fetch the docs:

- **English**: https://harness-fe.com/
- **简体中文**: https://harness-fe.com/zh/

Quick lookup table:
- Framework-specific setup → `harness-fe.com/integrations/<name>`
  (`vite`, `nextjs`, `webpack`, `electron`, `vue2`)
- LAN / Docker / multi-daemon → `harness-fe.com/integrations/<topic>`
- Full API reference → `harness-fe.com/reference/<name>`
  (`overlay-plugins`, `mcp-tools`, `versioning-policy`)
- Troubleshooting flowcharts → `harness-fe.com/guide/troubleshooting`

Search is built in: `harness-fe.com/?q=<term>`.

## Mental model

```
Project              (one codebase, identified by projectId UUID)
  ├── parentProjectId? (micro-frontend tree — child apps point to their host)
  ├── Builds         (one source snapshot per dev-server start / prod build)
  │     buildId      stable across HMR, changes on restart
  └── Tabs           (one browser tab lifecycle)
        tabId
        └── Sessions (one page-load each — the narrative unit)
              sessionId
              └── events  console / network / errors / rrweb / commands
                          each row tagged with projectId + buildId
```

Key invariants you can rely on:

- **Same-origin iframes inherit the parent's `tabId` and `sessionId`** so an
  agent debugging a single user action sees parent + child events on one
  timeline.
- **`buildId` is independent of `sessionId`**, so you can ask "which code
  was running when the bug happened" without entangling it with "which
  pageload was open".
- The runtime auto-disables in production builds — anything you see here is
  dev-time only.
- **Multiple tabs/windows involved (Electron multi-window, opening tab B
  affects tab A, etc.)?** Don't manually tail console/network per-tab and
  cross-reference timestamps by hand — go straight to `visitor_timeline`
  (Flow 6 below) for one merged, causally-ordered view across every tab.

## Solo vs Team mode

How you reach the daemon changes what you can see and do — read this before
concluding "nothing is there" or "the tool is broken".

**Solo (default — loopback, zero config):** the agent spawns `@harness-fe/dev-cli`
over stdio; the daemon is fully trusted. You see **every** project / session /
task, `page_*` runs immediately (no approval), and the whole tool catalog is
available.

**Team (via the gateway):** the agent connects over HTTP-MCP to
`@harness-fe/gateway` with a scoped token; one daemon is shared by many apps, so
access is governed:

| Behaviour | Solo | Team (gateway) |
|---|---|---|
| Visible projects / sessions / tasks | all | only the **projects your token is bound to** — others return empty `[]` (isolation, not a bug) |
| `page_*` (click/type/navigate/…) | runs immediately | needs **Browser Consent** — the user approves in-page first; a denial returns `ok:false` / `CONSENT_DENIED` |
| Available tools (`tools/list`) | full catalog | **scope-filtered** — a `read`-only token never sees `page_*`; calling one is denied (`-32001 scope denied`) |
| Transport | stdio (direct) | HTTP-MCP via the gateway (routed + audited) |

**In team mode, adjust your behaviour:**

- An empty `project_list` / `session_list` / `tasks_pending` most likely means
  your token isn't bound to that project — **not** that the app is broken. Say
  you may lack access rather than asserting nothing exists.
- Before a `page_*` action, expect a consent prompt to the user. If it's denied,
  report it and don't blindly retry.
- If an expected tool is missing, your token's scope doesn't include it
  (`read` vs `read+control`). `write` is for the browser runtime only — never an agent.

In **solo** mode none of these gates apply — proceed directly. (Tool notes below
flag the team-mode differences with **[team]**.)

## Tool catalog

### Identity & topology

| Tool | Purpose |
|---|---|
| `tab_list` | What browser tabs are connected RIGHT NOW — `url`/`title` stay live (refreshed on reload + SPA route changes, not frozen at connect time), plus `isIframe` (this tab's JS context runs inside an iframe — disambiguates rows that share a tabId with their same-origin parent) and `referrer` (a cross-origin iframe's only legitimate signal of what embeds it) |
| `project_list` | All projects the daemon has ever seen |
| `project_get(projectId)` | One project's metadata (displayName, parentProjectId, tags) |
| `project_tree(rootId?)` | Forest assembled from parent links — **start here for micro-frontend setups** |
| `project_sessions(projectId)` | Sessions belonging to a project |
| `build_list(projectId)` / `build_get(buildId)` | Builds for a project (newest first) / one build's detail |
| `session_list(projectId)` / `session_summary(sessionId)` | Per-session counts |
| `dashboard_open` | Open the Harness web dashboard for visual inspection |
| `experimental_ping` | Liveness check — confirm the daemon is reachable |

### Page interaction (drive the browser)

> **[team]** Everything here is `control` scope: hidden from a `read`-only token's `tools/list`, and each call triggers a **Browser Consent** prompt the user must approve before it runs (a denial returns `ok:false` / `CONSENT_DENIED`). In solo mode they run directly.

| Tool | Signature | Use case |
|---|---|---|
| `page_navigate({ url })` | url | Soft / hard navigate |
| `page_click({ selector })` | selector | Click an element |
| `page_type({ selector, value })` | selector + value | Type into an input (per-key events) |
| `page_paste({ selector, content, html? })` | selector + content | Paste text/HTML in one shot (e.g. rich editors) |
| `page_select({ selector, value })` | selector + value | Choose a `<select>` option, fires change/input |
| `page_check({ selector, checked })` | selector + bool | Set a checkbox/radio state |
| `page_upload({ selector, files })` | selector + `[{name, content(base64), mimeType?}]` | Set files on `<input type=file>` |
| `page_dom_query({ selector })` | selector | Read DOM state (outerHTML, attrs, text) |
| `page_snapshot({ limit? })` | — | Compact index of visible `<a>`/`<button>` elements, each with a short-lived `ref` ("e1", "e2", …). Pass `{selector: {ref}}` to `page_click`/`page_type` to act on one without writing a selector — **refs invalidate on the next `page_snapshot` call**, so re-snapshot after any DOM change before reusing one |
| `page_evaluate({ expr })` | JS expr | Run arbitrary JS in page context (returns JSON-serializable result) |
| `page_wait_for({ predicate, timeoutMs?, idleMs? })` | `"network.idle"` \| `"dom.ready"` \| JS expr | **Block until a condition is truthy — use before acting on async/late-rendered UI.** `"network.idle"` tracks real in-flight fetch/XHR requests (zero for `idleMs`, default 500ms) — not a fixed sleep |
| `page_set_dialog_handler({ type, value })` | `alert`\|`confirm`\|`prompt` + return value | Pre-arm the answer to the next native dialog so it doesn't block your action |
| `page_screenshot` | — | Visual checkpoint. DOM-to-canvas capture, not a real compositor screenshot — check `response.notCaptured` for any `<canvas>`/`<video>`/cross-origin `<iframe>` in the shot that couldn't be rendered before treating a blank region as genuinely empty |
| `page_scroll` / `page_reload` / `page_set_html` / `page_set_style` | — | Auxiliary |

Every page action takes an optional `tabId` (from `tab_list`); omit it to target
the most-recent active tab. See **Selectors** below for the selector object shape.

### Telemetry tail

Every `*_tail` accepts `filter` (substring) + `match: contains | regex` + `n: number` for the last-N pagination, plus channel-specific narrows. Buffers are in-memory per page-load — for cross-navigate history use `session_tail({ sessionId, type: 'X' })`.

| Tool | What you get | Narrows |
|---|---|---|
| `console_tail` | console.log / .info / .warn / .error / .debug | `level` |
| `network_tail` | fetch + XHR req/res entries with `initiator.stack` (who issued the call), keyed by `id`. `text/event-stream` (SSE) responses also produce `phase: 'frame'` entries (`sseEvent`/`sseData`/`sseId`) as each frame streams in — no need to rely on the app's own debug logging to assert stream content | `urlContains`, `method`, `statusCode` |
| `ws_tail` | WebSocket frames: open / send / recv / close, with `initiator.stack` on send + binary payload size markers | `phase` |
| `storage_tail` | localStorage / sessionStorage / cookie mutations with `initiator.stack` and `crossTab` flag | `which` (local/session/cookie), `op` (set/remove/clear), `key` |
| `navigation_tail` | history.pushState / replaceState / popstate / hashchange / location.assign etc. | `kind` (push/replace/pop/hash/assign) |
| `globals_tail` | reads/writes to watched `window.X` keys (only fires for keys registered in `globals.watch` at install) | `op` (get/set/delete), `key` |
| `indexeddb_tail` | IDB ops: open / put / add / get / getAll / delete / clear / cursor | `op`, `store`, `db` |
| `errors_tail` | Uncaught errors + unhandled promise rejections | — |

### Session timeline (cross-navigate history)

`*_tail` buffers reset on each page-load. To see the whole narrative of a session
(client + server events merged), use these:

| Tool | Use case |
|---|---|
| `session_tail({ sessionId, type?, n?, since?, until? })` | Last-N events from the full session timeline. `type` filters one or many event types (`'err'`, `['ws','storage']`, …) |
| `session_search({ sessionId, query, type?, limit?, maxPayloadChars? })` | Substring search across a session's events. `limit` bounds match *count*; `maxPayloadChars` (default 2000) bounds each match's *size* — a single huge console.log object or network body gets truncated (`dTruncated: true`) rather than blowing past the tool-call output limit on its own |
| `session_summary({ sessionId })` | Per-type event counts for a session |

### Targeted fetch / single entry

| Tool | Use case |
|---|---|
| `network_get({ reqId })` | Pull a single request's full body when `network_tail` truncated it |
| `ws_get({ wsId })` | All frames (open/send/recv/close) for one WebSocket id |

### Wait for the page to do something

| Tool | Use case |
|---|---|
| `page_wait_for({ predicate, timeoutMs?, idleMs? })` | Block until `predicate` is truthy. Built-ins `"network.idle"` (real in-flight-request tracking, not a fixed sleep) / `"dom.ready"`, else any JS expression (e.g. `"document.querySelector('[data-testid=done]')"`) |
| `network_wait_for({ urlContains?, urlRegex?, method?, statusCode?, timeoutMs? })` | Block until a matching request happens. **Anchored on call-time** — a request that already fired does NOT satisfy it. |
| `network_wait_for_idle({ idleMs, timeoutMs })` | Block until in-flight fetch/XHR requests have been at zero for `idleMs` (default 500) — analogous to Playwright `networkidle` |

### Replay & forensics

| Tool | Use case |
|---|---|
| `session_recordings_list` | Available rrweb chunks for a session/tab |
| `session_recordings_around(ts)` | Chunks near a moment of interest |
| `session_recordings_slice` | Pull events for a time window |
| `session_replay_create` | Generate a viewable replay URL |

### Source intelligence (bridge browser ↔ code)

| Tool | Use case |
|---|---|
| `project_where_is(component)` | "Where is `<Counter>` defined?" → file:line:col |
| `project_source(file)` | Read source content |
| `project_module_graph` | Component dependency graph |

### Annotation tasks (human → agent handoff)

> **[team]** `tasks_pending` only returns tasks for the projects your token is bound to — an empty list may mean "not my project", not "no tasks".

| Tool | Use case |
|---|---|
| `tasks_pending` | What the user has clicked-and-annotated as a task. Returns id / question / url / selector / **attachments[]** (id + dims, no bytes) |
| `tasks_claim(id)` | Claim the task; returns full Task incl. element outerHTML, attachment pointers |
| `tasks_resolve(id, note?, resolution?)` | Mark complete. `note` is shown back to the user in "My reports". `resolution` (P7) closes the loop: `{ type, commit, prUrl, verificationSessionId }` — back-links the report to its fix + the re-test that proved it. `verifiedAt` defaults when a `verificationSessionId` is given |
| **`tasks_get_attachment({taskId, attachmentId})`** | Fetch the annotated screenshot as an **MCP image-content block** — `{ type: 'image', mimeType: 'image/png', data: base64 }`. Vision-capable LLMs can attach it directly. The annotations (arrow, text) are already flattened into the pixels |

### Visitor identity & user journey

`visitorId` is an anonymous, stable per-browser id (`localStorage.__hfe_visitor_id__`, per-origin). Optional `userId` is app-supplied (e.g. from auth) for cross-device aggregation. Both stitched across refreshes, tabs, and same-origin iframes.

| Tool | Use case |
|---|---|
| `visitor_list({ projectId?, limit? })` | All visitors the daemon has seen, newest activity first |
| `visitor_get(visitorId)` | One visitor's metadata: firstSeenAt / lastSeenAt / sessionCount / projectIds / **lastEnv** (UA, language, timezone, viewport, colorScheme) |
| `visitor_journey({ visitorId, limit? })` | Chronological **sessions** for this visitor — high-level "what did this person actually do?" |
| **`visitor_timeline({ visitorId, types?, tabIds?, sessionIds?, since?, until?, limit? })`** | Chronological **events** merged across ALL sessions / tabs of this visitor. Each event carries `tab` + `sessionId`. Use this for cross-tab causality: "a ws.recv in tab A → storage.remove in tab B 3s later" |

### Server-side capture (Next.js, role = `node-runtime`)

For Next.js apps wired with `@harness-fe/node-runtime` + `<HarnessScript>`, server-side events show up in the **same** session timeline as the client-side events for that same refresh (continuity via React `cache()`).

Event types you'll see on server-side rows (`t` field):
- `server-log` — Node `console.*` (opt-in via `HARNESS_FE_NODE_CONSOLE=1`)
- `server-err` — `process.on('uncaughtException' | 'unhandledRejection')` + Server Component render errors
- `server-action` — durations / errors from Route Handlers + Server Actions wrapped with `withHarnessTracing(handler)`

When debugging a Next.js bug, the rule of thumb: **`session_tail({ sessionId, type: ['server-log','server-err','server-action'] })` first**. Server errors usually precede client hydration failures. If the project has no `node-runtime` connected, server logs are silently missing — tell the user to wrap their next config with `withHarness(...)`.

## Selectors — how to target an element

Every `page_*` action that touches an element takes a **selector object** (not a
bare string). Provide one or more fields; pick the most robust available:

| Field | Targets by | When to use |
|---|---|---|
| `ref` | a ref from a prior `page_snapshot` call (e.g. `"e3"`) | fastest path for a visible `<a>`/`<button>` — no selector to write. Invalidates on the next `page_snapshot` |
| `component` | React component name (`data-morphix-comp`) | refactor-proof; first choice |
| `file` + `line` | source location (`data-morphix-loc`) | pin one specific instance in code |
| `text` | visible text content | buttons / links with stable copy |
| `role` / `ariaLabel` | ARIA role / aria-label | accessible, semantic targeting |
| `css` | raw CSS selector | escape hatch — incl. `data-testid` (below) |
| `nth` | 0-based index among matches | **disambiguate when a selector matches several elements** |

The Vite/Webpack plugin tags **every JSX element** at build time, which is what
`component` / `file` / `line` read:

```html
<button data-morphix-comp="SubmitButton"
        data-morphix-loc="src/components/Form.tsx:42:8">
    Submit
</button>
```

Example calls:

```ts
page_click({ selector: { component: 'SubmitButton' } })
page_click({ selector: { text: 'Pay now' } })
page_dom_query({ selector: { file: 'src/components/Form.tsx', line: 42 } })
page_click({ selector: { component: 'TodoItem', nth: 2 } })   // 3rd TodoItem

// page_snapshot → ref, when you just want "click the thing labeled X" fast:
const { elements } = await page_snapshot({})
const saveBtn = elements.find(e => e.text.includes('Save'))
page_click({ selector: { ref: saveBtn.ref } })
```

**Prefer `component` / `text` / `role` over `css`** — they survive refactors that
change class names or DOM structure. Use `nth` to break ties instead of writing a
brittle deep CSS path.

### Add your own stable hooks while coding

When you're **already editing a component** for a feature or a fix, proactively
add a `data-testid` to the elements you (or the user) will want to drive or
assert on later — it's an explicit, refactor-proof handle that complements the
auto-injected `component`/`file`+`line`:

```html
<button data-testid="checkout-submit">Pay now</button>
```

Then target it via the `css` field:

```ts
page_click({ selector: { css: '[data-testid="checkout-submit"]' } })
page_dom_query({ selector: { css: '[data-testid="order-total"]' } })
```

Guidelines:

- Add `data-testid` to **interaction targets** (buttons, inputs, links) and
  **assertion anchors** (status text, totals, list rows) — the things a test
  actually touches, not every node.
- Use a stable, intent-describing name (`checkout-submit`, not `btn-3`).
- Match the project's existing convention if one exists (`data-testid` vs
  `data-test` vs `data-cy`) — grep before inventing one.

A testid you add today makes the next "drive the browser and verify" loop
deterministic instead of fragile.

## Decision flows

### Flow 1: User reports a visual bug

1. `tab_list` → confirm a tab is connected. If not, ask user to open the dev page.
2. `page_screenshot` → visual baseline.
3. `errors_tail({ n: 20 })` + `console_tail({ n: 20 })` → known errors first.
4. If errors implicate a component: `project_where_is({ component: 'X' })` → `project_source({ file })`.
5. Form a hypothesis. Verify with `page_dom_query` or `page_evaluate`.
6. Suggest a fix in source. Use Edit. Then `page_reload` and re-check.

### Flow 2: User reports "the form submits to wrong endpoint"

1. `network_tail({ urlContains: '/api/' })` → see what URL was hit.
2. Compare with `project_source` of the submitting component.
3. Confirm with `page_click` + `network_tail` again.

### Flow 3: Micro-frontend bug ("the iframe child app errored")

1. `project_tree` → confirm parent/child relationship.
2. `tab_list` → tabId. Same-origin parent + child share `tabId` AND `sessionId`
   (runtime inheritance), so you'll see two rows with the same `tabId` —
   `isIframe: true` tells you which row is the embedded child. A **cross-origin**
   child can't inherit anything (browser same-origin policy) and gets its own
   `tabId`; its `referrer` is the only signal linking it back to the parent's `url`.
3. `console_tail` / `errors_tail` will surface events from BOTH apps in the
   same timeline — distinguish by the `projectId` tag on each event.

### Flow 4: "What happened just before the crash"

1. `errors_tail` → find the error's timestamp.
2. `session_recordings_around({ ts })` → pull the rrweb window.
3. `session_replay_create` → URL the user can open in browser.

### Flow 5: "Who deleted my login token?" / "Who issued this fetch?"

Every captured event carries an `initiator.stack` — a trimmed JS stack at the call site. Use it to attribute the action to a source file.

1. `storage_tail({ op: 'remove', key: 'Tanka_tokenInfo' })` → see when the token was removed and the calling stack.
2. The stack's first user-code frame names the file + line. `project_source({ file })` to read the offender.
3. Same approach works for `network_tail` (who issued the request) and `ws_tail` (who opened / sent).

### Flow 6: Cross-tab bug ("opening tab B kicks me out of tab A")

1. `tab_list` → confirm both tabs are connected, find the `tabId`s.
2. `visitor_get` of either tab's session → grab the shared `visitorId`.
3. **`visitor_timeline({ visitorId, types: ['ws', 'storage', 'navigation'] })`** → merged timeline across BOTH tabs, each event tagged with its `tab`.
4. Sequence: e.g. `ws.recv {kind:'kick'} in tab-A → storage.remove 'token' in tab-B → navigation.assign '/login' in tab-B`. One call, full causality.

### Flow 7: Track SPA route changes

1. `navigation_tail({ kind: 'push' })` → every history.pushState the page made, with the issuing stack.
2. Distinguish SDK-driven (react-router) vs explicit (`location.assign`) navigations by `kind`.
3. For cross-navigate history use `session_tail({ sessionId, type: 'navigation' })`.

### Flow 8: Proactively drive the browser to test a change

You don't have to wait to be asked "go test this." Once you've written or
changed UI code and a dev tab is connected, **driving the app yourself is
usually the fastest way to know whether the change actually works** — faster
and more honest than reasoning about it from the source alone. Reach for this
after implementing a feature, fixing a UI bug, or to confirm a flow end-to-end.

1. `tab_list` → is a tab connected? If not, ask the user to open the dev page
   (or start `pnpm dev`). **[team]** expect a Browser Consent prompt before the
   first `page_*` action — tell the user it's coming.
2. `page_navigate({ url })` to the route, then `page_wait_for({ predicate: 'dom.ready' })`
   (or a JS predicate for the element you need) so you don't act before it renders.
3. Drive the actual user flow with `page_click` / `page_type` / `page_select` /
   `page_check`, targeting `data-testid` (via `css`) or `component` selectors.
   If the flow pops a native `confirm`/`alert`, pre-arm `page_set_dialog_handler`.
4. Assert the outcome — combine `page_dom_query` / `page_evaluate` for state,
   `errors_tail` + `console_tail` for regressions, and `network_wait_for` /
   `network_tail` for the right request/response. `page_screenshot` for a visual
   checkpoint.
5. Report what you observed (what you clicked, what you saw), not just "it
   should work." If it failed, the error/network evidence is already in hand.

**Do it without being asked** after a UI change or bug fix (reproduce → fix →
re-drive to prove clean), or before claiming something is done. **Ask first** for
flows with side effects (payments, sending messages, destructive actions) — and
in team mode respect a `CONSENT_DENIED` instead of retrying.

### Flow 9: User filed a task via the in-page overlay

The runtime ships a small "H" overlay button. When a user picks an element + draws an arrow + types a description, the task arrives via `tasks_pending`. To act on it:

1. `tasks_pending({ status: 'pending' })` → list the queue
2. `tasks_claim(taskId)` → get the full Task (selector gives file:line, element.outerHTML gives DOM context)
3. `tasks_get_attachment({ taskId, attachmentId })` → grab the annotated screenshot. The arrows + text annotations are already drawn on the image; pass it directly into your vision call.
4. `session_tail({ sessionId: task.sessionId })` → see what the user was doing before + after the report (console errors, network failures, server-side `server-err` rows)
5. Form a fix. Use `project_where_is` / `project_source` to navigate to the source. Apply the edit + commit (host `git`/`gh` tooling — writeback lives outside harness).
6. **Verify the fix — close the loop.** Re-drive the reported flow against the patched build: `session_replay_create({ sessionId: task.sessionId })` to recall the exact steps the user took, reproduce them with `page_*`, then prove it's clean — `errors_tail` / `session_tail({ sessionId, type: 'err' })` show no new errors and `page_*` confirms the expected behavior. Keep the **new sessionId** of this re-test.
7. `tasks_resolve(taskId, "Fixed in PR #234", { type: 'code-fix', commit: '<sha>', prUrl: '<url>', verificationSessionId: '<re-test session>' })` → the structured `resolution` back-links report → fix → proof; the user still sees `note` in their "My reports".

If you can't reproduce or decide not to fix, still resolve with the reason so the loop is closed: `resolution: { type: 'cannot-reproduce' }` (or `'wontfix'` / `'duplicate'`).

## Troubleshooting

### When a `page_*` action fails

| Symptom | Likely cause | Do this |
|---|---|---|
| element not found | selector too specific, or element not rendered yet | `page_dom_query` to confirm it exists; if async, `page_wait_for` first. Not sure what to target at all? `page_snapshot` lists every visible `<a>`/`<button>` with a ref you can click directly |
| matched the wrong one | ambiguous selector | add `nth`, or switch to `component` / `text` / `file`+`line` |
| action ran, nothing happened | the handler errored | `errors_tail` + `console_tail`; check the expected `network_tail` entry fired |
| `network_wait_for` times out | the request fired BEFORE the wait — it only sees requests after the call | call `network_wait_for` first, THEN trigger the action |
| a native dialog blocks the action | unanswered `alert` / `confirm` / `prompt` | `page_set_dialog_handler` BEFORE the action that triggers it |
| `page_evaluate` returns nothing useful | result isn't JSON-serializable (DOM node, function, circular) | return a primitive/plain object (`el.textContent`, `{...}`) instead |
| **[team]** `CONSENT_DENIED` / `-32001 scope denied` | user declined, or token lacks `control` scope | report it; don't retry blindly — ask the user to approve or widen scope |

### When you "see nothing"

| Symptom | Likely cause | Do this |
|---|---|---|
| `tab_list` empty | no dev tab open, or dev server down | ask the user to open the page / start `pnpm dev` |
| source tools fail (`project_where_is`, `project_source`) | build plugin offline | ask the user to start `pnpm dev` (the plugin runs in the bundler) |
| `project_list` / `session_list` / `tasks_pending` empty **[team]** | your token isn't bound to that project | say you may lack access — don't assert nothing exists |
| daemon unreachable | MCP server not configured / not running | `experimental_ping`; if it fails, re-check the MCP config (see Setup) |
| server-side (Next.js) events missing | no `@harness-fe/node-runtime` connected | tell the user to wrap next config with `withHarness(...)` |

## Production deployment options

**Hiding the overlay (data capture unaffected)**

The in-page floating "H" button is off by default in production — set `overlay: false`
in the plugin config. All rrweb recording and event reporting continue unchanged.

```ts
harnessFE({ projectId: 'xxx', overlay: false })   // Vite
withHarness(config, { overlay: false })            // Next.js
```

A hidden overlay can still be toggled manually by pressing `Cmd/Ctrl + Shift + H`
(only works when `overlay: true` — the DOM must be present).

**Control commands (`page_click`, `page_type`, …)**

The `consent` option controls whether MCP agents can drive the page:

| Value | Behaviour |
|---|---|
| `'deny'` **(default)** | All control commands rejected immediately — no prompt, no UI |
| `'session'` | First control command prompts the user once per page-load |
| `'always'` | Prompt before every control command |
| `'off'` | Run freely, no prompt (loopback dev only) |

Set via plugin config (takes priority over gateway):
```ts
harnessFE({ projectId: 'xxx', consent: 'deny' })
```

Or per gateway (daemon side):
```
harness serve --governed   # → consent: 'session' for all peers
```

**`page_evaluate` (arbitrary JS)** always prompts, regardless of consent mode.

**Storage cap**

Default: **1 GiB** hard cap on the data directory. When exceeded, oldest sessions
are evicted automatically during the hourly purge. Override with:

```bash
# Docker
docker run -e HARNESS_MAX_STORAGE_BYTES=2147483648 morphixai/harness-fe

# Local / ENV
HARNESS_MAX_STORAGE_BYTES=2147483648 harness serve

# Disable cap entirely
HARNESS_MAX_STORAGE_BYTES=0 harness serve
```

**Visitor identity**

- `visitorId` — anonymous, auto-generated, stored in `localStorage`. Not configurable by the plugin.
- `userId` — app-supplied identity (supabase uid, auth0 sub, …). Pass via plugin config or `<HarnessScript userId={user.id} />`.

## Constraints & safety

| | |
|---|---|
| `page_evaluate(expr)` runs arbitrary JS in the user's page. **Don't** evaluate untrusted code (e.g. from a `console_tail` result that contains user input). |
| `project_source` is sandboxed to the project root — it refuses paths above `projectRoot`. Never try to use it for system file reads. |
| The store at `~/.harness/` auto-purges (1h interval, 1 GiB cap) but can still hold sensitive data. If the user is on a multi-user machine, treat the daemon's data as confidential. |
| rrweb does NOT mask form fields beyond `<input type=password>`. Don't paste recording slices into untrusted contexts — they may contain tokens, addresses, etc. |
| When the build plugin is offline (`tab_list` returns empty for a project), source-intelligence tools fail. Ask the user to start `pnpm dev` first. |
| `consent: 'deny'` is the default — if `page_*` tools return `CONSENT_DENIED`, the deployment intentionally blocks control. Do not instruct the user to "just disable consent" without understanding the security intent. |

## Reading initiator stacks

Every event with an `initiator.stack` field (network/storage/ws/navigation/globals/indexeddb writes) gives you the JS call stack at the moment the API was used. The top frames may include framework internals (the runtime's own wrappers); **the meaningful frame is the first one pointing to user-source-code** (look for paths under `src/` or your app's domain).

When reporting "who did X" to the user, quote that frame — not the framework frames.

## Common gotchas

- **`sessionId` ≠ build / dev-run id** — `sessionId` is one page-load. The "dev-server run" / source-code snapshot concept is `buildId`. Filter by `sessionId` to see one refresh's worth of activity (server-side + client-side merged). Filter by `buildId` to see "what code was running across all sessions during this dev run".
- **HMR doesn't change `buildId`** — only a fresh `pnpm dev` does. So during one debugging session you'll usually see one buildId, multiple sessionIds.
- **`network_wait_for` is call-time-anchored** — it ignores requests that already fired. Set up the wait BEFORE the action that triggers the request.
- **Cross-origin iframe** — identity inheritance silently degrades. Child gets its own `tabId`/`sessionId`. Tell the user this is expected; suggest same-origin via vite proxy if they need correlation.

## When to ask for clarification

- "There's no MCP daemon running" → user needs to start it (`pnpm --filter @harness-fe/mcp-server start`) or add it to their Claude Code mcpServers config.
- "Multiple tabs are connected, which one?" → call `tab_list`, show the user the `url` field, ask which.
- "Multiple projects share this tabId" — common in micro-frontends. Use `project_tree` to show the hierarchy; ask which sub-app the user's bug is in.

## Wire-up details

See the **Setup** section at the top of this skill for the canonical install
steps. For framework-specific edge cases (TanStack Start, Remix, Astro,
Capacitor, monorepo with multiple bundlers), fetch
`https://harness-fe.com/integrations/` and pick the matching guide.
