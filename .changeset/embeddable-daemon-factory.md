---
'@harnessa-fe/mcp-server': minor
---

Embeddable daemon: `@harnessa-fe/mcp-server` now exposes a
`createDaemon` factory so a host Node.js process can run the daemon
as a library — no `npx`, no sidecar.

```ts
import { createDaemon } from '@harnessa-fe/mcp-server';

const daemon = createDaemon({
  port: 47729,
  authorize: (req) => verifyJwt(req.headers.authorization),
  // store, taskStore, memoryStore, eventStore — all injectable
});

await daemon.start();
```

`AuthOptions` gains an `authorize?: (req) => boolean` predicate that
replaces the built-in token check on every HTTP request and WS
upgrade. The CLI now translates `--token foo` into one of these so
the daemon has exactly one auth pipeline — embedded hosts and the
CLI share the same code path. Sync because the WS upgrade
handshake completes inline; host apps with async auth (e.g. JWT
verification against a remote JWKS) should cache the decision in a
cookie via their own middleware.

Public surface additions: `createDaemon`, `DaemonOptions`,
`DaemonHandle`, `defaultDataDir`, `MemoryEventStore`,
`MemoryEventStoreOptions`, `EventStore` / `EventId` / `StreamId`,
`startMcpHttpServer`, plus the previously-internal `JsonTaskStore`
and `JsonMemoryStore` classes.

Scope of v1: the daemon owns its own HTTP listener. Attaching to a
host's existing `http.Server` (Express middleware, Next.js route
handler) requires additional Bridge surgery and is tracked as a
follow-up. Today: same process, separate port — but the host's
own auth, storage, and lifecycle.

CLI behaviour and on-disk layout are unchanged for users not
embedding the daemon. See `examples/embed-express/` for a runnable
host + daemon demo.
