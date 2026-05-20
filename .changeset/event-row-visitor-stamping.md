---
"@harnessa-fe/mcp-server": patch
---

Fix: bridge now stamps `visitorId` on every event row

Pre-fix, `~/.harnessa/data/sessions/{sid}/timeline.jsonl` rows carried `projectId` and `buildId` but not `visitorId`, even though the bridge knew the visitor identity from the peer's hello frame. As a result, agents could read the visitor's metadata (firstSeenAt / sessionCount / tabIds) and could enumerate the visitor's sessions via `visitor.journey`, but couldn't filter a single session's timeline rows to events from one specific visitor — important when the same session has parent + iframe child apps with separate visitors.

The bridge now stamps `visitorId` from `frame.visitorId ?? peer.visitorId` on every `appendEvent` call. `StoreEvent.visitorId` is the new optional field.
