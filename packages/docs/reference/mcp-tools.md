# MCP Tools

The MCP daemon exposes 45+ tools organized into functional groups, usable from any MCP-aware agent (Claude Code, Cursor, Kiro, Windsurf, …).

::: info Scope & consent (4.0)
In **solo** (loopback) mode every tool is available with no gating. In governed
[team mode](/guide/team-mode) the gateway is stricter: it **filters `tools/list`
by your token's scope** (a `read`-only token never even sees `page.*`), denies
out-of-scope calls (`-32001 scope denied`), and runs `control` commands
(`page.*`) behind a [consent gate](/guide/consent). `page.evaluate` always prompts.
:::

## Install the agent playbook

The fastest way to learn the full toolset is to install `@harness-fe/skill`:

```bash
npx @harness-fe/skill install
```

This drops a `SKILL.md` into your agent project with the complete tool catalog, mental model, decision flow, and usage examples.

## Tool groups

### Identity & topology

| Tool | Description |
|------|-------------|
| `tab.list` | List all known tabs with their project, session, and URL |
| `project.list` | List all projects seen by the daemon |
| `project.tree` | Project hierarchy (parent → child for micro-frontends) |
| `dashboard.open` | Return (and optionally open) the dashboard URL |

### Page interaction

| Tool | Description |
|------|-------------|
| `page.navigate` | Navigate to a URL in the active tab |
| `page.click` | Click an element by selector |
| `page.type` | Type text into an element |
| `page.scroll` | Scroll the page or an element |
| `page.screenshot` | Capture a screenshot (returns base64 PNG) |
| `page.dom_query` | Query DOM elements and return their properties |
| `page.evaluate` | Run arbitrary JS in the page context |
| `page.wait_for` | Wait for an element or condition |
| `page.set_html` | Replace the innerHTML of an element |
| `page.set_style` | Inject or override CSS |
| `page.reload` | Reload the current page |

### Telemetry

| Tool | Description |
|------|-------------|
| `console.tail` | Last N console log entries (log/warn/error) |
| `network.tail` | Last N network entries. `phase: req\|res\|frame` (frames are SSE frames tee'd off a `text/event-stream` body, kept in their own deep ring). Narrows apply to the whole buffer, then the newest N matches return; reply carries `matched` / `truncated` / `dropped` |
| `network.get` | Full details of a single request by ID — including every retained SSE frame in order (`maxFrames` caps them) |
| `ws.tail` | Last N WebSocket frames |
| `ws.get` | Full details of a single WS frame |
| `errors.tail` | Last N unhandled errors |
| `session.tail` | Raw timeline slice — all event types |
| `session.summary` | Session metadata + event counts |
| `session.list` | List sessions for a project |

### Wait & idle

| Tool | Description |
|------|-------------|
| `network.wait_for` | Wait for a network request matching a pattern |
| `network.wait_for_idle` | Wait until no in-flight requests remain |

### Replay & forensics

| Tool | Description |
|------|-------------|
| `session.recordings.list` | List rrweb recording chunks for a session |
| `session.recordings.slice` | Return chunks overlapping a time window |
| `session.replay.create` | Bundle chunks into a shareable rrweb player URL |

### Source intelligence

| Tool | Description |
|------|-------------|
| `project.where_is` | Locate a component or source file — returns file path + line |
| `project.source` | Read source files from the project tree |
| `project.module_graph` | AST-derived component map for the project |

### Visitor journey

| Tool | Description |
|------|-------------|
| `visitor.list` | List known visitors |
| `visitor.get` | Visitor metadata |
| `visitor.journey` | Ordered session chain for a visitor |
| `visitor.timeline` | Merged cross-tab event timeline for a visitor |

### Project memory

| Tool | Description |
|------|-------------|
| `project.memory.set` | Write a persistent key/value memory entry for a project |
| `project.memory.get` | Read a memory entry |
| `project.memory.list` | List all memory entries for a project |
| `project.memory.delete` | Delete a memory entry |

### Build & storage

| Tool | Description |
|------|-------------|
| `build.list` | List builds for a project |
| `build.get` | Build metadata |

## Selector syntax

Most page interaction tools accept a `selector` object:

```jsonc
// By CSS
{ "css": "button.submit" }

// By component name (source-aware — requires build plugin)
{ "comp": "SubmitButton" }

// By source location
{ "loc": "src/components/SubmitButton.tsx:42" }

// By visible text
{ "text": "Submit order" }

// Combine for precision
{ "comp": "CartBadge", "css": "button" }
```

The `comp:` and `loc:` forms only work when the build plugin has instrumented the source.

## Further reading

- [Install the playbook](https://www.npmjs.com/package/@harness-fe/skill) — `npx @harness-fe/skill install`
- [Overlay Plugins](/reference/overlay-plugins) — extend the in-page H button
