---
"@harnessa-fe/log": patch
---

Republish `@harnessa-fe/log` with the Turbopack browser/node entry split

The Turbopack fix (split `./browser` and `./node` exports) was queued for `log@2.0.1` in PR #33, but that PR was closed in favor of the version reset (all core packages → 1.0.0). The reset's "minor" bump landed at `log@1.0.0`, which collided with the existing 1.0.0 already on npm from the original publish — the publish step skipped it as "already up to date" and the Turbopack fix never shipped.

This patch bumps the linked group again so we get a fresh `log@1.0.1` (containing the browser/node split) on npm. As a side effect, all other linked packages also jump to 1.0.1 — that's fine, the linked invariant is by design.

Post-publish: deprecate `@harnessa-fe/log@{1.0.0, 2.0.0}` and `@harnessa-fe/next@{1.0.0, 2.0.0}` on npm; publishing 1.0.1 will also reset the `latest` dist-tag away from `next@2.0.0` and `log@2.0.0`.
