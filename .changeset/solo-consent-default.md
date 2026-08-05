---
"@harness-fe/core": patch
"@harness-fe/cli": patch
---

fix(core,cli): solo mode should default control-command consent to open

Both Bridge's default consent policy and the CLI's non-governed branch set consent to `{ mode: 'deny' }`, silently rejecting `page.click`/`page.type`/every other control command for every solo user unless they separately granted consent through the browser overlay — contradicting the codebase's own stated intent that solo/unrestricted deployments default to `off`. Now defaults to `{ mode: 'off' }` for solo; governed deployments are unaffected (still `session`).
