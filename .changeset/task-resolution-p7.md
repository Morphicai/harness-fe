---
'@harness-fe/protocol': minor
'@harness-fe/core': minor
'@harness-fe/gateway': minor
'@harness-fe/skill': minor
---

Task resolution back-link (4.0 · P7) — close the feedback loop from a reported
problem to its fix and the re-test that proved it.

- `Task` gains an optional `resolution` object: `{ type, commit, prUrl,
  verificationSessionId, verifiedAt }` (`TaskResolution` / `TaskResolutionType`
  exported from protocol). `type` is one of `code-fix` / `config` / `wontfix` /
  `duplicate` / `cannot-reproduce`.
- `tasks.resolve` accepts a `resolution` arg (after `note`). The daemon defaults
  `verifiedAt` to now when a `verificationSessionId` is supplied without one, and
  records the resolution in the persisted task event. Plain
  `tasks.resolve(id, note)` stays valid — fully backward compatible.
- `bridge.resolveTask(id, note?, resolution?, principal?)` and the RemoteBridge
  RPC carry the resolution through leader/follower.
- `@harness-fe/skill` Flow 5 is extended into the full loop: fix → re-drive the
  reported flow (replay to recall the steps, reproduce with `page_*`) → verify
  clean (`errors_tail` / `session_tail`) → `tasks.resolve` with the structured
  resolution.

Scope: the daemon owns the data link (report → fix → verification session);
the L1–L4 automation and git writeback remain agent/skill responsibilities,
driven through harness tools + host git. Additive + optional throughout — no
behaviour change for existing callers.
