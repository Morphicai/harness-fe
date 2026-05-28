---
title: "Chrome DevTools getting in your way? Try Harness-FE"
description: A real "user keeps getting logged out" bug, and why frontend debugging looks different in the AI era.
date: 2026-05-28
author: Harness-FE team
---

# Chrome DevTools getting in your way? Try Harness-FE

> *English translation in progress.*
>
> The full post is available in Simplified Chinese:
>
> **→ [Chrome DevTools 不好用?不妨试试 Harness-FE](/zh/blog/2026-05-28-devtools-vs-harness-fe)**
>
> Until the English version lands, here's the 30-second pitch:
>
> A user kept getting randomly logged out. DevTools could show the empty
> `localStorage.auth_token`, but not *who* removed it. Setting breakpoints on
> 27 `removeItem` call sites and waiting for a low-frequency reproduction
> burned 90 minutes — and yielded nothing.
>
> Harness-FE captures every storage write together with the **JS stack that
> issued it**. One tool call (`storage_tail({ op: 'remove', key: 'auth_token' })`)
> returned the call site: an axios response interceptor that cleared the
> token on *any* 401 — including the spurious 401s coming from
> `/api/avatar/by-uid`. Root cause in 90 seconds.
>
> Read the [Chinese version](/zh/blog/2026-05-28-devtools-vs-harness-fe) for
> the full walkthrough with screenshots and four more case studies.

---

## Try it

```bash
npx @harness-fe/skill install
```

Then ask your agent: *"Set up Harness-FE in this project."*

- [Docs](/) (EN + 简体中文)
- [GitHub](https://github.com/Morphicai/harness-fe) (MIT)
- [MCP tools reference](/reference/mcp-tools)
