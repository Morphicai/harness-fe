# embed-express

Minimal example showing how a host Node.js process can embed
`@harnessa-fe/mcp-server` via `createDaemon` — no `npx`, no sidecar.

The host runs an Express app on `:3000` for its own routes, and the
harnessa-fe daemon on `:47729` for browser-runtime + MCP traffic, in
the **same Node process**. Auth is replaced with a custom predicate
that the host implements (here: a stub `Bearer` check).

Today the daemon owns its own listener — embedding *into* the host's
HTTP server is a planned follow-up (requires Bridge surgery for WS
upgrade handshake).

## Run

```bash
# from the mcp-server package root
pnpm build
node examples/embed-express/server.mjs
```

Then:

- `http://localhost:3000/health` — host app's own route
- `http://localhost:47729/__dashboard` — harnessa-fe dashboard
- `http://localhost:47729/mcp` — MCP HTTP endpoint (Bearer token: `let-me-in`)

Kill with Ctrl-C; both servers shut down together.
