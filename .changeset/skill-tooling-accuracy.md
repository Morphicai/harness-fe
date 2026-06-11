---
"@harness-fe/skill": patch
---

Correct and expand the SKILL.md playbook to match the real MCP tool surface:

- Fix tool names to the actual underscore form (`project_list`, `session_summary`, `visitor_timeline`, …) instead of the dotted aliases.
- Replace the non-existent `session.timeline` references with `session_tail` / `session_search` / `session_summary`.
- Rewrite the selector docs: selectors are objects with `component` / `file`+`line` / `text` / `role` / `ariaLabel` / `css` / `nth` (the old `{ loc }` field never existed), and add a `data-testid` hooks-while-coding guide.
- Document the previously-missing page tools (`page_wait_for`, `page_check`, `page_select`, `page_paste`, `page_upload`, `page_set_dialog_handler`) and identity tools (`project_sessions`, `build_get`, `dashboard_open`, `experimental_ping`).
- Add a "proactively drive the browser to test a change" flow and a Troubleshooting section covering `page_*` failures and empty-result diagnosis.
