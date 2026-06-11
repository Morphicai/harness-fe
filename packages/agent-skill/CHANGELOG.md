# @harness-fe/skill

## 4.0.0-next.13

### Patch Changes

- 56627bf: Correct and expand the SKILL.md playbook to match the real MCP tool surface:

  - Fix tool names to the actual underscore form (`project_list`, `session_summary`, `visitor_timeline`, …) instead of the dotted aliases.
  - Replace the non-existent `session.timeline` references with `session_tail` / `session_search` / `session_summary`.
  - Rewrite the selector docs: selectors are objects with `component` / `file`+`line` / `text` / `role` / `ariaLabel` / `css` / `nth` (the old `{ loc }` field never existed), and add a `data-testid` hooks-while-coding guide.
  - Document the previously-missing page tools (`page_wait_for`, `page_check`, `page_select`, `page_paste`, `page_upload`, `page_set_dialog_handler`) and identity tools (`project_sessions`, `build_get`, `dashboard_open`, `experimental_ping`).
  - Add a "proactively drive the browser to test a change" flow and a Troubleshooting section covering `page_*` failures and empty-result diagnosis.

## 0.7.0-next.0

### Minor Changes

- 25a6106: Task resolution back-link (4.0 · P7) — close the feedback loop from a reported
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

## 0.6.3

### Patch Changes

- 8ee05df: Surface install + MCP wire-up at the top of SKILL.md so the skill bootstraps
  an unconfigured project on first read. Add a Documentation section pointing
  agents to https://harness-fe.com/ (and `/zh/` for Simplified Chinese) for
  deep-dive lookups beyond what the skill covers.
