---
title: "Does harness-fe work with React Native or Flutter? An honest answer"
description: "Today: web only. Here's exactly why — what harness-fe patches to give an agent eyes and hands — and the concrete technical path to React Native and Flutter, where it's the same contract behind a different adapter."
date: 2026-06-14
author: harness-fe team
---

# Does harness-fe work with React Native or Flutter?

Short answer: **today, web only.** Not "coming soon" vaporware in the docs — the
runtime ships for browsers, and that's what you should build on right now.

But "web only" is the kind of answer that deserves the *why*, because the why
tells you exactly what would have to change for React Native and Flutter — and
why we think the change is an **adapter**, not a rewrite.

## What harness-fe actually patches

harness-fe gives an AI agent three things on a running frontend: **eyes**
(observe what happened), **hands** (drive the app), and a **map** (jump from a
symptom to the exact source line). On the web, all three are built on machinery
that is intrinsically *browser* machinery:

- **Eyes** come from `@harness-fe/sandbox`, which patches nine browser globals:
  `fetch`, `XMLHttpRequest`, `WebSocket`, `Storage` (local/session),
  `history`, `location`, `IndexedDB`, `console`, and global `window` keys. Every
  call flows through an interceptor that records it — with the **JS stack that
  issued it** — into a structured timeline. Plus rrweb for DOM-level
  **session replay**.
- **Hands** come from driving the DOM and the page: click, type, navigate,
  scroll, screenshot — all expressed against an element tree that only a browser
  has.
- **The map** comes from a **build-time transform** that stamps every element
  with a `data-morphix-loc` source tag, so "this button" resolves to
  `Component.tsx:42` with no grep.

Notice the common ingredient: **a browser**. There is no `window.fetch` to patch
in a React Native bundle, no DOM to replay with rrweb, no HTML element to stamp
with a source attribute. That's not a missing feature — it's a different runtime.
Pretending otherwise would be the kind of overclaiming we refuse to do.

## The part that *does* carry over: the contract

Here's the design decision that makes RN and Flutter tractable rather than
hopeless. The agent never talks to the sandbox directly. It talks to a **stable
MCP tool surface** — `network_tail`, `errors_tail`, `console_tail`,
`storage_tail`, `page_screenshot`, `session_replay_create`, `page_click`,
`project_where_is`, and the rest — keyed by a `sessionId`.

That contract is platform-agnostic. "Give me the last 20 network requests with
their initiator stacks" is a meaningful question on *any* runtime that makes
network calls. What changes per platform is only the **adapter** underneath:
the thing that knows how to actually capture a network call, a log, a crash, a
screenshot, an interaction — and feed it into the same timeline under the same
`sessionId`.

It helps that the contract rides on a standard. The
[Model Context Protocol](https://en.wikipedia.org/wiki/Model_Context_Protocol)
(Anthropic, Nov 2024; adopted by OpenAI and Google in 2025) has
[consolidated into the default agent integration layer](https://blog.modelcontextprotocol.io/posts/2026-mcp-roadmap/),
running in production across the industry by 2026. So the agent side of the
contract is fixed regardless of platform — a React Native or Flutter adapter
doesn't invent a new agent interface, it speaks the one every MCP client already
knows.

So the roadmap isn't "rebuild harness-fe for mobile." It's "write a new adapter
that speaks the existing contract."

## The path to React Native

React Native is the nearer target, because its JS layer already has analogues
for several channels:

- **Network** — RN ships `fetch`, `XMLHttpRequest`, and `WebSocket`. These are
  patchable the same way the web sandbox patches them; the interceptor model
  transfers almost directly.
- **Console & errors** — RN has `console` and a global error/`unhandledRejection`
  surface. Straightforward to capture.
- **Storage** — there's no `localStorage`; the equivalent is `AsyncStorage` (and
  MMKV, SQLite). Same *idea* (key/value writes on a timeline), different API to
  wrap.
- **Eyes without a DOM** — rrweb doesn't apply; there is no DOM. Replay becomes
  **screenshots + the native view tree** instead of serialized HTML mutations.
- **Hands** — driving means tapping/typing against the RN component tree, not
  clicking DOM nodes.
- **The map** — source-aware mapping moves from a web bundler plugin to a
  **Metro / Babel transform**, mapping RN elements / `testID` / accessibility
  labels / component names back to files. Same `file:line` payoff, different
  build step.

Concretely, the roadmap entry is a dev-only `@harness-fe/react-native` runtime
client for console / errors / network / screenshots / interaction, sharing the
same `sessionId` + MCP semantics — plus first-class **Expo** support (including
dev clients with native modules) and Metro-based source mapping.

## The path to Flutter

Flutter is the harder one, and worth being blunt about: there is **no
JavaScript**. You can't patch `window.fetch` because there's no `window` and no
JS engine in the app. The adapter has to live in **Dart**.

The realistic shape is a Dart-side SDK that hooks Flutter's own observability
seams — the VM service protocol / `dart:developer`, Dart's `HttpClient` and
logging, the widget tree, and screenshots — and forwards them to the daemon
under the same `sessionId`. The contract the agent sees
(`network_tail`, `errors_tail`, `page_screenshot`, a widget-tree query) stays
identical; only the capture mechanism is entirely new. That's a bigger build
than RN, which is why it sits later on the roadmap.

## So what should you do today?

If you're building for the **web**, harness-fe is ready — `npx @harness-fe/skill
install` and your agent has eyes, hands, and a source map. If you're on **React
Native or Flutter**, the honest answer is: not yet, and we won't tell you
otherwise to win a star. Follow the [roadmap](https://github.com/Morphicai/harness-fe);
the RN adapter is the next platform frontier, and the contract it will speak
already exists.

The thing we want you to take away: harness-fe isn't "a browser tool." It's a
**contract for how an agent observes and drives a running app** — and the browser
is just the first runtime to implement it.

## Try it (on the web, today)

```bash
npx @harness-fe/skill install
```

- [Quickstart](/guide/quickstart) · [What is a harness?](/blog/2026-06-12-what-is-a-harness)
- [GitHub](https://github.com/Morphicai/harness-fe) (MIT) · [Roadmap](https://github.com/Morphicai/harness-fe/blob/main/ROADMAP.md)
