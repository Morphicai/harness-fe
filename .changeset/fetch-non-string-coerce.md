---
'@harness-fe/sandbox': patch
'@harness-fe/runtime': patch
---

**Fix:** `@harness-fe/sandbox` fetch channel now coerces non-string `init.method` and non-string header values through `String()` before downstream use. Sibling of the same-class storage `setItem` bug — native fetch ByteString-coerces these per spec, so business code occasionally relies on it (e.g. `fetch(url, { method: someEnum.toUpperCase() })` where `someEnum` is actually a number constant). Without this fix, `extractMeta` threw inside the patched fetch, turning a working native call into a rejected Promise.

Internal-only: no API surface change. 2 regression tests pin the behaviour.
