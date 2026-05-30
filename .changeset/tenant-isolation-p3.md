---
'@harness-fe/mcp-server': minor
---

Tenant read-isolation for MCP list tools (4.0 · P3) — agents now only see the
data they own, using the `createdBy` tags from P1 and the per-call principal
from P4.

- New `canSee(principal, createdBy)`: `local` (loopback / stdio solo) sees
  everything; unowned data (no `createdBy` — legacy rows) is visible to all;
  otherwise a record is visible only to the principal that created it.
- `project.sessions`, `session.list`, and `tasks.pending` filter their results
  through `canSee` using the per-call principal (`extra.requestInfo` headers).

Zero behaviour change for solo dev: loopback resolves to `local`, which sees
everything (verified — full suite green). Named-token isolation is exact in
today's single-token reality; the full `project → agent` binding for the
creator ≠ consumer case (once P6 splits write/read scopes) is deferred to P6.
Command-target scoping is also deferred (it needs the same ownership model).
