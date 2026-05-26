---
'@harness-fe/runtime': minor
---

**Periodic rrweb baselines (default 30 min).** The runtime now passes `checkoutEveryNms: 30 * 60 * 1000` to rrweb's `record()`, so long-running sessions emit a fresh FullSnapshot baseline every 30 minutes on top of the existing start-of-session baseline and the per-reconnect baseline forced at each ws hello-ack.

**Why:** previously, a session that never reconnected anchored every window-replay against the single baseline emitted at `record()` start. Mid-session "tail the last 5 minutes" replays had to roll forward potentially hours of incremental events to reach the window. Periodic baselines cap that distance to ≤ 30 min, making window replays cheaper and the worst-case "no baseline survived in outbox" scenario much less likely.

**Cost:** ~16 extra FullSnapshots per 8-hour session. At a typical 100–500KB per snapshot this adds ~2–8 MB to each session's storage and a comparable bump to bridge bandwidth.

**Override:** new `RuntimeClient` option:

```ts
new RuntimeClient({
    projectId: 'app',
    rrwebCheckoutEveryNms: 0,         // disable periodic baselines
    // rrwebCheckoutEveryNms: 60_000, // 1 min — heavier, but tail replays snap fast
});
```

Set to `0` (or any non-positive value) to opt back into the prior single-baseline-per-connect behavior. Otherwise no migration required — the new default kicks in automatically.
