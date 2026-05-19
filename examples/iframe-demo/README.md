# `iframe-demo`

End-to-end proof that **same-origin iframe identity inheritance works**.

Two Vite dev servers, each with its own `projectId`:
- `parent` on :5180 (`projectId=iframe-parent`, `displayName=Parent Shell`)
- `child` on :5181 (`projectId=iframe-child`, declares `parentProjectId=iframe-parent`)

Parent reverse-proxies `/child/*` to `:5181` so the browser sees the iframe as same-origin. The child runtime then reads `window.parent.__harnessa_fe_client__` to inherit the parent's `tabId` + `sessionId`.

## What it proves

| Layer | Verified |
|---|---|
| Runtime client | `tryInheritFromParent()` runs in a real browser (not just happy-dom) and finds the parent's globals |
| Identity inheritance | parent + child runtime both expose `tabId` / `sessionId` and they're **equal** |
| Project tree | `iframe-parent` is a root; `iframe-child.parentProjectId === 'iframe-parent'`; `project.tree()` returns the forest correctly |
| Build metadata | Each project gets its own `BuildMeta` (different `gitSha` if the demos are versioned independently) |

## Run

```bash
pnpm install
# manually inspect in your browser:
pnpm --filter harnessa-fe-iframe-demo dev:child   # tab 1
pnpm --filter harnessa-fe-iframe-demo dev:parent  # tab 2
# open http://localhost:5180/ — open devtools, run `__harnessa_fe_client__.tabId` in parent and inside the iframe; they match.
```

## Verify

```bash
pnpm --filter harnessa-fe-iframe-demo e2e
```

The e2e spawns both Vite servers + an in-process `Bridge` with a temp `JsonlStore`, then asserts every step of the inheritance chain using headless Chromium. Tears down on exit.

## Files

- `parent/vite.config.ts` — reverse proxy `/child/*` → `:5181`
- `child/vite.config.ts` — declares `parentProjectId` at build time
- `e2e/iframe.e2e.ts` — the canonical proof, runnable on CI
