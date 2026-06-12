---
title: "What is a harness? The missing layer between your AI agent and your frontend"
description: "Coding agents got good at writing code. They're still, in Chrome's own words, 'programming with a blindfold on' the moment that code runs in a browser. A harness is the layer that takes the blindfold off — eyes, hands, and a map back to the exact source line."
date: 2026-06-12
author: harness-fe team
---

# What is a harness?

Here is a sentence from Google Chrome's own engineering blog, describing the AI
coding agents most of us now use every day:

> "they are not able to see what the code they generate actually does when it
> runs in the browser. They're **effectively programming with a blindfold on**."
> — [Chrome DevTools team](https://developer.chrome.com/blog/chrome-devtools-mcp)

That is not a competitor's jab. That is the team that *makes the browser*
describing the state of the art. It is worth sitting with, because it reframes
what's actually broken in agent-assisted frontend work — and "harness" is the
name for the fix.

## The blindfold is real, and it's specific

Your coding agent — Cursor, Claude Code, Copilot, Windsurf — is genuinely good at
one thing: it reads your repo, reasons about it, and writes a patch. Then the
patch becomes a *running app*, and the agent goes dark.

It's not vaguely blind; it's blind to specific, enumerable things. As one
practitioner [catalogued](https://dev.to/bluehotdog/ai-coding-tools-that-actually-see-your-browser-2026-2hoc),
these tools work from source files and cannot observe **the rendered DOM,
computed styles, layout geometry, the compiled module graph, registered routes,
or server logs.** A button that doesn't fire, a request that 401s, a state that
resets on refresh — all of it lives in a runtime the agent never sees.

So what happens instead is what that same writer calls the
**"describe-check-fix loop"**: the AI makes an edit, *you* check the browser,
it's wrong, *you* describe it again. You are the agent's eyes, its hands, and its
grep tool. That's not an agent doing the work; that's you doing the work with
extra steps.

And it has a nastier failure mode than just slowness. As another engineer
[put it](https://www.huuhka.net/browser-verification-for-coding-agents-chrome-devtools-mcp-vs-agent-browser/)
after extensive testing: "the model will happily tell you everything is fine
unless you give it some way to actually look at the result." The agent doesn't
*know* it's blind. It reports success on a broken UI — confidently. Current
models, the same source notes, "are still nowhere near reliable enough to just
reason the UI correctly from code alone."

**Looks done. Is broken.** That's the tax the whole industry is paying right now.

## A harness, on purpose

A **harness** closes that gap, and we picked the word deliberately. A harness is
what you put on something powerful and *already in motion* — a horse, a climber,
a parachutist — so you can **observe it and guide it without replacing it.** You
don't rebuild the horse. You don't stop it to inspect it. You strap on a layer
that gives you a grip on what's already happening.

That's exactly the relationship an agent needs with your frontend. The app is
running. You don't want to freeze it, mock it, or rewrite it to make it
debuggable. You want to slip a thin layer over the live thing that lets the agent
**watch it, steer it, and — crucially — trace anything it sees back to the line
of source that produced it.**

## What harness-fe actually does

harness-fe is a dev-time harness for the browser. Drop in one build plugin, point
an MCP-aware agent at it, and the agent gains three abilities on your *running*
app:

- **Eyes** — a structured, replayable timeline of console, network, WebSocket,
  storage, errors, and the DOM (via rrweb). Not a screenshot the agent has to
  squint at; a record it can *query*. And every event carries the **JS stack that
  issued it** (`initiator.stack`) — so "who cleared `auth_token`?" is one query,
  not a debugging session.
- **Hands** — it can click, type, navigate, and evaluate in the page, behind a
  consent gate you control.
- **A source map** — every element carries its JSX origin (`data-morphix-loc`),
  so "this button" resolves to `Button.tsx:42`. No guessing, no grep, no
  react-devtools archaeology.

The agent reads the timeline, jumps to the source line, proposes a fix, then
drives the browser back to **prove** it. Report → fix → verify, in one loop the
agent closes by itself — instead of routing every step through a human
copy-pasting logs.

## A harness is defined as much by what it *isn't*

This is a crowded space, so the boundaries matter:

- It's **not DevTools — and not Chrome DevTools MCP either.** Those attach to the
  one tab in front of the agent, *now*. Chrome DevTools MCP is real and capable
  (it inspects live DOM/CSS, reads network and console, drives the page). But it
  observes on demand, in the moment. A harness *passively captures and persists*
  — so the scene survives a reload, an HMR, a tab switch, the gap between "QA hit
  it" and "agent looks at it." (We go deep on this contrast in a
  [separate post](/blog/2026-05-28-devtools-vs-harness-fe).)
- It's **not a production monitor.** Sentry / LogRocket / OpenReplay watch prod
  for humans. A harness runs **dev-only**, with zero production footprint and no
  telemetry to third parties.
- It's **not a browser bot.** browser-use and friends drive a browser to complete
  an end-user task. A harness exists to help *you* fix *your* app — observe,
  locate, drive, verify.

Those boundaries are the point. A harness is the thin, dev-time layer that turns
"the agent can edit files" into "the agent can debug the running thing."

## Why this is suddenly tractable

Two things converged. First, agents got good enough at code that the bottleneck
*moved*: it's no longer writing the fix, it's knowing what's actually wrong and
proving the fix worked — both of which live in the running app, not the repo.

Second, there's now a standard wire for it. The
[Model Context Protocol](https://en.wikipedia.org/wiki/Model_Context_Protocol),
introduced by Anthropic in November 2024, was adopted by OpenAI in March 2025 and
Google weeks later; by 2026 it
[runs in production at companies large and small](https://blog.modelcontextprotocol.io/posts/2026-mcp-roadmap/).
That means a harness doesn't need to be a plugin for one agent — it can speak one
protocol every agent already understands. The runtime feeds a timeline; MCP
carries it to whatever agent you use.

The blindfold came off the moment those two lines crossed. A harness is just the
layer that takes advantage of it.

## Try it

```bash
npx @harness-fe/skill install
```

Then ask your agent: *"Set up harness-fe in this project."*

- [Quickstart](/guide/quickstart) · [DevTools vs harness-fe](/blog/2026-05-28-devtools-vs-harness-fe) · [How it compares](/#how-it-compares)
- [GitHub](https://github.com/Morphicai/harness-fe) (MIT)
