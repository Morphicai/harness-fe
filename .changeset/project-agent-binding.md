---
'@harness-fe/mcp-server': minor
---

Project→agent binding + host/sub-app tagging (4.0 · A) — tenant isolation now
keys on project ownership (with host→sub-app routing) instead of per-row tags.

- New `canSeeProject(principal, ownerChain)`: visible when the caller owns the
  project itself **or any ancestor** (walked via `parentProjectId`) — a host
  agent sees its sub-apps' data, but a sub-app owner doesn't see up the tree.
  `local` sees all; unowned links stay visible (backward compat).
- `project.sessions` / `session.list` / `tasks.pending` filter by project
  ownership via `ownerChainOf(projectId, store)` — owning a project grants its
  whole session/task set, regardless of which runtime client created each row
  (fixes the creator≠consumer mismatch that per-row `createdBy` filtering had).

Zero behaviour change for solo dev (loopback → local → sees all; full suite
311 green). Tests: canSeeProject ownership + host-subtree (7).
