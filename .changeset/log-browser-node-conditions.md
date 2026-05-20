---
"@harnessa-fe/log": patch
---

Fix: Turbopack / strict-bundler client build failure ("the chunking context does not support external modules (request: node:async_hooks)")

Pre-fix, `@harnessa-fe/log` exported a single entry that ran a `typeof window` check and dynamic-imported `./browser-emit` or `./node-emit` accordingly. Dynamic imports are still _seen_ by bundlers — Turbopack walked into `./node-emit.js`, which transitively imports `@harnessa-fe/node-runtime` which imports `node:async_hooks`, and rejected the chunk.

Now the package ships three physical entries selected by `package.json` `exports` conditions:

- `browser` → `./dist/browser.js` (only `./browser-emit.js`)
- `node` → `./dist/node.js` (only `./node-emit.js`)
- default → `./dist/index.js` (runtime detection, fallback for bundlers without conditions)

Next.js Client Components hit the `browser` condition automatically and never see `node:async_hooks`. Server Components hit `node` and only load the Node emit path.

Also exposes explicit subpath imports for callers who want to skip the conditions entirely:
- `import { log } from '@harnessa-fe/log/browser'`
- `import { log } from '@harnessa-fe/log/node'`
