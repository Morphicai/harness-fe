---
title: "What is a harness? The missing layer between your AI agent and your frontend"
description: "Your AI agent can write code but can't see or touch your running app. A harness is the layer that gives it eyes, hands, and a map back to the exact source line."
date: 2026-06-12
author: harness-fe team
---

# What is a harness?

Your AI coding agent is good at one thing and blind to another.

It can read your repo, reason about it, and write a patch. But the moment your
code becomes a *running app* — a button that doesn't fire, a request that 401s,
a state that resets on refresh — the agent goes dark. It can't see the console.
It can't watch the network. It can't click the button, and it certainly can't
tell you which of your 400 components rendered that button. You become its eyes,
its hands, and its grep tool. You paste logs. You describe what you saw. You
re-run the repro for it. That's not an agent doing the work; that's you doing
the work with extra steps.

A **harness** closes that gap.

## The metaphor, on purpose

We didn't pick the word "harness" to sound clever. A harness is what you put on
something powerful and *already in motion* — a horse, a climber, a parachutist —
so you can **observe it and guide it without replacing it.** You don't rebuild
the horse. You don't stop it to inspect it. You strap on a layer that gives you
a grip on what's already happening.

That's exactly the relationship between an agent and your frontend. The app is
running. You don't want to freeze it, mock it, or rewrite it to make it
debuggable. You want to slip a layer over the live thing that lets the agent
**watch it and steer it** — and, crucially, trace anything it sees back to the
line of source that produced it.

## What harness-fe actually does

harness-fe is a dev-time harness for the browser. Drop one build plugin in, point
an MCP-aware agent at it, and the agent gains three abilities on your *running*
app:

- **Eyes** — a structured, replayable timeline of console, network, WebSocket,
  storage, errors, and the DOM (via rrweb). Not a screenshot; a record it can
  query.
- **Hands** — it can click, type, navigate, and evaluate in the page (behind a
  consent gate you control).
- **A source map** — every element carries its JSX origin (`data-morphix-loc`),
  so "this button" resolves to `Button.tsx:42`. No guessing, no grep.

The agent reads the timeline, jumps to the source line, proposes a fix, then
drives the browser back to **prove** the fix. Report → fix → verify, in one loop
the agent closes itself.

## A harness is defined as much by what it *isn't*

- It's **not DevTools.** DevTools is for a human staring at one tab. A harness is
  a structured feed an agent can consume across tabs, sessions, and time.
- It's **not a production monitor.** Sentry/LogRocket watch prod for humans;
  a harness runs **dev-only**, with zero production footprint and no telemetry to
  third parties.
- It's **not a browser bot.** browser-use and friends drive a browser to complete
  an end-user task. A harness exists to help *you* fix *your* app — observe,
  locate, drive, verify.

Those boundaries are the point. A harness is the thin, dev-time layer that turns
"the agent can edit files" into "the agent can debug the running thing."

## Why this matters now

Agents got good at code. The bottleneck moved: it's no longer *writing* the fix,
it's *knowing what's actually wrong* and *proving the fix worked* — both of which
live in the running app, not the repo. A harness is the layer that gives the
agent first-class access to that runtime, instead of routing it through a human
copy-pasting logs.

## Try it

```bash
npx @harness-fe/skill install
```

Then ask your agent: *"Set up harness-fe in this project."*

- [Quickstart](/guide/quickstart) · [How it compares](/#how-it-compares)
- [GitHub](https://github.com/Morphicai/harness-fe) (MIT)
