---
layout: home

hero:
  name: "Harness-FE"
  text: "Give your AI agent eyes, hands — and your source map"
  tagline: A dev-time harness that lets an MCP agent see your frontend's console, network, and DOM, drive the page, and trace every element back to the exact file and line. Report → fix → verify, in one loop.
  image:
    src: /hero-loop.svg
    alt: An AI agent (Claude · Codex · Cursor) at the center, running an autonomous loop — harness-fe feeds back what it sees and accepts the agent's control
  actions:
    - theme: brand
      text: Get started in 3 minutes
      link: /guide/quickstart
    - theme: alt
      text: How it compares
      link: "#how-it-compares"
    - theme: alt
      text: View on GitHub
      link: https://github.com/Morphicai/harness-fe

features:
  - icon: { src: /icons/source-aware.svg, width: 30, height: 30 }
    title: Source-aware, to the line
    details: Every element carries its JSX source location. The agent knows which file and line to edit — no guessing, no grep. The part no debugger gives you.
  - icon: { src: /icons/observability.svg, width: 30, height: 30 }
    title: Full-stack observability
    details: Console, network, WebSocket, errors, and rrweb DOM recordings — streamed to your agent in real time. Replay any session to see exactly what happened.
  - icon: { src: /icons/drive.svg, width: 30, height: 30 }
    title: Drive the browser, safely
    details: The agent can click, type, navigate, and evaluate — behind a consent gate the user controls. Opt in per app, or block it with one tap.
  - icon: { src: /icons/mcp.svg, width: 30, height: 30 }
    title: MCP-native
    details: Works with Claude Code, Cursor, Kiro, Windsurf, and any MCP-aware client. One server, 45+ tools, stdio or HTTP.
  - icon: { src: /icons/team.svg, width: 30, height: 30 }
    title: Team-ready (4.0)
    details: One shared gateway, scoped tokens, caller identity, and tenant isolation — teammates don't collide and each only sees their own projects.
  - icon: { src: /icons/dev-only.svg, width: 30, height: 30 }
    title: Dev-only, zero footprint
    details: The runtime ships only in development. Zero production overhead, zero telemetry to third parties, no accounts or API keys to start.
---

<div class="home-section">

## Built for the dev-time agent loop {#why}

Harness-FE isn't a production monitor and isn't a general-purpose browser bot.
It's the missing layer that turns an AI coding agent into one that can **see what
your app is doing, drive it, and know exactly which source line to fix** — then
prove the fix by replaying the flow. Drop in one build plugin, point an
MCP-aware agent at it, and the report → fix → verify loop closes itself.

## How it compares {#how-it-compares}

Other tools each cover a slice. Harness-FE is the one built end-to-end for the
**developer's** agent loop — source-aware, full-stack, and dev-only.

| | **Harness-FE** | Chrome DevTools MCP | browser-use & co. | Sentry / LogRocket |
|---|:---:|:---:|:---:|:---:|
| **Built for** | dev-time agent loop | browser debugging | end-user task agents | production monitoring |
| Source-aware (file : line) | <span class="ck y"></span> | <span class="ck n"></span> | <span class="ck n"></span> | <span class="ck n"></span> |
| Report → fix → verify loop | <span class="ck y"></span> | <span class="ck n"></span> | <span class="ck n"></span> | <span class="ck n"></span> |
| Full-stack observability¹ | <span class="ck y"></span> | <span class="ck p"></span> | <span class="ck n"></span> | <span class="ck y"></span> |
| Drive the page (agent) | <span class="ck y"></span> | <span class="ck y"></span> | <span class="ck y"></span> | <span class="ck n"></span> |
| Session replay (rrweb) | <span class="ck y"></span> | <span class="ck n"></span> | <span class="ck n"></span> | <span class="ck y"></span> |
| Multi-bundler / framework² | <span class="ck y"></span> | <span class="ck n"></span> | <span class="ck n"></span> | <span class="ck p"></span> |
| MCP-native | <span class="ck y"></span> | <span class="ck y"></span> | <span class="ck p"></span> | <span class="ck n"></span> |
| Dev-only · zero prod footprint | <span class="ck y"></span> | <span class="ck y"></span> | <span class="ck na"></span> | <span class="ck n"></span> |
| Team isolation + governance | <span class="ck y"></span> | <span class="ck n"></span> | <span class="ck n"></span> | <span class="ck y"></span> |

<p class="home-fineprint"><span class="ck y"></span> yes &nbsp;·&nbsp; <span class="ck p"></span> partial / conditional &nbsp;·&nbsp; <span class="ck n"></span> no &nbsp;·&nbsp; <span class="ck na"></span> n/a &nbsp;&nbsp;|&nbsp;&nbsp; ¹ console + network + WebSocket + errors + DOM recordings &nbsp;·&nbsp; ² Vite · Webpack · Rspack · Next.js · Vue · React</p>

<div class="home-cta">

**Three minutes to your first agent-driven session →** [Quickstart](/guide/quickstart) · [Team mode](/guide/team-mode) · [Migrating from 3.x](/guide/migration-3-to-4)

</div>

</div>
