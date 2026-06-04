---
'@harness-fe/protocol': minor
'@harness-fe/gateway': minor
'@harness-fe/runtime': minor
---

Browser Consent (4.0 · P2) — control commands now require in-page user
approval before they run, once the daemon is exposed.

- The daemon pushes a consent policy in `hello.ack`: `off` on loopback solo
  dev (zero-friction, unchanged) and `session` once auth is enabled
  (exposed). Override via `createDaemon({ consent: { mode } })`.
- Control commands (`page.click/type/scroll/navigate/reload/set_html/
  set_style/evaluate/wait_for`) are gated; read-only commands (screenshot,
  dom_query, *_tail, project.*) are not. `page.evaluate` always prompts.
- The runtime client gates `handleCommand`: in `session` mode the first
  control command prompts and the rest of the pageload runs once granted;
  `always` prompts every time; `off` never prompts. No prompter registered ⇒
  fail-safe deny (a policy that can't ask must not silently allow).
- The in-page overlay shows a consent modal (command preview + Allow once /
  Allow for session / Deny) and registers itself as the prompter.

Client-side gate by design: consent is the browser-side user's real-time
approval, closest to the user; it reuses the existing command→response round
trip (a denied command returns `ok:false` / `CONSENT_DENIED`), so the daemon's
`sendCommand` path is unchanged. Behaviour is unchanged on loopback (consent
off). New `hello.ack.consent` field is optional.
