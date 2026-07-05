---
"@harness-fe/core": patch
---

fix(core): correct the documented EventType union + JsonlStore.summary() lastError detection (#179)

`EventType` in `store/types.ts` documented `log`/`err`/`req`/`res` as the wire type strings for browser console, JS errors, and network events. That was never what actually gets written to disk — `runtime-client/src/capture.ts`'s `adapt()` sends `console`/`error`/`network` (network direction is a `phase` field inside `d`, not a separate top-level type). Corrected the union to match reality and added the missing `rrweb:marker` type (emitted by `bridge.ts`, previously undocumented).

This wasn't just a docs mismatch: `JsonlStore.summary()` compared `event.t === 'err'` to populate `lastError` — since real error events are `t: 'error'`, `lastError` was never populated for any real session. Fixed to `=== 'error'`.
