---
"@harness-fe/sandbox": patch
"@harness-fe/protocol": patch
"@harness-fe/runtime": patch
"@harness-fe/gateway": patch
---

feat(sandbox): tee Server-Sent Events frames into network_tail/network_get

A `text/event-stream` response previously only surfaced `{status, durationMs}` — no visibility into individual SSE frames as they streamed in. The fetch interceptor now tees the body (`.clone()`, background read — the app's own consumption is untouched) when content-type matches, parses frames, and emits them as `phase: 'frame'` network entries (`sseEvent`/`sseData`/`sseId`) alongside the existing req/res entries for the same request id. Verified end-to-end against a real streaming endpoint in a real browser (harness-fe#204). XHR-based SSE is not covered (rare in practice).
