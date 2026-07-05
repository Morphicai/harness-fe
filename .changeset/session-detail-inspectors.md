---
"@harness-fe/console-ui": minor
---

feat(console-ui): Session Detail data inspectors, event-type filter, and colored badges (#179)

Session Detail's timeline rendered every event type through one path — `JSON.stringify` truncated at 280 chars, no expand, no per-type structure. This adds:

- A dependency-free recursive `JsonTree` component (no JSON-tree/syntax-highlighter library exists in this package) with collapse/expand, depth guards, and an array-length cap with a "+N more" footer.
- A type multi-select filter chip row wired to the gateway's newly-passthrough `?type=` param (at least one type must stay selected).
- Per-type one-line summaries (`network`, `console`, `error`, `storage`, `ws`, `navigation`, `globals`, `indexeddb`) with a generic JSON-tree fallback for every other/future type.
- Click-to-expand rows: a dedicated request/response inspector for `network` events (separate Request/Response sections gated on `phase`, not correlated across the req/res pair — a deliberate scope cut), a console-args tree, and a cleaned error stack.
- `TagBadge`'s color map corrected to the real event-type strings (`network`/`console`/`error`/`storage`/`ws`/... — see the linked `@harness-fe/core` patch for why the old `log`/`err`/`net` keys never matched anything real) plus new colors for previously-uncolored types.
- New dependency on `@harness-fe/protocol` for the canonical `NetworkEntry`/`ConsoleEntry`/`ErrorEntry`/etc. types instead of hand-duplicating them.
