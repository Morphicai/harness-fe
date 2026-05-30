---
'@harness-fe/mcp-server': minor
---

Command-target scoping (4.0 · A) — an agent's commands only drive tabs it may
control, instead of any tab on the daemon.

- `sessionRouter.findTab(tabId?, principal?)` restricts candidate tabs via
  `canSee(principal, tab.principal?.id)`: `local` drives anything (zero change
  for solo dev), unowned tabs are drivable by all, otherwise only the tab's
  creator. An explicit `tabId` can no longer target someone else's tab.
- New `callerContext` (AsyncLocalStorage): the HTTP MCP transport wraps each
  request in `runWithCaller(identifyPrincipal(headers))`, and `bridge.sendCommand`
  reads `currentCaller()` — so scoping applies to every command without
  threading `principal` through ~20 tool handlers. stdio has no ambient caller
  ⇒ no scoping (local trust). Explicit `opts.principal` still wins.

Zero behaviour change for solo/stdio dev (no ambient caller / local → no
filtering). Tests: findTab scoping (6) + callerContext ALS (4); full suite 304.
