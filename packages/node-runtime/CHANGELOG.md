# @harnessa-fe/node-runtime

## 0.9.0

### Minor Changes

- d2b1733: `captureConsole` is now **default on** — server-side `console.*` output is forwarded to the daemon as `server-log` events automatically once `register()` runs.

  Why: requiring users to know about and set `HARNESSA_FE_NODE_CONSOLE=1` for the basic case ("see my server logs in the daemon") was friction with little benefit. Most apps want server console visibility from day one; the off-by-default was a defensive default that turned out to be wrong for the common case.

  **Opt out**:

  - Pass `register({ captureConsole: false })` programmatically, OR
  - Set `HARNESSA_FE_NODE_CONSOLE=0` env var (note: now `=0` to disable, not `=1` to enable).

  Existing users who never set the env var get a free upgrade — their console output starts flowing without code changes. Existing users who set `HARNESSA_FE_NODE_CONSOLE=1` to opt in: that's now a no-op (still enables, but redundant); set to `0` if you specifically want it off.

## 0.8.0

### Minor Changes

- 0cd04d9: feat(log): new `@harnessa-fe/log` isomorphic logger package

  Introduces `@harnessa-fe/log` — a zero-config structured logger that works
  identically in Server Components, Route Handlers, Server Actions, Client
  Components, and shared utilities.

  - `log.info('msg', { meta })` from any environment lands in
    `~/.harnessa/data/sessions/{sid}/timeline.jsonl` as `t: 'app-log'`
  - Session identity is resolved fresh on every call (via React `cache()` /
    AsyncLocalStorage) — no cross-request contamination possible
  - No userId in payload — agents resolve user via `sessionId → visitor` lookup
  - Scope chaining: `log.scope('a').scope('b')` emits `scope='a.b'`
  - Silent on missing runtime (optional peer deps on node-runtime and runtime)

  **@harnessa-fe/node-runtime**: adds `reportAppLog()` method + `AppLogContext`
  type for the new explicit log path (distinct from auto-captured console).

  **@harnessa-fe/mcp-server**: adds `EventType = 'app-log'`, bridge now writes
  `t: 'app-log'` rows for `app.log` frames (previously would have stored `t:
'app.log'` — now consistent with `server-log` / `server-err` naming), and
  the dashboard renders app-log events with a distinct soft-purple tag.

## 0.7.0

### Minor Changes

- c4a1f59: feat: Edge Runtime HTTP transport (Phase 1)

  - `@harnessa-fe/protocol`: add `httpBatchSchema` / `HttpBatch` for stateless POST /events
  - `@harnessa-fe/mcp-server`: new `POST /events` + `GET /events/ping` HTTP endpoints; `Bridge.handleHttpBatch()` routes batches into the same session timeline as the WebSocket path
  - `@harnessa-fe/node-runtime`: `Transport` interface + `WsTransport` (existing behaviour) + `HttpBatchTransport` (fetch-based, 500ms flush, 50-event batching, 5xx retry, outbox cap); automatic selection via `NEXT_RUNTIME=edge` / `HARNESSA_FE_TRANSPORT=http`; `ws` moved to optional peer dependency; new `./auto-edge` export
  - `@harnessa-fe/next`: webpack plugin injects `@harnessa-fe/node-runtime/auto-edge` into edge-runtime bundles (webworker target)

### Patch Changes

- Updated dependencies [c4a1f59]
  - @harnessa-fe/protocol@0.7.0
