---
"@harness-fe/runtime": patch
"@harness-fe/gateway": patch
---

fix(runtime-client): page.screenshot reports elements it silently couldn't capture

snapdom (the DOM-to-canvas library `page.screenshot` uses) can't represent a tainted `<canvas>`, an unready/cross-origin `<video>` frame, or a cross-origin `<iframe>`'s own document — it fails on all three internally, so a blank region in the result looked identical to "this area is genuinely empty." The response now includes `notCaptured: [{tag, selector}]` for anything it detected it couldn't render, verified against a real cross-origin iframe and a real drawn canvas (harness-fe#205).
