# Tasks: Add rrweb Recordings

## Phase 1: Core protocol and persistence

- [x] 1. Add rrweb recording to the runtime client and flush buffered events as chunks with `chunkId`, `startTs`, `endTs`, and `eventCount`.
- [ ] 2. Extend protocol validation for rrweb chunk payloads and marker payloads.
- [x] 3. Update the bridge so `event.name === "rrweb"` does not flow through generic timeline append logic.
- [x] 4. Persist raw rrweb chunk payloads through the recording storage path and append only compact chunk metadata to the timeline.
- [x] 5. Add tests proving rrweb chunks are stored outside ordinary timeline payloads.

## Phase 2: Indexing and retrieval

- [x] 6. Add recording coverage aggregation support in the store layer for chunk coverage and markers.
- [x] 7. Add MCP tools for `session.recordings.list`, `session.recordings.around`, and `session.recordings.slice`.
- [x] 8. Add tests proving an agent can find recording coverage around a specific timestamp and retrieve only overlapping chunks.

## Phase 3: Markers and retention

- [x] 9. Add derived markers for errors, unhandled rejections, failed network activity, and annotation tasks.
- [x] 10. Add configurable retention for recordings with age and size ceilings.
- [ ] 11. Add tests for pruning old chunks while preserving timeline integrity and marker consistency.

## Phase 4: Replay ergonomics

- [ ] 12. Add a replay-oriented export or viewer handoff path for bounded recording slices.
- [ ] 13. Add end-to-end verification against the example app covering recording capture, marker generation, slice retrieval, and replay handoff.
