---
"@harness-fe/next": patch
---

fix: replace require('webpack') with createRequire for ESM compatibility

The package has `"type": "module"` so the compiled dist is treated as ESM,
where bare `require` is not defined. Fixes ReferenceError in Next.js 15
production builds when `HARNESS_FE_TOKEN` is set. Closes #152.
