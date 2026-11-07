---
'@harness-fe/core': patch
'@harness-fe/cli': patch
---

**harden `maxTotalBytes` enforcement: fault isolation, tests, `--max-storage-bytes` flag**

- Purge passes (age, count, and the total-size cap `maxTotalBytes` / `HARNESS_MAX_STORAGE_BYTES`) now share per-session fault isolation: an unreadable or pathological session is skipped and logged instead of aborting the whole purge run, and size measurement tolerates unreadable entries (surfaced with a lossy-measurement log instead of failing silently). Eviction stays oldest-first and keeps the newest data.
- A failed session eviction removes `meta.json` last, so the session stays discoverable and is retried on a later purge run — no invisible disk occupancy.
- Implement the `--max-storage-bytes <bytes>` CLI flag (previously documented but missing) — maps to `policy.maxTotalBytes`, the same chain as `HARNESS_MAX_STORAGE_BYTES`; the flag overrides the env var. `0` disables the cap.
- An invalid `HARNESS_MAX_STORAGE_BYTES` (e.g. `abc`) now warns and keeps the default 1 GiB cap instead of silently disabling it.
- Test coverage for total-size eviction: oldest-first eviction, exactly-at-cap no-op, interplay with `maxAgeDays`/`maxSessions`, a single huge session without over-eviction, unreadable-session skip across passes, failed-eviction retry, and env/flag validation.
