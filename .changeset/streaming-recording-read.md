---
"@harness-fe/core": patch
---

Fix `Cannot create a string longer than 0x1fffffe8 characters` when reading large session recordings (#166).

`listRecordings` / `sliceRecordings` / `pruneRecordingFile` read `recording.jsonl` whole-file via `readFileSync(_, 'utf-8')`, which throws once the file passes V8's ~512 MB string cap — leaving the session unreadable, unreplayable, and impossible to purge. They now stream the file line-by-line (fixed buffer + StringDecoder), so peak memory is one buffer + one line. Pruning also drops parsed events after computing the FullSnapshot flag to avoid OOM on huge files. Added a 384 MB append-time ceiling on a single session's recording so it can never reach the V8 cap again.
