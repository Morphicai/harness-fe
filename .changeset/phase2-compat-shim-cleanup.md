---
"@harnessa-fe/mcp-server": patch
---

chore: remove pre-1.0 read-compat shims (Phase 2)

**Breaking change for on-disk data older than v0.4:**

- Removed `LegacyBuildSessionMeta` and `LegacyLoadMeta` types
- Removed `TailOptions.loadId` and `SearchOptions.loadId` deprecated fields
- Removed `_detectLegacyLayout()` — replaced by per-chunk stderr warning when a recording chunk lacks `chunkId`
- Removed 8 `load: loadId` double-stamp fields from bridge event rows

If you have on-disk data from a daemon older than v0.4, run `rm -rf ~/.harnessa/data` to start fresh.
