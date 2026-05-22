# Adopting harness-fe in legacy Vue projects

This doc is for codebases that aren't pure Vue 3 — `@vue/compat`,
migrations in progress, large iView/Element/Ant Design forks, anything
where filter syntax (`{{ x | foo }}`) or `<template functional>` still
shows up.

## The contract

> harness-fe will never produce output that vue-loader / @vitejs/plugin-vue
> chokes on. The worst case is that a particular `.vue` file isn't
> instrumented and falls through unchanged.

If you see a vue-loader / compiler error appearing only with the plugin
installed, treat it as a harness-fe bug and report it.

## How that's enforced

The Vue SFC transformer goes through three independent safety layers
(`packages/unplugin/src/vue-transform.ts`):

1. **Strict parse downgrade.** Any `@vue/compiler-sfc` error → the file
   is skipped (no injection). We don't trust offsets that came from a
   half-recovered parse.
2. **Walk-time exception trap.** The AST walk runs inside try/catch.
   Any thrown error → skip, no injection.
3. **Output self-check (`safeMode`).** After we inject attributes, we
   re-parse the produced source. If the re-parse surfaces errors → drop
   the injection, fall back to the original source.

All three pass through `console.warn` so you can see what was skipped
and why.

## What Vue 2 patterns look like to the plugin

| Pattern | Behaviour |
|---|---|
| `{{ value \| filter }}` (filters) | typically skipped (compiler-dom in Vue 3 doesn't recognise filters) |
| `<template functional>` | typically skipped |
| `slot="x"` / `slot-scope` | parses through; element still gets `data-morphix-loc` |
| `v-bind.sync` modifier | parses through (`.sync` is just an attribute name to the parser) |
| `v-on.native` | parses through |
| `inline-template` | host element tagged; nested template content not parsed |
| `key` on `<template v-for>` | parses through |
| Render functions / JSX in `<script>` | not visible to this transformer (works as designed) |

## Settings

```ts
harnessFE({
  // ...
  safeMode: true, // default — keep this on for any project with Vue 2 era code
})
```

Pass `safeMode: false` only after you've measured the perf cost and
confirmed your project is 100% modern Vue 3 syntax. The check is a
second `parseSFC` call per file, so on cold dev start it's a few
milliseconds per `.vue`.

## Dry-run coverage report

Before flipping the plugin on for real on a big legacy codebase, run a
dry-run to see how many files would actually get `data-morphix-loc`:

```bash
HARNESS_FE_DRY_RUN=1 pnpm dev
```

When the dev server exits (Ctrl-C), the plugin prints a report on
stderr:

```
[harness-fe] Vue transform coverage report
  files attempted:        1247
  files injected:         1102
  elements tagged:        18430
  skipped (SFC error):    14
  skipped (template):     112
  skipped (walk error):   0
  skipped (self-check):   19
  first 20 skipped paths:
    src/legacy/Search.vue
    src/legacy/UserCard.vue
    ...
```

Use it to:

- Decide whether the agent's source-aware features are worth the
  conversion effort (e.g. < 5% missing → ship; > 30% → consider
  migrating filters first).
- Build a prioritised list of files to modernise.

## Don't forget runtime-only mode

If even the partial coverage isn't enough — say, agent tooling that
depends on `project_where_is` would be too unreliable — you can install
just the runtime client and skip the build plugin. You still get
`console_tail` / `network_tail` / `errors_tail` / `session.recordings`
which are the highest-value capabilities anyway, and you carry zero
risk to your build.

## Reporting issues

When you find a Vue 2 pattern that breaks something downstream, attach:

1. A minimal `.vue` that reproduces it.
2. The exact `console.warn` line from the daemon.
3. Your `@vue/compiler-sfc` version (`pnpm why @vue/compiler-sfc`).

That trio is enough to add a regression case to
`vue-transform.test.ts`.
