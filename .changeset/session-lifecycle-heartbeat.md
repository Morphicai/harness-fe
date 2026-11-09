---
"@harness-fe/protocol": minor
"@harness-fe/core": minor
"@harness-fe/runtime": minor
"@harness-fe/node-runtime": minor
"@harness-fe/gateway": patch
"@harness-fe/console-ui": patch
---

fix(core): stop session flapping on ws blips; feat(protocol,runtime,node-runtime): application-level heartbeat

Session lifecycle: a runtime-client ws drop now defers `closeSession`/`closeTab` behind a 30s grace window (the client's auto-reconnect usually wins), a reconnect hello cancels the pending close, and a reconnect after close reopens the session (`endedAt`/`disconnectedAt` cleared via new `IStore.reopenSession`/`reopenTab`). `upsertSession` keeps `startedAt` write-once so reconnect re-upserts can no longer produce `startedAt > endedAt`. The deferred close re-checks live ownership at fire time (a stale close must not flip a session a reconnect or reload already owns) and `stop()` flushes pending closes instead of stranding sessions LIVE.

Heartbeat: long-lived peers send `ping` frames at the daemon's advertised cadence (`hello.ack.heartbeatMs`, 25s default) and force-close after two unanswered pings — half-open sockets (dead TCP, no close event) recover via the regular reconnect path instead of hanging forever. The daemon echoes `pong` and reaps heartbeat-capable peers silent past 90s with a hard `terminate()` (pre-heartbeat clients are never reaped — they fall back to close-event detection). `PeerSocket` gains an optional `terminate()`; the console ProjectList refetches on `session.update` so reopened sessions show LIVE without a manual refresh.

Note for `IStore` implementors: the interface adds `reopenSession`/`reopenTab`.
