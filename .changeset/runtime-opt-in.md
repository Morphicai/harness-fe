---
"@harness-fe/runtime": minor
"@harness-fe/next": patch
---

Runtime opt-in for agent control (4.0). The end-user can now actively allow or
block in-page agent control per app from the overlay. The choice persists in
localStorage (`__hfe_runtime_control__:{projectId}`) and **overrides** the app's
`consent` default and the gateway's hello.ack default — closing the gap where a
user had no way to refuse agent control. Exposed via
`window.HarnessFE.getRuntimeControl()` / `setRuntimeControl()` and a one-tap
toggle in the overlay info card. The app-level default remains the existing
plugin `consent` option (no new redundant parameter).

Also adds the missing `'deny'` value to the Next.js `HarnessScript` `consent`
prop type, aligning it with the Vite/Webpack plugin and the runtime.
