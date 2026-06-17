---
"@harness-fe/core": minor
---

Chunk-file session storage (#171) — replace the single per-session `timeline.jsonl` / `recording.jsonl` with rotating numbered chunk files and whole-file eviction.

Each stream now shards into `sessions/{id}/timeline/NNNNNN.jsonl` and `sessions/{id}/recording/NNNNNN.jsonl`, rotating before a write would exceed a per-file threshold (timeline 8 MB, recording 16 MB) — so no single file approaches V8's ~512 MB string cap that wedged reads and auto-purge (#166/#160). Reads (tail/search/summary/listRecordings/sliceRecordings/markers) stream across the ordered file list; a legacy single file is read transparently as the oldest chunk (no migration pass). Retention now evicts whole oldest files: recording keeps age/count/byte caps with baseline-aware + marker-preserving rescue at file granularity, and timeline gains real intra-session trimming (drop oldest files past `maxTimelineBytesPerSession`/`maxTimelineChunksPerSession`, default 64 MB / 24 files) — keeping recent events instead of the old "drop new events" cap. `session.purge` exposes the new timeline keys. Behaviour behind `IStore` is unchanged; gateway/console/replay untouched.
