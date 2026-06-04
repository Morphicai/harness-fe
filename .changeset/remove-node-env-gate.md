---
'@harness-fe/next': minor
'@harness-fe/node-runtime': minor
---

Remove internal NODE_ENV guard — activation is now the caller's responsibility.

Previously `withHarness()`, `<HarnessScript>`, `auto.ts`, and `auto-edge.ts`
all silently no-op'd when `NODE_ENV !== 'development'`. This decision is now
left entirely to the consuming application.

**Migration** — if you relied on the implicit dev-only guard, wrap the call
yourself:

```js
// next.config.mjs
export default process.env.NODE_ENV === 'development'
  ? withHarness(nextConfig, opts)
  : nextConfig;
```

```tsx
// app/layout.tsx
{process.env.NODE_ENV === 'development' && <HarnessScript projectId="…" />}
```
