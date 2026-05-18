# Session Observability

## Overview

This change extends session observability with a **load** scope: a refresh-bounded slice of a tab's lifetime. Every observability artifact — events, network records, recordings — is now anchored to a load, and the initial state of each load is captured as a first-class snapshot. The fetch and XHR capture paths additionally record bodies and headers, including streaming responses, so AI-conversation traffic is fully inspectable.

### Requirement: Load identity per page navigation

Harnessa-FE SHALL identify each page load with a stable `loadId` that is regenerated on every refresh and never shared with another load.

#### Scenario: Refresh produces a new load

- **WHEN** a tab is refreshed
- **THEN** the runtime client SHALL generate a new `loadId` distinct from the previous load's id
- **AND** the new `loadId` SHALL NOT be derived from or persist any data of the previous load

#### Scenario: WebSocket reconnection preserves load

- **WHEN** the runtime client reconnects to the MCP server within the same page load
- **THEN** the same `loadId` SHALL be reused across the reconnect

### Requirement: Initial snapshot per load

Harnessa-FE SHALL capture the browser's bootstrap state at the start of each load so an AI agent can compare entry conditions across loads.

#### Scenario: Capturing storage at load start

- **WHEN** a runtime client completes its handshake with the MCP server
- **THEN** it SHALL emit a single `PAGE_LOAD` event before any other capture event
- **AND** the event SHALL include `localStorage`, `sessionStorage`, and `document.cookie` contents at that moment
- **AND** values exceeding 32 KB SHALL be truncated with a flag indicating truncation occurred
- **AND** the snapshot SHALL also include page url, title, referrer, viewport dimensions, and user agent

#### Scenario: Subsequent loads recapture initial state

- **GIVEN** a tab has already produced one load snapshot
- **WHEN** the same tab is refreshed
- **THEN** a fresh snapshot SHALL be emitted for the new load, independent of the previous one

### Requirement: Load-scoped event persistence

Harnessa-FE SHALL persist every observability event with the `loadId` of the load it occurred in so timeline reads can be scoped to a single load.

#### Scenario: Filtering the timeline by load

- **WHEN** an agent requests the timeline for a tab with a specific `loadId`
- **THEN** the system SHALL return only events whose recorded load matches that id
- **AND** the response SHALL NOT include events from prior or subsequent loads

#### Scenario: Listing loads for a tab

- **WHEN** an agent asks which loads exist for a tab
- **THEN** the system SHALL return an ordered list of loads with start time, end time when known, and initial snapshot summary

### Requirement: Network request and response body capture

Harnessa-FE SHALL capture request and response bodies for fetch and XMLHttpRequest interactions, including streaming responses, so AI-conversation traffic can be inspected end-to-end.

#### Scenario: Capturing a JSON request and response

- **WHEN** business code issues `fetch(url, { method: 'POST', body: JSON.stringify(payload) })`
- **THEN** the system SHALL persist the request body and response body alongside the existing url / method / status / duration metadata
- **AND** the response Promise returned to business code SHALL be the original Promise from the underlying fetch
- **AND** reading the response body in business code SHALL succeed as if no capture had occurred

#### Scenario: Capturing a streaming SSE response

- **WHEN** business code consumes an SSE response
- **THEN** the system SHALL emit a request event eagerly so the request is visible before the stream ends
- **AND** the system SHALL accumulate response data with a documented cap
- **AND** when the cap is reached the system SHALL mark the body as truncated and cancel its internal stream copy

#### Scenario: Redacting sensitive headers

- **WHEN** a request includes headers matching `Authorization`, `Cookie`, `x-api-key`, or `x-auth-*`
- **THEN** the persisted record SHALL replace those header values with a redaction placeholder that preserves the original length

### Requirement: Storage mutation capture

Harnessa-FE SHALL capture mutations to `localStorage`, `sessionStorage`, and cookies so an AI agent can trace how page state evolves within and across tabs.

#### Scenario: Same-tab storage write

- **WHEN** business code calls `localStorage.setItem`, `sessionStorage.setItem`, or the corresponding `removeItem` / `clear`
- **THEN** the system SHALL emit a storage event identifying the operation, the storage area, the key, and the new value when applicable

#### Scenario: Cross-tab storage write

- **WHEN** another tab writes to storage observable by the current tab via the native `storage` event
- **THEN** the system SHALL emit the same event shape as a same-tab mutation, distinguishing the cross-tab origin

#### Scenario: Cookie change

- **WHEN** a non-HttpOnly cookie is added, modified, or removed for the current page
- **THEN** the system SHALL emit a storage event with `which: 'cookie'` identifying the key and new value
- **AND** the capture SHALL prefer `CookieStore` change notifications when available, and fall back to bounded polling otherwise

### Requirement: Capture must not alter business behavior

Harnessa-FE SHALL implement runtime capture so that no business-observable behavior changes when capture is active.

#### Scenario: Identity-preserving fetch patch

- **WHEN** business code reads `window.fetch.name`, `window.fetch.length`, or `window.fetch.toString()`
- **THEN** those values SHALL match the native function's values

#### Scenario: Prototype-preserving XHR patch

- **WHEN** business code constructs `new XMLHttpRequest()`
- **THEN** `xhr instanceof XMLHttpRequest` SHALL be true
- **AND** standard event listeners SHALL fire in their native order

#### Scenario: Errors inside capture do not surface to business

- **WHEN** the capture layer encounters an error while recording, serializing, or transporting an event
- **THEN** the business call site SHALL NOT observe a thrown exception or rejected Promise caused by capture
- **AND** the original request, response, or storage operation SHALL complete with its native result

#### Scenario: Internal capture traffic is not recaptured

- **WHEN** the runtime client itself issues a network request as part of capture transport
- **THEN** that request SHALL NOT appear in the captured event stream

### Requirement: Load lifecycle in the store

Harnessa-FE SHALL persist a load index per tab so the store knows the time window of every load without scanning the timeline.

#### Scenario: New load begins

- **WHEN** the bridge receives a `PAGE_LOAD` event
- **THEN** the store SHALL append a load record to the per-tab load index with start time set to the event timestamp

#### Scenario: New load ends the previous one

- **GIVEN** the per-tab load index already contains a load with no recorded end time
- **WHEN** a subsequent `PAGE_LOAD` arrives
- **THEN** the store SHALL set the previous load's end time to the new load's start time

#### Scenario: Tab closure ends the current load

- **WHEN** a tab disconnects from the bridge
- **THEN** the store SHALL set the end time of the tab's most recent load to the disconnection timestamp

### Requirement: Recording slices respect load boundaries

Harnessa-FE SHALL let an AI agent retrieve recording chunks for a specific load without specifying timestamps explicitly.

#### Scenario: Recording slice by load

- **WHEN** an agent requests recordings for a tab and a `loadId`
- **THEN** the system SHALL return only recording chunks whose time window overlaps the load's start-to-end interval
- **AND** the response SHALL be equivalent to requesting `[startedAt, endedAt]` directly
