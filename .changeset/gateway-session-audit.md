---
"@harness-fe/gateway": patch
---

fix(gateway): audit every request on established MCP sessions, not just initialize

The HTTP transport only wrote an audit entry for the `initialize` request; follow-up JSON-RPC calls on an established session (`tools/list`, `tools/call`, notifications) and the GET/DELETE verbs left no trace. Now each POST on an established session is parsed and audited per JSON-RPC message (batch bodies audit each element; `tools/call` records the invoked tool name), and GET (SSE stream) / DELETE (session close) are audited as `http:GET` / `http:DELETE` with the session's token identity.
