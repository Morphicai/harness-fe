---
'@harness-fe/protocol': minor
'@harness-fe/runtime': minor
'@harness-fe/sandbox': minor
'@harness-fe/gateway': minor
'@harness-fe/unplugin': minor
'@harness-fe/next': minor
---

New browser interaction commands, consent UI, overlay option, and full file upload pipeline.

**New MCP tools (all control-scoped)**
- `page.upload` — inject files into `<input type="file">` via DataTransfer; files provided as base64 by the agent
- `page.select` — set `<select>` value and fire change/input events
- `page.check` — set checkbox/radio `.checked` and fire change/input events
- `page.paste` — dispatch ClipboardEvent with synthetic clipboard data (fire-and-forget, no dialog)
- `page.set_dialog_handler` — pre-register return values for agent-triggered `alert`/`confirm`/`prompt` (read-scope)

**Consent UI (runtime-only, modern design)**
- New plugin option `consent?: 'off' | 'session' | 'always'` on `harnessFE()` / `<HarnessScript>`
- Plugin config takes priority over gateway `hello.ack`; gateway/CLI unchanged
- Permanent grant stored in `localStorage.__hfe_consent_grant__:<projectId>`; survives page refresh
- Rebuilt consent panel: blur backdrop + card UI, four buttons (始终允许 / 本次会话 / 仅此次 / 拒绝)
- Fixed: consent panel now shows `page.click(#submit-btn)` instead of `page.click([object Object])`

**Overlay hide option**
- New plugin option `overlay?: boolean` (default `true`) on `harnessFE()` / `<HarnessScript>`
- `overlay: false` hides the "H" floating icon; data capture is unaffected

**Sandbox: dialogs channel**
- New `dialogs` sandbox channel intercepts `alert` / `confirm` / `prompt` / `print` / `beforeunload`
- Only intercepts when agent is in progress (`__hfe_agent_in_progress__` flag); user calls pass through unchanged

**Sandbox: forms channel**
- New `forms` sandbox channel covers the full file upload pipeline to backend:
  - `HTMLInputElement.prototype.click` (file inputs): suppresses native picker when agent-triggered
  - `window.FormData` constructor: injects `__hfe_injected_files__` so `new FormData(form)` + fetch sends real files
  - `HTMLFormElement.prototype.submit`: converts to fetch when agent has injected files; fallback to native on error
- `page.upload` sets `__hfe_injected_files__` on the input element (auto-cleared after 60s)
