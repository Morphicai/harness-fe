---
'@harnessa-fe/runtime': patch
---

Fix: rrweb FullSnapshot baseline was silently dropped in the "record-first,
upload-later" scenario, leaving sessions permanently unreplayable with
`window contains no rrweb FullSnapshot (type:2) baseline, and no earlier
baseline could be found — replay would be blank`.

### Root cause

Two compounding bugs:

1. **Outbox FIFO eviction dropped the FullSnapshot first.** The outbox
   capped at 500 frames / 8 MB and evicted via `shift()` (oldest-first).
   rrweb emits the FullSnapshot at `record.start()` — making it the
   *oldest* frame in the outbox. If the daemon was unreachable for any
   meaningful stretch (laptop sleep, daemon restart, slow first connect
   in dev), incremental snapshots filled the buffer and evicted the
   baseline before drain.
2. **rrweb only emits FullSnapshot once.** After eviction, no later code
   path re-emitted it. WebSocket reconnects (incl. daemon restart) reused
   the existing `record()` lifecycle, which produces only incremental
   (type:3) events after the initial emit.

### Fix (two layers)

- **Layer 1 — Re-baseline on every connection.** `client.onHelloAck` now
  calls `recorder.takeFullSnapshot()`, which wraps rrweb's
  `record.takeFullSnapshot(true)`. Every successful ack — first connect,
  reconnect after daemon restart, network blip recovery — gets a fresh
  type:2 baseline.
- **Layer 2 — Outbox sticky protection.** Frames flagged `sticky` (today:
  any rrweb chunk containing a type:2 event) survive eviction even when
  the cap is busted. Non-sticky frames are evicted FIFO; if outbox is
  *all-sticky and still over cap*, the oldest sticky is dropped as a last
  resort (replay only needs the most recent baseline).

Outbox logic is now extracted to `src/outbox.ts` with 9 unit tests pinning
the eviction guarantees, including a regression test that reproduces the
original bug shape and proves the sticky frame survives.
