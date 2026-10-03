# Harness-FE architecture

Source review: 2026-10-03. Package identities and exports come from this workspace's manifests, not historical package names.

## Current layers



| Responsibility | Current workspace source |
| --- | --- |
| Launch, shared gateway, stdio proxy | packages/cli, @harness-fe/cli |
| HTTP/MCP/WS front door, policies, token/admin/audit and console serving | packages/gateway, @harness-fe/gateway |
| Transport-independent capability/bridge, caller context, identity/visibility, session routing and stores | packages/core, @harness-fe/core |
| Shared command/message contracts | packages/protocol |
| Browser and Node instrumentation | packages/runtime-client, node-runtime, log, react-jsx |
| Build transforms | packages/unplugin, vite-plugin, webpack-plugin, next |
| Human console | packages/console-ui, @harness-fe/console-ui |

@harness-fe/core is a library: it does not own an HTTP/WS server. The gateway drives CoreClient and owns the front door. The CLI launches them together or proxies to a shared gateway. Do not describe absent daemon/dev-cli/mcp-server directories as the current package layout.

## Launch and identity boundaries

The current CLI exposes harness, harness serve, harness mcp and the governed mode. Solo stdio, a shared Open gateway and a governed HTTP gateway have different callers and authorization; an endpoint URL alone is not a user/project permission contract. Current code is in packages/cli/src/cli.ts, packages/gateway/src and packages/core/src/identity.ts/capability.

The gateway serves /ws, /mcp and /console. The console does not create a second product store; data/recording behavior belongs to the core stores and gateway governance to its own store.

## Storage is explicit

CLI defaults are ~/.harness-fe/core and ~/.harness-fe/gateway. --core-data-dir and --data-dir select them separately. A direct Bridge/JsonlStore constructor has its own fallback, so don't generalize that to the CLI or infer port-derived directories. See [multiple instances](../integrations/multi-daemon.md).

Current store paths, retention, replay and peer messages come from the source contracts/tests. This overview intentionally does not duplicate the protocol enum or a release-version table.

## Changing the system

Preserve caller/project scope through gateway and core, use protocol messages across the browser/Node boundary, and verify source-level plus real-browser behavior for a runtime change. Documentation edits must preserve local targets and site routes.

[Legacy architecture evidence](https://github.com/Morphicai/harness-fe/blob/main/docs/archive/architecture/legacy-architecture-through-4x.md) retains the former diagrams and detailed chronology; its package list and defaults are historical, not deployment instructions.
