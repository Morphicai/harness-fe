---
"@harness-fe/runtime": patch
---

fix(runtime): bump rrweb to 2.1.0 — fixes recorder crash on non-Element mutation nodes when `blockSelector` is set (#183)

`rrweb@2.0.0-alpha.4`'s `isBlocked()` called `node.matches(blockSelector)` on the raw mutation node instead of the already-resolved Element (`el`), so any Text/Comment node added to the DOM (extremely common — any reactive text update) threw `TypeError: node.matches is not a function`, flooding the console and dropping recorded mutations. This only triggered when `blockSelector` was configured — the exact option harness-fe recommends for skipping micro-frontend containers (e.g. wujie's `wujie-app`) it can't safely traverse. Fixed upstream in `rrweb@2.1.0`, which resolves the element correctly and wraps the check in a try/catch. No harness-fe API surface changed — `record()` options, event-type numeric constants (`FullSnapshot=2` etc.), and the FullSnapshot-baseline logic in `@harness-fe/core` are all unaffected.

This release also re-resolves this package's `@harness-fe/sandbox` dependency to `^4.3.0` (previously frozen at `^4.0.0` since this package's last publish), which includes the #180 binary-WebSocket-frame fix. Apps still on `@harness-fe/runtime@4.1.0` that hit WebRTC/Agora signaling breakage (#184) should upgrade past this version — that issue's root cause was already fixed in `sandbox@4.3.0`, but this package's own published dependency range never moved to pick it up.
