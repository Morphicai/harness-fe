---
"@harness-fe/runtime": minor
"@harness-fe/unplugin": minor
"@harness-fe/webpack": minor
"@harness-fe/next": minor
---

feat(runtime,unplugin,next): add `recording` option to fully disable rrweb recording

`ClientOptions.recording?: boolean` (default `true`). With `recording: false` the runtime client never starts the rrweb recorder — no FullSnapshot baseline, no incremental chunks — while event capture (console / network / errors / idb / …) is unaffected. For deployments that want observability and agent control without replayable DOM footage. Threaded through the plugin option (`harnessFE({ recording: false })` on Vite/webpack), the injected `window.__HARNESS_FE__` config, and `<HarnessScript recording={false}>`.
