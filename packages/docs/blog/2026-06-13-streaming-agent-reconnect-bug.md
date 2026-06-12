---
title: "The bug that vanishes when you refresh: debugging a streaming agent with harness-fe"
description: "A real bug from building Morphix: refresh mid-stream and a sub-agent's results duplicate or disappear. It's the exact bug class coding agents fail at — timing-dependent, no exception, gone before you can look. Here's why, with citations, and how a harness closes the loop."
date: 2026-06-13
author: harness-fe team
---

# The bug that vanishes when you refresh

This one is real. I hit it building [Morphix](https://morphixai.com) — an AI
platform where the assistant streams its reasoning and tool calls to the browser
over SSE, and can spawn **sub-agents** (e.g. "search flights") whose events
stream back interleaved with the parent's.

Here's the bug:

> You're mid-conversation. The agent is running a sub-agent task. You refresh the
> page. The conversation rehydrates, the stream resumes — and the sub-agent's
> tool call either **runs twice** in the UI, or its **result is missing**.

It doesn't reproduce on demand. It needs a refresh at the wrong moment, plus the
network to redeliver events in a slightly different order than last time. By the
time you open DevTools, the scene that caused it is already gone.

## Why this is the exact bug class agents fail at

It's worth being precise about why this kind of bug is *agent kryptonite*,
because it's not a Morphix quirk — it's a documented, structural gap.

A coding agent works from source files. It does not observe **the rendered DOM,
computed styles, layout geometry, the compiled module graph, or runtime state**
([source](https://dev.to/bluehotdog/ai-coding-tools-that-actually-see-your-browser-2026-2hoc)).
For a timing-dependent streaming bug, *all* the evidence is runtime: the order
events arrived, what was in the store at refresh, which token went out on the
reconnect. None of it is in the repo.

So the agent does what current agents do on frontend work: it reads the code, it
reasons, and — because nothing throws an exception — it concludes the code looks
correct and **reports success**. As one engineer found after heavy testing, "the
model will happily tell you everything is fine unless you give it some way to
actually look at the result"
([source](https://www.huuhka.net/browser-verification-for-coding-agents-chrome-devtools-mcp-vs-agent-browser/)).
Looks done. Still double-rendering on every third refresh.

And the obvious tool doesn't save you here either. Chrome DevTools MCP can drive
and inspect the tab in front of it — but this bug's first scene was destroyed by
the refresh. You can't attach to a moment that's already gone. You need something
that was *already recording* when it happened.

## What was actually happening

The shape of it (the parts any streaming-agent frontend has):

- An **SSE reader** that tracks a `Last-Event-ID`. On reconnect it sends that ID
  back so the server resumes from the right cursor — *if* the client preserved
  it across the refresh.
- A **race-guard buffer**: sub-agent events (`thinking`, `tool_call`,
  `tool_result`) that arrive *before* their `sub_agent_start` get parked in a map
  keyed by task id, then flushed when `start` finally lands. (In Morphix this is
  a literal `pendingSubAgentEvents` map — the race is real enough that the code
  already carries a guard for it.) If `start` is delayed past the refresh
  boundary, the buffer's lifetime and the resume cursor have to agree — or you
  replay events the server already re-sent.
- A **token read on every (re)connect**: the stream's `Authorization` header is
  fetched fresh each time the stream opens. A background token refresh racing
  that read is enough to kill the resumed stream — with no thrown error, just a
  stream that quietly stops.

The duplicate/missing result is the buffer and the resume cursor disagreeing
about what was already delivered — but you can only *see* that disagreement if
you can see the byte-level event order and the exact reconnect header. Which is
the whole point of a harness.

## How harness-fe got the scene back

With the harness-fe runtime installed, every one of those invisible layers is a
queryable, replayable record — and every event carries the **JS stack that
issued it**.

- **`network_tail`** — the dying first stream and the reconnect, side by side.
  You see the first stream's last delivered event id, and the
  `Last-Event-ID: …` header the reconnect actually sent. Did the client resume
  from the right cursor? Now it's a fact, not a guess.

- **`storage_tail` + `initiator.stack`** — every write to the auth token, with
  the call site that did it. You see the background refresh fire at `T+2m58s`,
  and the reconnect's token read at `T+3m01s` — and whether they returned the
  *same* token. The silent 401 stops being silent. (This is also where DevTools
  MCP's blind spot bites: its console stack traces point at *bundled* code, not
  your source — [a documented limitation](https://github.com/ChromeDevTools/chrome-devtools-mcp/issues/695) — whereas
  `initiator.stack` plus build-time source tags land you on the real line.)

- **`session_tail` / the timeline** — the events in true arrival order:
  `tool_result(task=42)` arrived **before** `sub_agent_start(task=42)`; it was
  buffered; the refresh landed; on resume the server re-sent both — and the flush
  replayed the buffered one *on top of* the resent one. There's your double.

- **`session_replay`** — scrub the refresh moment frame by frame. See exactly
  what was in the message list at `T-200ms`, at the reload, and at resume. The
  stale state is right there on the timeline.

- **`project_where_is`** — jump straight from "the race-guard buffer" to the
  exact `file:line` that owns it, because every element and call site is tagged
  at build time. No grep, no "which store was this again".

What took an afternoon of "add a log, refresh, hope it repros" becomes: read the
timeline, read the stack, see the disagreement, fix the cursor/flush ordering.

## The part that matters: the agent does this, not you

None of the above is a human clicking around DevTools. It's an **AI agent**
reading the timeline through MCP tools, jumping to the source line, proposing the
fix — and then **driving the browser to re-run the refresh-mid-stream flow** and
checking the timeline is clean. Report → fix → **verify**, closed by the agent,
with the re-test session kept as proof.

That last step is the one the industry keeps skipping. The describe-check-fix
loop ([the documented default](https://dev.to/bluehotdog/ai-coding-tools-that-actually-see-your-browser-2026-2hoc))
puts a human in the verify seat for every iteration. A harness moves the verify
into the loop the agent already runs.

The bug that vanishes when you refresh doesn't vanish from a harness. That's the
difference between "the agent can edit files" and "the agent can debug the
running thing."

## Try it

```bash
npx @harness-fe/skill install
```

Then: *"Set up harness-fe in this project."*

- [What is a harness?](/blog/2026-06-12-what-is-a-harness) · [DevTools vs harness-fe](/blog/2026-05-28-devtools-vs-harness-fe) · [Quickstart](/guide/quickstart)
- [GitHub](https://github.com/Morphicai/harness-fe) (MIT)
