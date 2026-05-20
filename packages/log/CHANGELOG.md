# @harnessa-fe/log

## 1.0.1

### Patch Changes

- 8853fb2: Republish `@harnessa-fe/log` with the Turbopack browser/node entry split

  The Turbopack fix (split `./browser` and `./node` exports) was queued for `log@2.0.1` in PR #33, but that PR was closed in favor of the version reset (all core packages → 1.0.0). The reset's "minor" bump landed at `log@1.0.0`, which collided with the existing 1.0.0 already on npm from the original publish — the publish step skipped it as "already up to date" and the Turbopack fix never shipped.

  This patch bumps the linked group again so we get a fresh `log@1.0.1` (containing the browser/node split) on npm. As a side effect, all other linked packages also jump to 1.0.1 — that's fine, the linked invariant is by design.

  Post-publish: deprecate `@harnessa-fe/log@{1.0.0, 2.0.0}` and `@harnessa-fe/next@{1.0.0, 2.0.0}` on npm; publishing 1.0.1 will also reset the `latest` dist-tag away from `next@2.0.0` and `log@2.0.0`.

## 1.0.0

### Minor Changes

- 2019214: Version alignment: reset `@harnessa-fe/log` and `@harnessa-fe/next` to the 0.9.x line, locking all core packages together via `linked` in `.changeset/config.json`

  Background: `@harnessa-fe/log`'s initial Changesets minor bump took it to **1.0.0** (Changesets treats brand-new packages as starting at 1.0.0 unless explicitly minor-bumped from a prior 0.x), then the next minor pushed it to 2.0.0 — leaving the rest of the ecosystem at 0.6–0.9 while `log` and `next` (which transitively bumped) sat at 2.0. Functionally fine, but cosmetically off.

  Since morphicai-web is the only consumer and hasn't shipped publicly, accepting the inconvenience of a version downgrade is cheap. The previous `log@{1.0.0, 2.0.0, 2.0.1}` and `next@{1.0.0, 2.0.0}` releases will be deprecated on npmjs.com pointing to 0.9.x as the canonical line.

  This changeset bumps **every** core package by `minor` so they all land at the same 0.x.0 going forward, plus locks them via `linked` so future bumps stay in lockstep. Also includes the Turbopack-fix browser/node split for `@harnessa-fe/log` that was previously queued as a patch.

### Patch Changes

- Updated dependencies [2019214]
  - @harnessa-fe/next@1.0.0
  - @harnessa-fe/runtime@1.0.0
  - @harnessa-fe/node-runtime@1.0.0

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
