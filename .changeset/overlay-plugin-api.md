---
'@harness-fe/runtime': minor
---

**Overlay plugin API.** The in-page "H" overlay is now extensible. Register custom action buttons with `registerOverlayPlugin({ id, label, icon?, requiresElement?, onClick(ctx) })` — no fork, no published package needed. Use it to send the current scene + logs to a teammate or POST it into your own system (issue tracker / Slack / webhook).

**Registration** works in any order (the registry buffers; the overlay re-renders when the set changes):
- Typed import: `import { registerOverlayPlugin } from '@harness-fe/runtime'` (idempotent, full types).
- Global: `window.HarnessFE.registerOverlayPlugin(...)`, or push to the pre-boot queue `window.__HARNESS_FE_PLUGINS__` for scripts that run before the runtime loads.

**Context** handed to `onClick` is lazy + redaction-aware: `snapshotMarkdown()`, `snapshot()` (page/viewport/storage/performance), `getLogs()` (console/network/errors — network bodies + `authorization`/`cookie` headers stripped unless `redact:false`), `captureScreenshot()`, `selectedElement` (for `requiresElement` plugins), `query()` (daemon RPC), `copyToClipboard()`, `toast()`. New exports: `registerOverlayPlugin`, `getOverlayPlugins`, `subscribeOverlayPlugins`, and the `OverlayPlugin` / `OverlayPluginContext` types.

MVP is action buttons only; first-class registered panels remain a future extension. A documented **Jira issue** example + proxy contract ships in `docs/overlay-plugins.md`.

Also: the overlay info card now shows a small GitHub link to the project.
