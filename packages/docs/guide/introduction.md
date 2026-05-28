# Introduction

**Harness-FE** gives AI agents real-time observability into a running frontend application — console logs, network requests, WebSocket frames, DOM recordings, and source-aware element selectors — via the [Model Context Protocol](https://modelcontextprotocol.io) (MCP).

::: tip Skill-first onboarding (recommended)
The fastest way to add Harness-FE to a project is to let your agent do it.
Install the agent skill once:

```bash
npx @harness-fe/skill install
```

Then ask your agent: *"Set up Harness-FE in this project."* The skill contains
the install steps, the MCP daemon config, the full tool catalog, and pointers
back to this site for deeper questions — your agent has everything it needs.

See [Quickstart](/guide/quickstart) for the manual path.
:::

## The problem

AI coding agents are great at reading and writing source code. They're blind to **runtime behavior**: what the console actually printed, which API call failed, what the user saw. The result is a feedback loop that requires a human to relay information the agent can't observe directly.

## How it works

```
Your app  ──build plugin──▶  Runtime client  ──WebSocket──▶  MCP daemon  ──stdio──▶  AI agent
(browser)                    (in-page SDK)                   (:47729)
```

1. **Build plugin** (`@harness-fe/vite` / `@harness-fe/webpack`) instruments your source at build time — tagging every JSX element with its file path and line number.
2. **Runtime client** captures browser events (console, network, errors, DOM recordings) and executes agent commands (click, type, navigate, screenshot).
3. **MCP daemon** is a long-lived process your agent connects to over stdio. It brokers between the agent and every connected browser tab.

The agent sees `session_tail`, `page_click`, `project_where_is`, and 40+ more tools — all scoped to the currently-running session.

## Key concepts

| Concept | Description |
|---------|-------------|
| **Project** | A stable identity for a codebase, derived from a `.harness-id` file or `package.json`. |
| **Build** | One run of your dev server. Changes on restart / rebuild; stable across HMR. |
| **Tab** | A browser tab lifetime. Persists across page refreshes via `sessionStorage`. |
| **Session** | One page load. The narrative unit for "what happened in one bug". |
| **Event** | A console entry, network request, error, DOM snapshot, or agent command. |

## What makes it different

- **Source awareness** — elements carry `data-morphix-loc` / `data-morphix-comp`, so the agent can call `project_where_is` to jump straight to the JSX source.
- **No cloud** — the daemon runs locally. Your console logs and DOM recordings never leave your machine.
- **Framework-agnostic** — one unplugin core supports Vite, Webpack, Rspack, Rollup, and esbuild.
- **Agent playbook** — `@harness-fe/skill` is a single npm package that drops a `SKILL.md` into your agent project. The file teaches the agent how Harness-FE is set up, how every tool is used, and when to fetch this site for deeper context. **Install it first** — the rest of onboarding is conversational.

## Next steps

- [Quickstart](/guide/quickstart) — up and running in 3 minutes
- [Architecture](/guide/architecture) — detailed layer breakdown
- [MCP Tools reference](/reference/mcp-tools) — full tool catalog
