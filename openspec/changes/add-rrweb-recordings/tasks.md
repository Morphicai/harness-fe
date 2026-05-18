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
- [x] 11. Tests cover pruning by count/byte ceilings; new `recording prune leaves session timeline and markers intact` test asserts timeline + marker rows survive an rrweb chunk purge.

## Phase 4: Replay ergonomics

- [x] 12. Add a replay-oriented export + local viewer for bounded recording slices.
        - Bundled `rrweb-player` in `@morphixai/harnessa-fe.mcp-server`.
        - Bridge now serves HTTP and WS on the same port; `/replay/:id` returns a self-contained viewer page, `/replay/:id.json` returns raw events.
        - New MCP tool `session.replay.create` builds an export from `{ts, windowMs?}` or `{since, until}` and returns `viewerUrl`.
        - Available in both leader and follower modes (proxied via `storeReplayCreate` mcp.call method).
        - Per-project retention added (`maxExportsPerProject`, `maxExportBytesPerProject`).
- [x] 13. Verified end-to-end via vitest: rrweb chunks → `session.replay.create` → HTTP viewer + JSON routes return 200 with the bundled events; bundled rrweb-player JS/CSS served; retention-trimmed chunks are excluded from later exports.
