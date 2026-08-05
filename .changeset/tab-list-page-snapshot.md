---
"@harness-fe/protocol": patch
"@harness-fe/runtime": patch
"@harness-fe/core": patch
"@harness-fe/gateway": patch
---

feat(tab_list, page.snapshot): richer tab metadata + compact clickable-element index

`tab_list` gains `isIframe` (`window.top !== window.self`, disambiguates rows sharing a tabId with their same-origin parent) and `referrer` (a cross-origin iframe's only legitimate signal of what embeds it). `url`/`title`/`isIframe` now refresh live on both full page loads and client-side (SPA) navigation instead of freezing at connect time.

Adds `page.snapshot` (harness-fe#202): a token-bounded, Snapshot+Refs-style index of visible `<a>`/`<button>` elements, each with a short-lived `ref` usable as `{selector: {ref}}` in `page.click`/`page.type` — no selector to write, refs invalidate on the next snapshot call.
