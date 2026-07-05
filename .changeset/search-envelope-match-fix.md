---
"@harness-fe/core": patch
---

fix(core): JsonlStore.search() no longer matches on session-constant envelope fields

`search()` matched a keyword against the whole raw JSONL line — including `projectId`/`buildId`/`tab`/`visitorId`, which are identical across every event in a session. Searching a substring of the project name (e.g. `"react"` for a project called `react-demo`) matched every single event in the session regardless of content, making search useless for exactly the case it exists for. The raw-line check remains as a cheap pre-filter (valid: if the whole line doesn't contain the query, the event's own content can't either), but a match now additionally requires the query to appear in the event's own `type` + payload (`d`). This is shared with the `session.search` MCP tool agents already use — they get the same accuracy fix.
