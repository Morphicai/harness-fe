---
"@harness-fe/protocol": patch
"@harness-fe/runtime": patch
"@harness-fe/node-runtime": patch
"@harness-fe/next": patch
"@harness-fe/log": patch
"@harness-fe/react-jsx": patch
"@harness-fe/sandbox": patch
"@harness-fe/vite": patch
"@harness-fe/webpack": patch
"@harness-fe/unplugin": patch
"@harness-fe/core": patch
"@harness-fe/console-ui": patch
"@harness-fe/cli": patch
"@harness-fe/gateway": patch
---

Align the linked package group onto a single 4.0.0-next line.

The gateway/console work only touched some packages, so changesets left the linked
group split — `log`/`react-jsx` were still 3.x, `next`/`node-runtime` on older 4.0
prereleases, while gateway/runtime/etc were at next.5. This is a version-only bump
(no code change) so consumers (morphix, tanka) can install ONE consistent
4.0.0-next.x set without mixing `@harness-fe/protocol` majors.
