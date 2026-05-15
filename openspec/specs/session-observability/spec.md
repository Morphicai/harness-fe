# Session Observability

## Overview

Session observability covers the runtime signals that Harnessa-FE captures from a live browser session and exposes to AI agents. This includes console output, errors, network activity, persistent timelines, and session-scoped recordings.

### Requirement: Runtime event capture

Harnessa-FE SHALL capture runtime browser signals from an instrumented page and make recent entries available to an AI agent during the active session.

#### Scenario: Reading recent console, error, and network activity

- **WHEN** the runtime client is connected to the MCP server
- **THEN** the system SHALL capture browser console entries, JavaScript errors, and network activity from the page
- **AND** the agent SHALL be able to request recent captured entries from the active tab

### Requirement: Persistent session history

Harnessa-FE SHALL persist session history owned by the MCP server so an AI agent can inspect historical runtime behavior after the page refreshes or the connection closes.

#### Scenario: Querying historical activity

- **WHEN** runtime events are captured for a project session
- **THEN** the MCP server SHALL persist those events in session-scoped storage
- **AND** the agent SHALL be able to query session history by session identifier and optional tab identifier

### Requirement: Recording-aware investigations

Harnessa-FE SHALL support session investigations that combine timeline events with browser recordings when recordings exist for the requested time window.

#### Scenario: Investigating a failure with recordings

- **GIVEN** a session contains persistent timeline events and browser recordings
- **WHEN** an agent investigates an error, failed request, or user-reported issue
- **THEN** the system SHALL allow the agent to locate relevant recording coverage using timeline-aligned metadata
- **AND** the system SHALL allow the agent to request the corresponding recording data for a bounded time window

#### Scenario: Reading merged coverage intervals

- **WHEN** the agent requests recording coverage for a session or tab
- **THEN** the system SHALL present coverage in merged intervals where overlapping or adjacent chunks are treated as one continuous window
- **AND** the merged view SHALL still allow the agent to drill down into the underlying chunks when needed
