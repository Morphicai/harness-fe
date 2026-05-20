---
"@harnessa-fe/next": minor
---

`<HarnessaScript>` auto-boots `@harnessa-fe/node-runtime` on first server render

Previously, getting server-side capture (Server Component errors, Route Handler / Server Action durations, uncaught Node exceptions) required users to write an `instrumentation.ts` file by hand AND enable `experimental.instrumentationHook`. With Turbopack, even `withHarnessa()`'s webpack-plugin injection silently no-ops — leaving Turbopack users with no path other than the manual instrumentation file.

Now: the Server Component `<HarnessaScript>` itself triggers `register()` on its very first server render, behind a process-level `globalThis` singleton so HMR module reloads don't re-init. Works identically on webpack and Turbopack because it doesn't rely on bundler-plugin hooks. Edge Runtime is supported via the `@harnessa-fe/node-runtime/auto-edge` entry, which is selected automatically when `NEXT_RUNTIME === 'edge'`.

`@harnessa-fe/node-runtime` is now an optional peer dependency of `@harnessa-fe/next` — apps that don't want server-side capture can omit it; the auto-boot will log a warning and skip. `instrumentation.ts` continues to work for users who need precise control over boot ordering (e.g. registering before other middleware).
