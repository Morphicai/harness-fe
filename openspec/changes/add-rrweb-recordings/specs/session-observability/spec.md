# Session Observability

## Overview

Session observability covers the runtime signals Harnessa-FE captures from a live browser session and exposes to AI agents. This change makes rrweb recordings a first-class debugging artifact with compact timeline indexing, merged coverage intervals, marker alignment, and configurable retention.

### Requirement: Time-indexed recording coverage

Harnessa-FE SHALL index browser recording coverage in session history so an AI agent can determine which time windows have recordings without reading raw recording payloads.

#### Scenario: Discovering recording coverage for a session

- **WHEN** browser recordings are persisted for a tab
- **THEN** the system SHALL append compact recording coverage metadata to session history
- **AND** that metadata SHALL include a bounded time range that identifies when the recording chunk occurred

#### Scenario: Discovering merged coverage intervals

- **GIVEN** a session contains multiple overlapping or adjacent recording chunks
- **WHEN** an agent requests recording coverage for that session or tab
- **THEN** the system SHALL present merged intervals for the covered time windows
- **AND** the merged view SHALL still allow the agent to inspect the underlying chunks

### Requirement: Separate recording payload storage

Harnessa-FE SHALL store raw rrweb recording payloads separately from ordinary timeline events so historical timeline queries remain efficient.

#### Scenario: Persisting a recording chunk

- **WHEN** the runtime client sends an rrweb recording chunk
- **THEN** the MCP server SHALL persist the raw recording data through a recording-specific storage path
- **AND** the MCP server SHALL NOT write the full raw rrweb event payload into ordinary session or tab timeline entries

### Requirement: Bounded recording retrieval

Harnessa-FE SHALL let an AI agent retrieve recording data by bounded time window rather than only by whole-session export.

#### Scenario: Retrieving a bounded recording slice

- **WHEN** an agent requests recordings for a session and time range
- **THEN** the system SHALL return only recording chunks that overlap the requested window
- **AND** the response SHALL include enough metadata for the agent to align the returned recording data with the session timeline

### Requirement: Marker-aligned investigations

Harnessa-FE SHALL expose recording markers that help an AI agent navigate from important runtime events to the relevant recording window.

#### Scenario: Investigating a runtime error

- **WHEN** a runtime error, unhandled rejection, failed network event, or annotation task occurs during a recorded session
- **THEN** the system SHALL persist a marker aligned to the corresponding session timestamp
- **AND** the agent SHALL be able to query recordings around that marker

### Requirement: Configurable recording retention

Harnessa-FE SHALL support configurable recording retention so recording growth remains bounded in long-running development use.

#### Scenario: Pruning old or excessive recordings

- **WHEN** recording retention limits are exceeded for age, chunk count, or total storage
- **THEN** the system SHALL prune recording data according to configured policy
- **AND** the system SHALL preserve timeline consistency after pruning

#### Scenario: Preserving marked recordings when configured

- **GIVEN** retention is configured to preserve marked recording chunks when possible
- **WHEN** the system selects chunks for deletion
- **THEN** the system SHALL prefer deleting unmarked chunks before marked chunks unless stronger retention limits require otherwise
