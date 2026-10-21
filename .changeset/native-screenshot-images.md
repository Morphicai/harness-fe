---
'@harness-fe/gateway': patch
'@harness-fe/cli': patch
'@harness-fe/skill': patch
---

Return `page.screenshot` pixels as native MCP image content so vision-capable agents can receive screenshots instead of base64 JSON text. Keep dimensions and `notCaptured` warnings in a separate text block without duplicating image bytes. Default MCP captures to PNG, preserve explicit WebP/JPEG requests, and report malformed image results as tool errors. Runtime WebSocket screenshot results retain their existing data URL shape.

Report the installed CLI version with `harness --version`, and expose the running gateway's package version in console metadata and MCP initialization so operators can distinguish an upgraded client from a reused older gateway.
