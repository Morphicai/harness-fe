---
'@harness-fe/core': patch
'@harness-fe/cli': patch
---

**harden `maxTotalBytes` enforcement: per-session fault isolation, tests, `--max-storage-bytes` flag**

- Total-size purge pass (`maxTotalBytes` / `HARNESS_MAX_STORAGE_BYTES`) now isolates each session like the recording pass: an unreadable or pathological session is skipped and logged instead of aborting the whole purge run, and size measurement tolerates unreadable entries. Eviction stays oldest-first after the age and count passes.
- Implement the `--max-storage-bytes <bytes>` CLI flag (previously documented but missing) — maps to `policy.maxTotalBytes`, the same chain as `HARNESS_MAX_STORAGE_BYTES`; the flag overrides the env var. `0` disables the cap.
- Add test coverage for total-size eviction: oldest-first eviction, exactly-at-cap no-op, interplay with `maxAgeDays`/`maxSessions`, a single huge session without over-eviction, and unreadable-session skip.
