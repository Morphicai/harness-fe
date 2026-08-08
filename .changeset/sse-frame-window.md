---
'@harness-fe/runtime': patch
'@harness-fe/gateway': patch
---

`network.tail` can now actually read a long SSE stream (follow-up to the frame
tee in 4.5.1). Three things made the frames unreadable in practice:

- **Frames shared the 200-slot network ring.** A real agent run emits hundreds
  of frames (one `message.upsert` per token), so the sparse lifecycle frames you
  actually need — `sub_agent_end`, `done` — were evicted before the run
  finished, and they evicted every req/res entry on the way out. Frames now live
  in their own 2000-slot ring, merged back chronologically for reads.
- **Filters ran over the last `n` entries, not the buffer.** `{n: 20, filter:
  'sub_agent'}` searched only the newest 20 entries, so a narrow filter over a
  busy buffer looked like "it never happened". Every `*_tail` now filters the
  whole buffer and returns the newest `n` matches.
- **Nothing said you were looking at a window.** Tails now report `matched`
  (total matches before `n`), `truncated: true` when older matches exist, and
  `dropped`/`bufferCap` once the ring has evicted anything.

Also: `network.tail` gained a `phase` narrow (`req`/`res`/`frame`),
`network.get` returns every retained frame for a request in order (with
`total` and an optional `maxFrames` cap), and all tails accept `limit` as an
alias for `n` — half the toolset already spelled it `limit`, and passing the
wrong one was silently ignored, handing you the default 20 back.

Side effect of the split ring: a streaming request no longer counts as finished
the moment its first frame arrives, so `network.idle` / `network.wait_for_idle`
stay correctly busy for the life of the stream.
