# Design: Add rrweb Recordings

## Overview

The rrweb feature adds a second observability plane beside the existing JSONL event timeline.

- The timeline remains the fast, queryable index for logs, network, errors, commands, and recording metadata.
- Recording files hold raw rrweb event chunks.
- Agent workflows begin with timeline search and only fetch recording data for a bounded window when needed.

This preserves the strengths of the current persistence model while making browser playback possible.

## Design Goals

1. Keep rrweb payloads out of normal timeline files.
2. Make recording coverage discoverable from the timeline.
3. Retrieve recordings by bounded time windows, not by whole-session dumps.
4. Make retention configurable to avoid unbounded disk growth.
5. Preserve a simple local-filesystem implementation that matches the existing store model.

## Recording Strategy

### Runtime behavior

The runtime client initializes `rrweb.record()` when the page bridge starts. Events are buffered in memory and flushed as chunks.

Recommended first-pass chunking policy:

- flush every 5 seconds, or
- flush when buffered event count exceeds a fixed threshold, whichever comes first

Each flushed chunk contains:

- `chunkId`
- `tabId`
- `startTs`
- `endTs`
- `eventCount`
- `events`

The runtime client also emits marker events for important investigation anchors such as:

- `console.error`
- uncaught errors
- unhandled promise rejections
- failed network requests
- user annotation submissions

The initial implementation can emit markers from the MCP server as it already sees those signals, rather than requiring all markers to originate in rrweb itself.

## Persistence Model

### Timeline as index

The session and tab `timeline.jsonl` files continue to store lightweight events. rrweb metadata is added there in compact form so agents can discover coverage without reading raw recording payloads.

Recommended timeline event types:

- `rrweb:chunk`
- `rrweb:marker`
- `rrweb:start`
- `rrweb:stop`

Example `rrweb:chunk` event payload:

```json
{
  "chunkId": "rrc_000012",
  "tabId": "tab-1",
  "startTs": 1710000000000,
  "endTs": 1710000005000,
  "eventCount": 148,
  "bytes": 93210
}
```

Example `rrweb:marker` event payload:

```json
{
  "markerId": "rrm_000031",
  "kind": "error",
  "ts": 1710000002333,
  "label": "Unhandled TypeError",
  "relatedEventType": "err"
}
```

### Recording storage

Raw rrweb payloads are stored in a tab-scoped `recording.jsonl` file.

Each line contains one rrweb chunk object:

```json
{
  "chunkId": "rrc_000012",
  "startTs": 1710000000000,
  "endTs": 1710000005000,
  "eventCount": 148,
  "events": []
}
```

Query-time coverage is derived by scanning the chunk file and "melting" overlapping or adjacent chunks into merged intervals. This keeps the storage model simple while still giving the agent a compact view of what coverage exists.

## Agent Query Model

Agent access should be layered.

### Layer 1: coverage discovery

The agent first identifies whether recordings exist for the relevant window.

Recommended MCP tools:

- `session.recordings.list`
  - list chunks and markers for a session or tab
- `session.recordings.around`
  - given `ts`, return the chunks, merged intervals, and markers that overlap a bounded window

### Layer 2: bounded retrieval

The agent then retrieves only the needed slice.

Recommended MCP tool:

- `session.recordings.slice`
  - inputs: `sessionId`, optional `tabId`, `since`, `until`
  - returns the chunk metadata, merged intervals, and rrweb events overlapping that window

### Layer 3: replay handoff

For humans or richer tools, the system can later expose replay artifacts.

Future MCP tools:

- `session.recordings.replay`
- `session.recordings.export`

These are deferred from the first implementation slice.

## Marker Strategy

Markers connect timeline events to recordings.

Initial marker sources:

- JS errors
- unhandled rejections
- network failures
- annotation tasks
- optional agent-issued markers for debugging checkpoints

Markers should always include:

- `markerId`
- `kind`
- `ts`
- `tabId`
- a short label
- optional related event reference

This lets the agent ask questions like:

- show recordings around the last error
- show recordings around the failed `POST /api/save`
- show recordings around the user annotation task

## Retention Strategy

Retention must be configurable and recording-aware.

Recommended configuration fields:

- `enabled`: boolean
- `maxAgeDays`: number
- `maxChunksPerTab`: number
- `maxBytesPerTab`: number
- `preserveMarkedChunks`: boolean

Recommended defaults for development:

- enabled: true
- maxAgeDays: 3
- maxChunksPerTab: 500
- maxBytesPerTab: 250 MB
- preserveMarkedChunks: true

Retention rules:

1. delete oldest unmarked chunks first
2. preserve marked chunks until age or byte ceilings force deletion
3. keep timeline marker metadata consistent when chunks are removed
4. expose retention settings through MCP or server config rather than hardcoding them

## Protocol Considerations

The runtime client sends rrweb chunks as normal event frames, but the bridge treats them specially.

Recommended event name:

- `rrweb`

Recommended event payload:

```json
{
  "chunkId": "rrc_000012",
  "startTs": 1710000000000,
  "endTs": 1710000005000,
  "eventCount": 148,
  "events": []
}
```

Recommended bridge behavior:

1. validate the rrweb payload
2. persist raw chunk data with the recording store path
3. append only compact metadata to the timeline
4. emit derived markers when needed

This is the critical correction to the current code path, where all events are appended uniformly and rrweb would otherwise pollute timeline storage.

## Migration and Compatibility

This feature targets the new chunk format directly. There is no migration path planned for older recording encodings.

Current implementation shape:

1. runtime client emits rrweb chunks
2. bridge persists raw chunks to `recording.jsonl`
3. query tools derive merged intervals at read time
4. marker-aware retention trims chunks without introducing a secondary index file

## Risks

### Disk growth

rrweb data is large relative to console and network metadata. Retention and chunking are mandatory, not optional.

### Retrieval volume

Agents cannot consume full-session rrweb payloads efficiently. Bounded time-window access is the core design constraint.

### Replay fidelity

The first implementation slice should focus on raw event retrieval and consistent timestamps. Rich replay UX can follow after the protocol is stable.
