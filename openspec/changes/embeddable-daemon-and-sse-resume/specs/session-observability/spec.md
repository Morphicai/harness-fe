# Session Observability

## Overview

This change extends `session-observability` along two transport-and-packaging axes: the MCP HTTP transport gains resumable streams via Last-Event-ID, and the daemon gains an embeddable library surface so host applications can run it in-process with their own storage and auth.

### Requirement: Resumable SSE event streams

Harness-FE SHALL allow an MCP client whose SSE connection drops to reconnect and receive the events it missed, identified by `Last-Event-ID`.

#### Scenario: Replaying events after a transient disconnect

- **GIVEN** an MCP client is consuming a server-streamed response over the HTTP transport
- **WHEN** the underlying connection drops and the client reconnects with a `Last-Event-ID` header naming the last event it received
- **THEN** the system SHALL replay every event with a higher id than `Last-Event-ID` before resuming the live stream
- **AND** the replayed sequence SHALL contain no duplicates and no gaps relative to what the client had already received

#### Scenario: Replay beyond the buffer window

- **GIVEN** a client reconnects with a `Last-Event-ID` older than the daemon's retained buffer
- **WHEN** the daemon cannot reconstruct the missing range
- **THEN** the system SHALL surface an explicit unrecoverable-stream signal to the client
- **AND** the system SHALL NOT silently start the stream at an arbitrary later event

#### Scenario: Bounded buffer growth

- **GIVEN** event-store retention is configured with event-count, age, and global byte ceilings
- **WHEN** stored events exceed any ceiling
- **THEN** the system SHALL evict the oldest events first
- **AND** retention behaviour SHALL be the same whether the event store is in-memory or persistent

### Requirement: Embeddable daemon surface

Harness-FE SHALL expose the MCP daemon as a library so a host application can run it in-process without spawning a separate command-line process.

#### Scenario: Mounting the daemon on a host HTTP server

- **GIVEN** a host application that already owns an HTTP server
- **WHEN** the host calls the public daemon factory with its own `httpServer` (or `mount` path)
- **THEN** the system SHALL attach the daemon's HTTP and WebSocket handlers to the host's server
- **AND** the system SHALL NOT bind a separate listener of its own

#### Scenario: Injecting auth

- **GIVEN** a host application that provides an auth function as part of the daemon configuration
- **WHEN** any HTTP or WebSocket request reaches the daemon
- **THEN** the system SHALL invoke the host's auth function before serving the request
- **AND** the system SHALL reject the request when the auth function returns a null context

#### Scenario: Injecting storage

- **GIVEN** a host application that provides a custom store implementing the published `IStore` interface
- **WHEN** the daemon persists session events, recordings, or tasks
- **THEN** the system SHALL write through the host-provided store
- **AND** the system SHALL NOT fall back to local filesystem storage for any persistence path that the injected store covers

#### Scenario: CLI parity

- **GIVEN** a developer who runs the daemon from its packaged command-line entry point
- **WHEN** the daemon starts with default flags
- **THEN** the system SHALL behave identically to the previous standalone process — same listening port, same default storage location, same auth model
- **AND** the CLI SHALL be implemented as a thin wrapper over the public daemon factory rather than a parallel bootstrap path
