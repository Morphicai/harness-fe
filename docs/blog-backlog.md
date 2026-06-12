# Blog backlog (evangelism)

Queue for the **weekly** harness-fe blog. Run the `/weekly-blog` slash command to:
pick the top `status: todo` topic, write a bilingual (EN + ZH) post under
`packages/docs/blog/` + `packages/docs/zh/blog/`, register it in both
`blog/index.md`, flip the topic to `done`, and open a PR (human merges).
(Manual trigger — run it once a week. See `.claude/commands/weekly-blog.md`.)

> Cadence: **one per week**. Keep posts concrete — real scenarios, real commands,
> honest comparisons. No fluff, no overclaiming.

## Queue

| # | Topic | Angle | Status |
|---|---|---|---|
| 1 | What is a "harness"? | The missing layer between your AI agent and your running frontend — define the term, why "harness" not "devtool". | done |
| 2 | The 2026 landscape: how agents see the browser today | Survey Chrome DevTools MCP / Playwright MCP / browser-use / Sentry·LogRocket — what each does and where it stops. | todo |
| 3 | The pain: by the time the bug is reported, the scene is gone | The core problem harness-fe solves — no stable, structured record an agent can pick up. | todo |
| 4 | Real scenario: "user keeps getting logged out" — DevTools vs harness-fe | Same bug, two workflows, side by side. Commands + timeline. | todo |
| 5 | Source-aware debugging: why file:line changes everything | `data-morphix-loc` — the agent edits the right line, no grep, no guessing. | todo |
| 6 | The report → fix → verify loop, explained | How the agent closes its own loop, with the re-test session as proof. | todo |
| 7 | Does harness-fe work with React Native / Flutter? | The honest answer (web-only today) + the technical path to RN/Flutter. | todo |
| 8 | The sandbox interceptor: observing fetch / storage / DOM | How `@harness-fe/sandbox` hijacks browser APIs to feed the agent. | todo |
| 9 | Team mode: one shared gateway, zero collisions | Identity, tenant isolation, project→agent binding — why teams need it. | todo |
| 10 | Consent & runtime control: letting users say no to the agent | The default-deny gate + the user's runtime opt-in. | todo |
| 11 | Session replay for agents (rrweb), not just humans | Replaying the exact failing flow so the agent reproduces it. | todo |
| 12 | Dev-only, zero production footprint — and why that's the point | Contrast with prod monitors; trust + safety story. | todo |
| 13 | MCP-native: 45+ tools, any client | Claude Code / Cursor / Kiro / Windsurf — one server, full toolset. | todo |
| 14 | Building a self-evolving demo: dogfooding the feedback→fix loop | The demo site experiment — can a site improve itself from user feedback? | todo |
| 15 | From 3.x to 4.0: rewriting for the team line | The architecture rebuild, the gateway, what we learned. | todo |
| 16 | Default-deny: secure visibility for shared daemons | Why a token with no grants should see nothing. | todo |
| 17 | Tracing "who deleted my token?" with initiator stacks | Every storage/network/ws event carries its JS call site. | todo |
| 18 | Micro-frontends: one timeline across host + sub-apps | Same-origin iframe identity inheritance for debugging MFEs. | todo |

## Done

<!-- routine moves published topics here with date + link -->

- 2026-06-12 · #1 What is a harness? → [`blog/2026-06-12-what-is-a-harness`](../packages/docs/blog/2026-06-12-what-is-a-harness.md)
- 2026-06-13 · (ad-hoc real scenario) The bug that vanishes when you refresh — Morphix SSE reconnect race → [`blog/2026-06-13-streaming-agent-reconnect-bug`](../packages/docs/blog/2026-06-13-streaming-agent-reconnect-bug.md)
