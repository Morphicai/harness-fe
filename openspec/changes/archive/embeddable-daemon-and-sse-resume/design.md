# Design: Embeddable Daemon + SSE Last-Event-ID Resumption

## Overview

Two coupled changes to `@harness-fe/mcp-server`:

1. Add Last-Event-ID replay to the MCP HTTP transport so SSE streams
   survive transient client disconnects.
2. Expose the daemon as a library — `createDaemon(opts)` — so a host
   application can mount it on its own HTTP server, inject its auth,
   and supply its own storage.

Both ship behind the existing public package; the standalone CLI
behaviour is preserved.

## Current contract

- Daemon is started by `packages/mcp-server/src/cli.ts`, which boots a
  `Bridge` (1.7k LoC, owns HTTP+WS servers, exposes
  `prependHttpHandler`) and then attaches the MCP HTTP transport via
  `startMcpHttpServer` in `mcpHttp.ts`.
- `mcpHttp.ts` delegates SSE to the MCP SDK's
  `StreamableHTTPServerTransport`. It does not pass an `eventStore`,
  so the SDK has no replay buffer and clients reconnecting with
  `Last-Event-ID` start from the live tail.
- Persistence is `IStore`-ish already: `store/types.ts` plus
  `JsonlStore`, `JsonMemoryStore`, `JsonTaskStore`. The interface is
  internal — not exported and not the surface a host could plug into.
- Auth is a single `--token` flag wired into the bridge's HTTP layer.
  No per-request injection hook; host applications can't reuse their
  own auth.

## Intended shape

### Event replay (PR 1)

- Implement the MCP SDK's `EventStore` interface
  (`store({ streamId, message }) -> eventId`,
  `replayEventsAfter(lastEventId, { send })`) backed by our store
  layer.
- Default implementation: `MemoryEventStore` — bounded ring per
  `streamId`, sized by event count and age (defaults: 1000 events /
  5 minutes; configurable via daemon options).
- Optional `JsonlEventStore` for hosts that want durability across
  daemon restarts. Defer to a follow-up if PR 1 is already large.
- Wire the event store through `startMcpHttpServer` →
  `new StreamableHTTPServerTransport({ ..., eventStore })`.
- No protocol version bump; this is a pure transport-quality fix.

### Embeddable daemon (PR 2)

- New `packages/mcp-server/src/daemon.ts` exports `createDaemon(opts)`.
- `DaemonOptions`:
  - `port?`, `host?` — used when the daemon owns its own listener
  - `httpServer?` — pre-existing `http.Server` to attach to (no
    self-`listen`)
  - `mount?` — base path when attaching to an existing server (default `/`)
  - `store?: IStore` — defaults to the JSONL store at `./data/`
  - `eventStore?: EventStore` — defaults to `MemoryEventStore`
  - `auth?: (req) => Promise<AuthContext | null>` — replaces the
    single-token check; `null` rejects the connection
  - `token?: string` — convenience shorthand for the current
    `--token` behaviour; mutually exclusive with `auth`
- `DaemonHandle`:
  - `start(): Promise<void>` — only when daemon owns its listener
  - `stop(): Promise<void>`
  - `middleware()` — returns `(req, res, next?) => void` for hosts
    that prefer Express-style mounting
  - `handle(req, res)` — Node-native handler form
- `cli.ts` becomes a ~50-line wrapper that maps CLI flags onto
  `DaemonOptions` and calls `createDaemon(...).start()`.
- `IStore` and `EventStore` interfaces are promoted from internal to
  public re-exports in `index.ts`. Both keep their current method
  shape; this change only widens visibility.

## Daemon identity in two modes

The repo's `feat/port-keyed-data-isolation` work establishes:
**CLI-mode daemon identity = listening port.** Same port = same data
dir = same daemon; different port = independent daemon. Default data
dir is `~/.harness/daemons/<port>/data/`.

This change leaves that model intact for CLI use and adds a second
identity model for embedded use:

- **CLI mode** (developer machine, `npx @harness-fe/mcp-server`):
  identity is the port. Caller does not supply a `store` and the
  daemon falls back to a port-keyed JSONL store at the default path.
- **Embedded mode** (host app imports `createDaemon`): identity is
  whatever the host's auth context and injected `store` scope
  establish (e.g. tenant id, workspace id). The host typically
  supplies a `store` and an `auth` function; the port-keyed default
  is bypassed entirely.

The two modes are orthogonal: the same `createDaemon` factory serves
both. `cli.ts` is the only place that resolves
`HARNESS_FE_DATA_DIR` / `HARNESS_FE_LABEL` / `defaultDataDir(port)` —
that logic stays in the CLI layer and is never injected into a host
app's context.

## Key decisions

- **Defer to MCP SDK for SSE plumbing.** The SDK already supports
  `eventStore`. Hand-rolling a Last-Event-ID parser would duplicate
  protocol logic. Our job is the buffer, not the wire.
- **Memory-first event store.** Most real disconnects happen inside a
  few seconds; a bounded in-memory ring is enough. Persistent
  `EventStore` is opt-in for hosts that care about daemon-restart
  survival.
- **`createDaemon` returns a handle, not a class.** Matches the
  existing `startMcpHttpServer` style (`McpHttpHandle`) and avoids
  exposing internal lifecycle methods.
- **Auth as a function, token as sugar.** Host apps need to plug their
  own auth (e.g. Supabase JWT). A function is the only honest shape;
  `token` stays for the CLI happy path.
- **CLI behaviour-identical.** Same flags, same logs, same default
  ports. Verified by an integration test that exercises the CLI
  binary against a smoke client.
- **No project→agent routing in this change.** Tempting to add a
  `projectId` field on `AuthContext` here, but routing belongs to
  1.2.x with its own threat model.

## What this enables next

- 1.2.x multi-tenant routing builds on `AuthContext` + injectable
  `IStore`.
- A morphicai-web prototype can land that mounts the daemon at
  `/internal/harness`, uses Supabase JWT for auth, and writes events
  to a workspace-scoped store.

## Implementation status

- **PR 1 — SSE Last-Event-ID resumption: implemented.**
  `MemoryEventStore` ships in `store/MemoryEventStore.ts` (per-stream
  ring with age, count, and global-byte eviction). `EventStore`
  types are re-exported from `store/types.ts`. `startMcpHttpServer`
  in `mcpHttp.ts` accepts an optional `eventStore` and defaults to
  `new MemoryEventStore()`; pass `null` to opt out of resumability.
  8 unit tests + 1 wiring test green; full suite 239/239 pass.
- **PR 2 — `createDaemon` factory: not started.** See tasks 8–15.

## Risks

- **Bridge entanglement.** `bridge.ts` is large (1773 lines) and
  currently owns HTTP+WS lifecycle. Extracting a clean
  `createDaemon` may surface hidden coupling (singleton bridge
  state, process-level side effects). Mitigation: build PR 2 on top of
  PR 1 so any breakage is isolated; keep the bridge's public surface
  unchanged in this change.
- **SDK version drift.** `eventStore` requires a sufficiently recent
  `@modelcontextprotocol/sdk`. Confirm the pinned version supports the
  interface before starting PR 1; if not, bump as a prerequisite.
- **Memory pressure under chatty streams.** A 1000-event ring per
  stream is safe for normal use but could grow if many concurrent
  streams open. Mitigation: a global byte cap across all streams, with
  oldest-stream eviction.
