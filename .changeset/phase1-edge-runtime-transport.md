---
"@harnessa-fe/protocol": minor
"@harnessa-fe/mcp-server": minor
"@harnessa-fe/node-runtime": minor
"@harnessa-fe/next": minor
---

feat: Edge Runtime HTTP transport (Phase 1)

- `@harnessa-fe/protocol`: add `httpBatchSchema` / `HttpBatch` for stateless POST /events
- `@harnessa-fe/mcp-server`: new `POST /events` + `GET /events/ping` HTTP endpoints; `Bridge.handleHttpBatch()` routes batches into the same session timeline as the WebSocket path
- `@harnessa-fe/node-runtime`: `Transport` interface + `WsTransport` (existing behaviour) + `HttpBatchTransport` (fetch-based, 500ms flush, 50-event batching, 5xx retry, outbox cap); automatic selection via `NEXT_RUNTIME=edge` / `HARNESSA_FE_TRANSPORT=http`; `ws` moved to optional peer dependency; new `./auto-edge` export
- `@harnessa-fe/next`: webpack plugin injects `@harnessa-fe/node-runtime/auto-edge` into edge-runtime bundles (webworker target)
