# Session Observability

## Overview

Session observability covers the runtime signals that Harness-FE captures from a live browser session and exposes to AI agents. This includes console output, errors, network activity, persistent timelines, and session-scoped recordings.

### Requirement: Runtime event capture

Harness-FE SHALL capture runtime browser signals from an instrumented page and make recent entries available to an AI agent during the active session.

#### Scenario: Reading recent console, error, and network activity

- **WHEN** the runtime client is connected to the MCP server
- **THEN** the system SHALL capture browser console entries, JavaScript errors, and network activity from the page
- **AND** the agent SHALL be able to request recent captured entries from the active tab

### Requirement: Persistent session history

Harness-FE SHALL persist session history owned by the MCP server so an AI agent can inspect historical runtime behavior after the page refreshes or the connection closes.

#### Scenario: Querying historical activity

- **WHEN** runtime events are captured for a project session
- **THEN** the MCP server SHALL persist those events in session-scoped storage
- **AND** the agent SHALL be able to query session history by session identifier and optional tab identifier

### Requirement: Recording-aware investigations

Harness-FE SHALL support session investigations that combine timeline events with browser recordings when recordings exist for the requested time window.

#### Scenario: Investigating a failure with recordings

- **GIVEN** a session contains persistent timeline events and browser recordings
- **WHEN** an agent investigates an error, failed request, or user-reported issue
- **THEN** the system SHALL allow the agent to locate relevant recording coverage using timeline-aligned metadata
- **AND** the system SHALL allow the agent to request the corresponding recording data for a bounded time window

#### Scenario: Reading merged coverage intervals

- **WHEN** the agent requests recording coverage for a session or tab
- **THEN** the system SHALL present coverage in merged intervals where overlapping or adjacent chunks are treated as one continuous window
- **AND** the merged view SHALL still allow the agent to drill down into the underlying chunks when needed

### Requirement: Separate recording payload storage

Harness-FE SHALL store raw rrweb recording payloads separately from ordinary timeline events so historical timeline queries remain efficient.

#### Scenario: Persisting a recording chunk

- **WHEN** the runtime client sends an rrweb recording chunk
- **THEN** the MCP server SHALL persist the raw recording data through a recording-specific storage path
- **AND** the MCP server SHALL NOT write the full raw rrweb event payload into ordinary session or tab timeline entries

### Requirement: Bounded recording retrieval

Harness-FE SHALL let an AI agent retrieve recording data by bounded time window rather than only by whole-session export.

#### Scenario: Retrieving a bounded recording slice

- **WHEN** an agent requests recordings for a session and time range
- **THEN** the system SHALL return only recording chunks that overlap the requested window
- **AND** the response SHALL include enough metadata for the agent to align the returned recording data with the session timeline

### Requirement: Marker-aligned investigations

Harness-FE SHALL expose recording markers that help an AI agent navigate from important runtime events to the relevant recording window.

#### Scenario: Investigating a runtime error

- **WHEN** a runtime error, unhandled rejection, failed network event, or annotation task occurs during a recorded session
- **THEN** the system SHALL persist a marker aligned to the corresponding session timestamp
- **AND** the agent SHALL be able to query recordings around that marker

### Requirement: Configurable recording retention

Harness-FE SHALL support configurable recording retention so recording growth remains bounded in long-running development use.

#### Scenario: Pruning old or excessive recordings

- **WHEN** recording retention limits are exceeded for age, chunk count, or total storage
- **THEN** the system SHALL prune recording data according to configured policy
- **AND** the system SHALL preserve timeline consistency after pruning

#### Scenario: Preserving marked recordings when configured

- **GIVEN** retention is configured to preserve marked recording chunks when possible
- **WHEN** the system selects chunks for deletion
- **THEN** the system SHALL prefer deleting unmarked chunks before marked chunks unless stronger retention limits require otherwise

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

#### Scenario: Running the daemon in a host process

- **GIVEN** a host application that wants to ship the daemon as part of its own runtime
- **WHEN** the host calls the public daemon factory with its desired port, host, and lifecycle options
- **THEN** the system SHALL boot the WS bridge and (optionally) the MCP HTTP transport inside the host's process
- **AND** the system SHALL expose a handle that lets the host stop the daemon cleanly. (Mounting onto a host-owned `http.Server` is out of scope for the v1 surface — the daemon owns its own listener.)

#### Scenario: Injecting auth

- **GIVEN** a host application that provides an `authorize` predicate as part of the daemon configuration
- **WHEN** any HTTP or WebSocket request reaches the daemon
- **THEN** the system SHALL invoke the host's `authorize` predicate before serving the request
- **AND** the system SHALL reject the request when the predicate returns `false`

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
