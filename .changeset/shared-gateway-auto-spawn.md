---
"@harness-fe/cli": minor
"@harness-fe/gateway": minor
"@harness-fe/unplugin": minor
"@harness-fe/webpack": minor
"@harness-fe/console-ui": minor
---

Shared auto-spawn gateway + unified console sign-in.

- **cli**: `harness serve` (headless shared gateway) and `harness mcp` (stdio↔http proxy) subcommands; default-locate `@harness-fe/console-ui` dist so `/console` serves the real UI with no `--console-dir`.
- **ensureSharedGateway**: a dev server (vite/unplugin and native webpack) or the mcp launcher — whoever starts first — auto-spawns one shared Open gateway; the other end reuses it. Team (explicit token) never spawns.
- **gateway**: `startMcpStdioProxy`; removed the server-rendered `/admin` + `/admin/login` HTML pages — sign-in unified at `/console`.
- **console-ui**: sign-in takes effect without a hard reload; governance tab admin-only.
- **demo**: `demo.sh` reclaims a stale harness gateway instead of refusing to start.
