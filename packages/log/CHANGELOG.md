# @harnessa-fe/log

## 2.0.1

### Patch Changes

- 008417d: Fix: Turbopack / strict-bundler client build failure ("the chunking context does not support external modules (request: node:async_hooks)")

  Pre-fix, `@harnessa-fe/log` exported a single entry that ran a `typeof window` check and dynamic-imported `./browser-emit` or `./node-emit` accordingly. Dynamic imports are still _seen_ by bundlers — Turbopack walked into `./node-emit.js`, which transitively imports `@harnessa-fe/node-runtime` which imports `node:async_hooks`, and rejected the chunk.

  Now the package ships three physical entries selected by `package.json` `exports` conditions:

  - `browser` → `./dist/browser.js` (only `./browser-emit.js`)
  - `node` → `./dist/node.js` (only `./node-emit.js`)
  - default → `./dist/index.js` (runtime detection, fallback for bundlers without conditions)

  Next.js Client Components hit the `browser` condition automatically and never see `node:async_hooks`. Server Components hit `node` and only load the Node emit path.

  Also exposes explicit subpath imports for callers who want to skip the conditions entirely:

  - `import { log } from '@harnessa-fe/log/browser'`
  - `import { log } from '@harnessa-fe/log/node'`

## 2.0.0

### Patch Changes

- Updated dependencies [d2b1733]
  - @harnessa-fe/node-runtime@0.9.0
  - @harnessa-fe/next@2.0.0

## 1.0.0

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

### Patch Changes

- Updated dependencies [0cd04d9]
  - @harnessa-fe/node-runtime@0.8.0
  - @harnessa-fe/next@1.0.0
