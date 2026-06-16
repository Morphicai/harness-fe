---
"@harness-fe/core": patch
---

Stream `timeline.jsonl` reads + cap its size (#166 timeline sibling).

4.1.1 fixed `recording.jsonl` but the event `timeline.jsonl` had the same flaw: `summary`, `search`, and `readMarkerTimestamps` read it whole-file via `readAllLines`. A chatty session can grow timeline.jsonl past V8's ~512 MB string cap (observed at 2.3 GB), which broke the console session-detail page AND — because `readMarkerTimestamps` runs inside purge for every session — aborted the entire auto-purge. Those three reads now stream line-by-line. Added a 384 MB per-session timeline ceiling at append time (in-memory byte counter, no per-event statSync), and isolated each session in the purge loop so one bad file can't wedge all retention.
