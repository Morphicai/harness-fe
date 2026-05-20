---
name: harnessa-fe
description: |
    Debug, inspect, and drive any frontend app that has the Harnessa-FE
    Vite/Webpack plugin installed. Use this when the user reports a UI
    bug, asks "why is this happening on the page", wants to inspect
    runtime state, or needs to correlate browser behavior with source
    files (especially in micro-frontend setups).
allowed-tools:
    - mcp__harnessa-fe__*
    - Read
    - Grep
    - Bash
---

# Harnessa-FE Agent Skill

You have direct access to a running frontend app via the **harnessa-fe** MCP
daemon. The daemon bridges your tools to (1) the build plugin (source
intelligence) and (2) the browser tab (live DOM, console, network, rrweb
recording).

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

## Tool catalog

### Identity & topology

| Tool | Purpose |
|---|---|
| `tab_list` | What browser tabs are connected RIGHT NOW |
| `project.list` | All projects the daemon has ever seen |
| `project.get(projectId)` | One project's metadata (displayName, parentProjectId, tags) |
| `project.tree(rootId?)` | Forest assembled from parent links — **start here for micro-frontend setups** |
| `build.list(projectId)` | Builds for a project, newest first |
| `session.list(projectId)` / `session.summary(id)` | Per-session counts |

### Page interaction (drive the browser)

| Tool | Use case |
|---|---|
| `page_navigate(url)` | Soft / hard navigate |
| `page_click(selector)` | Click an element. Selectors support `comp` (component name) + `loc` (file:line) — see "source-aware selectors" below |
| `page_type(selector, value)` | Fill an input |
| `page_dom_query(selector)` | Read DOM state |
| `page_evaluate(expr)` | Run arbitrary JS in page context (returns JSON-serializable result) |
| `page_screenshot` | Visual checkpoint |
| `page_scroll` / `page_reload` | Auxiliary |

### Telemetry tail

| Tool | What you get |
|---|---|
| `console_tail` | Recent console.log / .error from the page |
| `network_tail` | Recent fetch / XHR requests + responses |
| `errors_tail` | Uncaught errors + unhandled promise rejections |

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

| Tool | Use case |
|---|---|
| `tasks_pending` | What the user has clicked-and-annotated as a task. Returns id / question / url / selector / **attachments[]** (id + dims, no bytes) |
| `tasks_claim(id)` | Claim the task; returns full Task incl. element outerHTML, attachment pointers |
| `tasks_resolve(id, note?)` | Mark complete; optional note shown back to the user in their "My reports" view |
| **`tasks_get_attachment({taskId, attachmentId})`** | Fetch the annotated screenshot as an **MCP image-content block** — `{ type: 'image', mimeType: 'image/png', data: base64 }`. Vision-capable LLMs (Claude / GPT-4V) can attach it directly. The annotations (arrow, text) are already flattened into the pixels |

### Visitor identity & user journey

`visitorId` is an anonymous, stable per-browser id (`localStorage.__hfe_visitor_id__`, per-origin). Optional `userId` is app-supplied (e.g. from auth) for cross-device aggregation. Both stitched across refreshes, tabs, and same-origin iframes.

| Tool | Use case |
|---|---|
| `visitor.list({ projectId?, limit? })` | All visitors the daemon has seen, newest activity first |
| `visitor.get(visitorId)` | One visitor's metadata: firstSeenAt / lastSeenAt / sessionCount / projectIds / **lastEnv** (UA, language, timezone, viewport, colorScheme) |
| `visitor.journey({ visitorId, limit? })` | Chronological sessions for this visitor — answer "what did this person actually do?" |

### Server-side capture (Next.js, role = `node-runtime`)

For Next.js apps wired with `@harnessa-fe/node-runtime` + `<HarnessaScript>`, server-side events show up in the **same** `sessions/{sessionId}/timeline.jsonl` as the client-side events for that same refresh (continuity via React `cache()`).

Event types you'll see on server-side rows (`t` field):
- `server-log` — Node `console.*` (opt-in via `HARNESSA_FE_NODE_CONSOLE=1`)
- `server-err` — `process.on('uncaughtException' | 'unhandledRejection')` + Server Component render errors
- `server-action` — durations / errors from Route Handlers + Server Actions wrapped with `withHarnessaTracing(handler)`

When debugging a Next.js bug, the rule of thumb: **filter `session.timeline({ sessionId })` for server-* events first**. Server errors usually precede client hydration failures. If the project has no `node-runtime` connected, server logs are silently missing — tell the user to wrap their next config with `withHarnessa(...)`.

## Source-aware selectors

The Vite/Webpack plugin tags **every JSX element** with two data attributes
at build time:

```html
<button data-morphix-comp="SubmitButton"
        data-morphix-loc="src/components/Form.tsx:42:8">
    Submit
</button>
```

So you can target by source location:

```ts
page_click({ selector: { component: 'SubmitButton' } })
page_dom_query({ selector: { loc: 'src/components/Form.tsx:42' } })
```

**Prefer source-aware selectors over CSS** — they survive refactors that
change class names or DOM structure.

## Decision flows

### Flow 1: User reports a visual bug

1. `tab_list` → confirm a tab is connected. If not, ask user to open the dev page.
2. `page_screenshot` → visual baseline.
3. `errors_tail({ n: 20 })` + `console_tail({ n: 20 })` → known errors first.
4. If errors implicate a component: `project_where_is({ component: 'X' })` → `project_source({ file })`.
5. Form a hypothesis. Verify with `page_dom_query` or `page_evaluate`.
6. Suggest a fix in source. Use Edit. Then `page_reload` and re-check.

### Flow 2: User reports "the form submits to wrong endpoint"

1. `network_tail({ filter: { url: '/api/' } })` → see what URL was hit.
2. Compare with `project_source` of the submitting component.
3. Confirm with `page_click` + `network_tail` again.

### Flow 3: Micro-frontend bug ("the iframe child app errored")

1. `project.tree` → confirm parent/child relationship.
2. `tab_list` → tabId.
3. Note: parent + child share `tabId` AND `sessionId` (runtime inheritance).
4. `console_tail` / `errors_tail` will surface events from BOTH apps in the
   same timeline — distinguish by the `projectId` tag on each event.

### Flow 4: "What happened just before the crash"

1. `errors_tail` → find the error's timestamp.
2. `session_recordings_around({ ts })` → pull the rrweb window.
3. `session_replay_create` → URL the user can open in browser.

## Constraints & safety

| | |
|---|---|
| `page_evaluate(expr)` runs arbitrary JS in the user's page. **Don't** evaluate untrusted code (e.g. from a `console_tail` result that contains user input). |
| `project_source` is sandboxed to the project root — it refuses paths above `projectRoot`. Never try to use it for system file reads. |
| The store at `~/.harnessa/` auto-purges (1h interval) but can still hold sensitive data. If the user is on a multi-user machine, treat the daemon's data as confidential. |
| rrweb does NOT mask form fields beyond `<input type=password>`. Don't paste recording slices into untrusted contexts — they may contain tokens, addresses, etc. |
| When the build plugin is offline (`tab_list` returns empty for a project), source-intelligence tools fail. Ask the user to start `pnpm dev` first. |

## Common gotchas

- **`sessionId` ≠ build / dev-run id** — `sessionId` is one page-load. The "dev-server run" / source-code snapshot concept is `buildId`. Filter by `sessionId` to see one refresh's worth of activity (server-side + client-side merged). Filter by `buildId` to see "what code was running across all sessions during this dev run".
- **HMR doesn't change `buildId`** — only a fresh `pnpm dev` does. So during one debugging session you'll usually see one buildId, multiple sessionIds.
- **Cross-origin iframe** — identity inheritance silently degrades. Child gets its own `tabId`/`sessionId`. Tell the user this is expected; suggest same-origin via vite proxy if they need correlation.

## When to ask for clarification

- "There's no MCP daemon running" → user needs to start it (`pnpm --filter @harnessa-fe/mcp-server start`) or add it to their Claude Code mcpServers config.
- "Multiple tabs are connected, which one?" → call `tab_list`, show the user the `url` field, ask which.
- "Multiple projects share this tabId" — common in micro-frontends. Use `project.tree` to show the hierarchy; ask which sub-app the user's bug is in.

## Decision flow 5: User filed a task via the in-page overlay

The runtime ships a small "H" overlay button. When a user picks an element + draws an arrow + types a description, the task arrives via `tasks_pending`. To act on it:

1. `tasks_pending({ status: 'pending' })` → list the queue
2. `tasks_claim(taskId)` → get the full Task (selector.loc gives file:line, element.outerHTML gives DOM context)
3. `tasks_get_attachment({ taskId, attachmentId })` → grab the annotated screenshot. The arrows + text annotations are already drawn on the image; pass it directly into your vision call.
4. `session.timeline({ sessionId: task.sessionId })` → see what the user was doing before + after the report (console errors, network failures, server-side `server-err` rows)
5. Form a fix. Use `project_where_is` / `project_source` to navigate to the source. Apply.
6. `tasks_resolve(taskId, "Fixed in PR #234")` → user sees the note in their "My reports" view next time they open the overlay.

## Quick reference: install & wire-up

The host project picks one of three integration paths:

**Vite / Webpack (plugin-based, traditional)**:
1. `pnpm add -D @harnessa-fe/vite @harnessa-fe/runtime` (or `@harnessa-fe/webpack`)
2. `plugins: [react(), harnessaFE()]` in their bundler config
3. Daemon: `npx @harnessa-fe/mcp-server` in `.mcp.json` / Claude Code settings

**Next.js (recommended — plugin-less, supports SSR session continuity)**:
1. `pnpm add -D @harnessa-fe/next @harnessa-fe/react-jsx @harnessa-fe/runtime @harnessa-fe/node-runtime`
2. `tsconfig.json`: `"jsxImportSource": "@harnessa-fe/react-jsx"` (gives `data-morphix-loc` on every JSX element)
3. `next.config.mjs`: `export default withHarnessa(config, { projectId })`
4. `app/layout.tsx`: `<HarnessaScript projectId="…" userId={user?.id} />`
5. Same MCP daemon config as above.

**Any other React toolchain (Remix / Astro / Vite + custom)**:
- Just `tsconfig.json`'s `jsxImportSource` + `@harnessa-fe/runtime` boot script. No `node-runtime` (which is Next-specific). Browser-side capture works fully.

Once the dev server is running, `tab_list` returns at least one tab and you can use the rest of the catalog.
