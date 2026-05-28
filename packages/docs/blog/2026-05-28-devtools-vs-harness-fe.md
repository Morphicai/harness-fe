---
title: "Chrome DevTools getting in your way? Try Harness-FE"
description: "By the time QA files a bug, the first scene is gone. Harness-FE is my attempt to recover it for the agent — and let the agent fix the bug itself."
date: 2026-05-28
author: Harness-FE team
---

# Chrome DevTools getting in your way? Try Harness-FE

> *English translation in progress.*
>
> The full essay is available in Simplified Chinese:
>
> **→ [Chrome DevTools 不好用?不妨试试 Harness-FE](/zh/blog/2026-05-28-devtools-vs-harness-fe)**
>
> Until the English version lands, here's the 30-second pitch:
>
> QA pings you: *"this button doesn't work."* You try it yourself — works fine. By the time you ask for details, the first scene is gone. Multi-account testing across Chrome profiles? Mobile debugging? Same problem — there's no stable, structured record of what just happened that the agent can pick up.
>
> Chrome DevTools MCP exists but only sees the tab in front of you. The tabs that matter — QA's tab, the mobile tab, the past tab — are invisible to it.
>
> Harness-FE installs a runtime in every browser the dev cluster touches and keeps a structured session timeline in a local daemon. Every storage write, every fetch, every navigation carries the **JS stack that issued it**. The agent reads the timeline, jumps to the source line via the JSX `data-morphix-loc` tag, proposes a fix, then drives the browser back to verify.
>
> The full Chinese version walks through a real *"user keeps getting logged out"* debug session resolved in 90 seconds, plus the architecture, four more case studies, why I built this, and what's next.

---

## Try it

```bash
npx @harness-fe/skill install
```

Then ask your agent: *"Set up Harness-FE in this project."*

- [Docs](/) (EN + 简体中文)
- [GitHub](https://github.com/Morphicai/harness-fe) (MIT)
- [MCP tools reference](/reference/mcp-tools)
