---
"@harnessa-fe/protocol": patch
"@harnessa-fe/mcp-server": patch
"@harnessa-fe/runtime": patch
"@harnessa-fe/node-runtime": patch
"@harnessa-fe/next": patch
"@harnessa-fe/log": patch
"@harnessa-fe/react-jsx": patch
"@harnessa-fe/vite": patch
"@harnessa-fe/webpack": patch
"@harnessa-fe/unplugin": patch
---

1.0.2 — coordinated patch across the linked group

**Functional changes:**

- `@harnessa-fe/node-runtime` — auto-captured server-side `console.*` calls now inherit the request's `sessionId` automatically when used with `@harnessa-fe/next`. Previously they became orphans unless the handler was wrapped with `withHarnessaTracing`. Mechanism: a new `setSessionIdProvider(fn)` dependency-injection setter; the Next adapter pushes its `cache()`-backed getter in on first render. ALS still wins when populated; orphan behaviour unchanged when no adapter is loaded.
- `@harnessa-fe/log` — node-side emit path simplified to delegate sessionId resolution to `node-runtime.getRequestSessionId()`. Same observable behaviour; less duplicated logic. Peer-dependency declarations cleaned up — the dynamic-import contract is described in the README instead.
- `@harnessa-fe/next` — `sessionId.ts` module side-effect-registers its `cache()` getter with node-runtime via `setSessionIdProvider`. No new exports.

**Release plumbing:**

- Republish `@harnessa-fe/log` after the 24-hour cooldown from a prior unpublish. Defensive listing covering all 10 linked packages so the bump is genuinely lockstep.
- `scripts/release-publish.sh` handles the npm "Cannot implicitly apply latest tag to a version lower than current latest" case by publishing under a staging tag and then explicitly moving `latest` via `npm dist-tag add`.

**Docs (shipping with the release):**

- New READMEs for `packages/log`, `packages/next`, `packages/node-runtime`.
- New `VISION.md` (three nested mission directions) and `docs/troubleshooting.md`.
- `ARCHITECTURE.md` — new section explaining server-side sessionId resolution chain (ALS → adapter provider → orphan).
- `ROADMAP.md` reframed around the three mission directions.
