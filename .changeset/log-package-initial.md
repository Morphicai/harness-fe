---
"@harnessa-fe/log": minor
"@harnessa-fe/node-runtime": minor
"@harnessa-fe/mcp-server": patch
---

feat(log): new `@harnessa-fe/log` isomorphic logger package

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
