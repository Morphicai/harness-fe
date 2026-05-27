---
'@harness-fe/mcp-server': minor
---

**Optional experimental-tool gate.** The MCP server can register tools that are still in the testing phase via a new `registerExperimentalTools()` section in `mcp.ts`. By default these are **fully on** — a plain dev setup gets them with zero config (lowest mental burden). They only get restricted when the host opts in by naming an env var to gate on; the tools then show up only on machines where that var is set to a non-empty value.

**Why:** the common case (the developer who owns this daemon) shouldn't have to set anything to use in-flight tools. Gating is the exception — for when you want to ship the tools but expose them only in specific environments.

**Configuration:** the gate env-var *name* is supplied end-to-end — `createMcpServer(bridge, { experimentalEnvVar })`, `startMcpStdioServer`/`startMcpHttpServer`, `createDaemon({ experimentalEnvVar })`, and the CLI (`--experimental-env-var <name>` / `HARNESS_FE_EXPERIMENTAL_ENV_VAR`). Omit it for fully-on; supply it to restrict.

**Mechanism:** exported `experimentalEnabled(envVar?)` helper — returns `true` when no name is given, otherwise checks `process.env[name]` (presence semantics: any non-empty value enables). Ships with one probe tool, `experimental.ping`, as the canonical example; when a feature graduates, move its `registerTool` call into `registerTools`.
