---
"@harness-fe/core": patch
"@harness-fe/gateway": patch
---

fix(core): bound session.search match payload size

`limit` only capped the number of matches, not each match's size — a single console.log of a large object or a large network body could each exceed a tool-call's output limit on their own, forcing a write-to-file-then-read workaround. `session.search` gains `maxPayloadChars` (default 2000): a match whose `d` payload serializes past that cap is truncated with `dTruncated: true` stamped on it (harness-fe#199).
