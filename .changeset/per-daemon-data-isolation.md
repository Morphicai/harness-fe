---
'@harnessa-fe/mcp-server': patch
---

Per-daemon data isolation: daemons now store their data under a
port-keyed subdirectory (`~/.harnessa/daemons/<port>/data/`) instead
of the single global `~/.harnessa/data/`.

The model: **daemon identity = listening port**. Same port = same
daemon = same data. Different port = independent daemons with
independent data. Users opt into isolation by setting a different
`--port` (or `HARNESSA_FE_PORT`) in their `mcp.json`; the default
remains 47729 and multiple IDEs / agents targeting it automatically
pool through the existing leader/follower mechanism — no extra
config needed.

Also adds an optional cosmetic `HARNESSA_FE_LABEL` env var that
surfaces in the startup banner (and, later, the dashboard title).
Has no effect on data isolation — picking a port is the only knob.

The startup banner now also prints the resolved data directory on
leader runs.

See [docs/multi-daemon.md](./docs/multi-daemon.md) for usage patterns.

No migration of existing `~/.harnessa/data/` is performed.
