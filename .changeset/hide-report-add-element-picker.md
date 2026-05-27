---
"@harness-fe/runtime": patch
"@harness-fe/mcp-server": patch
---

feat: hide report entry; add element info picker for agents

- overlay: replace "Report a problem" button with "Copy element info" picker.
  Clicking enters picker mode; selecting any element copies a compact markdown
  block (component, source location, CSS path, session context) to the clipboard
  for pasting directly into an agent prompt.
- mcp-server: temporarily disable `tasks.pending`, `tasks.claim`,
  `tasks.resolve`, and `tasks.get_attachment` MCP tools.
