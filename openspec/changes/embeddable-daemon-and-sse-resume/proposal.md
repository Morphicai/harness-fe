# Proposal: Embeddable Daemon + SSE Last-Event-ID Resumption

## Why

Today the MCP daemon assumes a developer running it as an independent
process on `localhost`. Two things follow from that:

1. To put Harnessa inside a real product (VISION direction 1 — morphicai-web
   hosting the daemon so end-user reports reach the agent), the host has
   to be able to `import` the daemon, mount it on its own HTTP server,
   inject its own auth, and write to its own storage. None of that is
   exposed today.
2. Once the daemon is reachable across a real network (CDN, proxy,
   mobile), SSE connections drop routinely. The MCP HTTP transport
   currently has no event replay, so any in-flight tool stream lost to
   a transient disconnect loses events with no way to recover. Agents
   silently desynchronise.

These two problems are coupled. Embedding the daemon is what makes
real-network operation a concern in the first place, and Last-Event-ID
resumption is what makes that operation reliable. Doing one without the
other ships a half-solution.

## What Changes

### Embeddable daemon

- Introduce a public `createDaemon(opts)` factory in
  `@harnessa-fe/mcp-server` that returns a handle exposing `start`,
  `stop`, and an HTTP middleware/handler form so the host app can:
  - bind the daemon to its own port, or mount it under a path on its
    own HTTP server
  - inject an authentication function evaluated on every inbound
    WS/HTTP connection
  - inject a custom `IStore` (database, object store) in place of the
    default JSONL-on-disk store
- Reshape `cli.ts` so the existing `npx @harnessa-fe/mcp-server`
  entrypoint is a thin wrapper around `createDaemon` with default
  config. CLI behaviour does not change.
- Tighten the `IStore` boundary in `store/types.ts` so it is the only
  surface a host needs to satisfy to plug in alternative persistence.

### SSE Last-Event-ID resumption

- Implement the MCP SDK's `EventStore` interface on top of our store
  layer so the `StreamableHTTPServerTransport` can replay events to a
  reconnecting client that supplies `Last-Event-ID`.
- Persist per-stream events with monotonic ids in a bounded ring (size
  and TTL configurable; defaults safe for in-memory).
- Provide both an in-memory ring implementation (default) and a JSONL
  one for hosts that want durability across daemon restarts.

## Goals

- Let a host application (initially morphicai-web) embed the daemon by
  importing a library, with no assumption of an external process.
- Make the MCP HTTP transport survive transient client disconnects
  without losing in-flight events.
- Keep the standalone CLI usage and developer-facing behaviour
  identical for users not embedding the daemon.

## Non-Goals

- Multi-tenant `projectId → agent` routing. That belongs to 1.2.x and
  builds on top of this change.
- A hosted multi-tenant SaaS form of the daemon.
- Changing the wire protocol or `PROTOCOL_VERSION`. This change is
  transport-and-packaging only.
- Replacing the default JSONL store. We add an interface; existing
  stores keep working unchanged.

## Initial Delivery Shape

Two PRs, in this order:

1. **SSE event replay** — implement `EventStore`, wire it into
   `mcpHttp.ts`, ship in-memory ring as default. Self-contained, no
   API surface change for consumers. **Status: implemented**
   (`store/MemoryEventStore.ts`, `mcpHttp.ts` wiring, 8 unit + 1
   wiring test, full suite green).
2. **`createDaemon` factory + `IStore` injection** — restructure the
   daemon bootstrap, expose the factory, route CLI through it. Larger
   structural change; lands after (1) so resume support is already
   present when hosts start embedding. **Status: not started.**

Each PR has its own spec delta under `specs/`.
