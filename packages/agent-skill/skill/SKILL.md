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
| `tasks_pending` | What the user has clicked-and-annotated as a task |
| `tasks_claim(id)` / `tasks_resolve(id)` | Claim & complete |

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

- **`project.sessions` is deprecated** — prefer `project.list` + `build.list`. Both list projects, but `project.sessions` mixes dimensions.
- **`sessionId` ≠ build/dev-run id** — `sessionId` is one page-load. The "dev-server run" concept is `buildId`. Names changed in v0.2; old MCP recordings may use `loadId` (alias for `sessionId`).
- **HMR doesn't change `buildId`** — only a fresh `pnpm dev` does. So during one debugging session you'll usually see one buildId, multiple sessionIds.
- **Cross-origin iframe** — identity inheritance silently degrades. Child gets its own `tabId`/`sessionId`. Tell the user this is expected; suggest same-origin via vite proxy if they need correlation.

## When to ask for clarification

- "There's no MCP daemon running" → user needs to start it (`pnpm --filter @harnessa-fe/mcp-server start`) or add it to their Claude Code mcpServers config.
- "Multiple tabs are connected, which one?" → call `tab_list`, show the user the `url` field, ask which.
- "Multiple projects share this tabId" — common in micro-frontends. Use `project.tree` to show the hierarchy; ask which sub-app the user's bug is in.

## Quick reference: install & wire-up

The host project needs three things:
1. `npm i -D @harnessa-fe/vite @harnessa-fe/runtime` (or `.webpack`)
2. `plugins: [react(), harnessaFE()]` in their bundler config
3. The MCP daemon configured: `npx @harnessa-fe/mcp-server` in `.mcp.json` / Claude Code settings

Once the dev server is running, `tab_list` returns at least one tab and you can use the rest of the catalog.
