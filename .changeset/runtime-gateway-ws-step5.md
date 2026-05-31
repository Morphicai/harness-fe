---
"@harness-fe/runtime": minor
"@harness-fe/unplugin": minor
---

Rebuild ⑤ — the runtime connects to the gateway `/ws` by default.

- The default WebSocket target is now `ws://127.0.0.1:<port>/ws` (the gateway
  front door) instead of the daemon's root socket. Both the build plugin and the
  in-browser runtime client pick it up. The wire protocol is unchanged, so this
  is purely a target/path change.
- `deriveDashboardUrl` now points at the gateway console (`/console`,
  `/console/session/:id`) instead of the old `/dashboard/`.
- Token semantics: the injected token is now expected to be a **write-scope**
  gateway token. Core denies every read/control capability to a write-only
  principal, so extracting the token from `window.__HARNESS_FE__` only lets a
  page report events and be driven — never read or drive anyone else's data.
  Solo (loopback) stays token-free.
