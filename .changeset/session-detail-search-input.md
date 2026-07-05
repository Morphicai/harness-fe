---
"@harness-fe/console-ui": minor
---

feat(console-ui): keyword search box on the Session Detail timeline

#179 added a type filter to Session Detail's timeline but no way to search by content. Adds a debounced (300ms) search input above the type-filter chips, wired to the gateway's new `?q=` param — composes with the active type filter (AND semantics). Distinct from #178 (finding a *session* in the project list) — this searches *inside* one session's already-open timeline.
