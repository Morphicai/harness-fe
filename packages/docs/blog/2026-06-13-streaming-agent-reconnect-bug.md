---
title: "The bug that vanishes when you refresh: debugging a streaming agent with harness-fe"
description: "A real bug from building Morphix: refresh mid-stream and a sub-agent's results duplicate or disappear. The first scene is gone before you can look. Here's how harness-fe gets it back — and how an agent fixes it."
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

## Why this is a nightmare in DevTools

DevTools is a window onto **the tab in front of you, right now**. This bug lives
in three places DevTools can't reach:

1. **The first scene is gone.** The refresh blew away the streaming state — the
   in-memory cursor of "which event did I last process", the half-assembled
   message. DevTools snapshots *after* the reload; the moment that mattered is
   unrecoverable.
2. **The order events arrived at the browser ≠ the order your store processed
   them.** A streaming chat assembles partial chunks and buffers out-of-order
   sub-agent events until their `start` arrives. DevTools shows you the final
   rendered text, not *which event hit the wire first* — which is exactly the
   thing that determines whether you double-render.
3. **The auth token may have rotated under you.** On reconnect the client
   re-reads the session token before opening the new stream. If the token
   refreshed in the background, the reconnect quietly uses a dead one and the
   server drops it — no thrown error, just a stream that stops. DevTools shows
   `net::ERR_…`, never *which token hash* went out on *which request*.

Three invisible layers, one flaky symptom. This is the kind of bug that eats an
afternoon.

## What was actually happening

The shape of it (the parts any streaming-agent frontend has):

- An **SSE reader** that tracks a `Last-Event-ID`. On reconnect it sends that ID
  back so the server resumes from the right cursor — *if* the client preserved
  it across the refresh.
- A **race-guard buffer**: sub-agent events (`thinking`, `tool_call`,
  `tool_result`) that arrive *before* their `sub_agent_start` get parked in a
  map keyed by task id, then flushed when `start` finally lands. If `start` is
  delayed past the refresh boundary, the buffer's lifetime and the resume cursor
  have to agree — or you replay events the server already re-sent.
- A **token read on every (re)connect**: the stream's `Authorization` header is
  fetched fresh each time the stream opens. A background token refresh racing
  that read is enough to kill the resumed stream.

The duplicate/missing result was the buffer and the resume cursor disagreeing
about what had already been delivered — but you can only *see* that if you can
see the byte-level event order and the exact reconnect header. Which is the whole
point of a harness.

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
  *same* token hash. The silent 401 stops being silent.

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

The bug that vanishes when you refresh doesn't vanish from a harness. That's the
difference between "the agent can edit files" and "the agent can debug the
running thing."

## Try it

```bash
npx @harness-fe/skill install
```

Then: *"Set up harness-fe in this project."*

- [Quickstart](/guide/quickstart) · [What is a harness?](/blog/2026-06-12-what-is-a-harness) · [How it compares](/#how-it-compares)
- [GitHub](https://github.com/Morphicai/harness-fe) (MIT)
