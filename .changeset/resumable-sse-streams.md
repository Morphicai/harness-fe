---
'@harnessa-fe/mcp-server': patch
---

MCP HTTP transport now resumes dropped SSE streams via
`Last-Event-ID`. A bounded in-memory `MemoryEventStore` (1000 events
/ 5 minutes / 50 MiB across all streams by default) is wired into
`StreamableHTTPServerTransport` so a client whose connection drops
mid-tool-stream can reconnect and receive the events it missed —
no duplicates, no gaps within the buffer window.

`startMcpHttpServer` accepts an optional `eventStore` argument:

- omit → default `MemoryEventStore` (recommended)
- pass a custom `EventStore` implementation → host-provided backing
  (e.g. Redis, durable file)
- pass `null` → resumability disabled

`EventStore`, `StreamId`, and `EventId` types are re-exported from
`@harnessa-fe/mcp-server` so consumers can implement custom backings
without depending on the MCP SDK directly. Required for embedding
the daemon inside a host application reachable over public networks
(VISION direction 1).
