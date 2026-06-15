---
"@harness-fe/unplugin": minor
"@harness-fe/webpack": minor
"@harness-fe/runtime": minor
"@harness-fe/core": minor
"@harness-fe/gateway": patch
---

wujie/Electron issue cluster (#158–#162)

- Unified `window.__HARNESS_FE__` injection behind a single builder so the Vite and webpack plugins no longer drift; webpack now injects `overlay`/`consent` too.
- New build-time runtime knobs: `deferStart` (start after load + idle), `rrwebBlockSelector` (skip a subtree rrweb can't serialize, e.g. wujie's `wujie-app`), `idbThrottleMs` (sample IndexedDB telemetry), and `rrwebCheckoutEveryNms` (now reachable at build time).
- First `hello.ack` no longer re-takes a FullSnapshot (the start() baseline is already delivered) — avoids serializing the DOM twice on first paint.
- Recording retention default lowered to 30 min (`recordingRetentionMs`, configurable; legacy `recordingRetentionDays` still honored), and pruning is now baseline-aware so a short window stays replayable — the FullSnapshot the surviving chunks depend on is never evicted.
- Console visibility fixes: a read token issued without an explicit `projects=` now sees all projects (the documented "undefined = all"); the session list no longer drops sessions whose project-owning participant is empty or not first (admin saw an empty list).
