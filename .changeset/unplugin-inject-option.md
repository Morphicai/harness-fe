---
"@harness-fe/unplugin": minor
"@harness-fe/webpack": minor
---

feat(unplugin,webpack): add `inject` option to skip HTML injection while keeping source tagging

`disabled` is all-or-nothing — it turns off the JSX/Vue source tagging along with everything else. The new `inject?: boolean` (default `true`) is the surgical middle ground: with `inject: false` the plugin skips the HTML injection (`window.__HARNESS_FE__` config + runtime script tag on Vite; the config script on the native webpack plugin) while the source tagging transform, buildId resolution, and the MCP bridge all keep running. For host apps that boot `RuntimeClient` themselves under runtime conditions (login state, allowlists) and only want build-time tagging from the plugin.
