# @harness-fe/core

The transport-agnostic backend of Harness-FE.

`core` is a **pure library** — it has no HTTP server, no WebSocket server, and
binds no port. It exposes:

- **Capability API** — protocol-agnostic functions `(args, principal) => result`
  (`page.*`, `*.tail`, `replay`, `tasks`, `project`, `session`, `memory`). Each
  enforces `canSee` tenant isolation, browser `consent`, and **write-scope deny**
  internally, so every front door reuses one authorization model.
- **Bridge** — the WS-frame state machine (peer registry, command/response
  correlation, event persistence) decoupled from the socket implementation via
  the `PeerSocket` abstraction. The gateway terminates the runtime WebSocket and
  feeds the socket in through `bridge.acceptPeer(socket, principal)`.
- **Store / identity / consent** — JSONL session store, task store, memory store;
  the `Principal` model and `canSee` / `canSeeProject` / `projectGrant` visibility
  rules.
- **CoreClient** — the interface the gateway depends on. The in-process
  implementation wraps a `Bridge` directly; a remote (cross-machine) WS variant
  can implement the same interface without changing the gateway.

The gateway (`@harness-fe/gateway`) is the only thing that talks to core. Browsers,
agents, and humans all reach core **through** the gateway — never directly.
