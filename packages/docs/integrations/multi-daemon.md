# Multiple Harness instances

Different ports select different listening endpoints. They do not automatically guarantee different storage or authorization. Configure endpoints, core stores and gateway stores separately.

## Current CLI

packages/cli/src/cli.ts supports --port, --core-data-dir and --data-dir. The current defaults are ~/.harness-fe/core and ~/.harness-fe/gateway; they are not derived from the port. Select distinct data directories when running independent instances, and keep client configs pointed at the intended endpoint.

```bash
harness serve --port 47730 --core-data-dir /tmp/harness-instance-a/core --data-dir /tmp/harness-instance-a/gateway
```

This is an explicit development layout, not a migration or cleanup instruction. Existing stores should be backed up and kept intact; do not delete directories to fix identity/configuration errors.

## Scope and transport

harness serve is an Open shared gateway; governed HTTP operation has explicit token/scope/project policies. harness mcp reuses or starts a shared gateway and proxies stdio to its MCP endpoint. Pointing at the same port alone does not grant the same project rights to every caller.

Direct core/Bridge construction can choose different fallback paths from the CLI. Read the actual entry's configuration rather than applying CLI defaults to every embedding.

Architecture and console development are documented in [architecture](../guide/architecture.md) and [console inspection](../guide/self-debug.md). The old port-derived storage rule was retired after source review; its original source commit/hash remains recorded in this repository's simplification manifest.
