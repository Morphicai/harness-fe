---
'@harnessa-fe/runtime': minor
---

Add an "Open dashboard" button to the in-page overlay info card. The
button derives the daemon's dashboard URL from the runtime's `mcpUrl`
(swap `ws://`/`wss://` → `http://`/`https://`, point at `/dashboard/`,
carry the token query), deep-links to the current session, and pops it
in a new tab on click. Hidden when no `mcpUrl` is configured.

If the host page blocks popups (sandboxed iframe, strict CSP), the
button falls back to copying the URL so the user can paste it.
