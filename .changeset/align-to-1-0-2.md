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

Re-publish + dist-tag move

Previous publish attempt failed because npm refuses to implicitly move the `latest` tag to a version lower than the current latest (`@harnessa-fe/log@2.0.0`, `@harnessa-fe/next@2.0.0` still held `latest`). Fixed `scripts/release-publish.sh` to handle that case by publishing under a staging tag and then explicitly moving `latest` via `npm dist-tag add`.

This changeset is also a defensive listing: previous attempt only listed `@harnessa-fe/log` in the changeset, so even though `linked` is configured, only `log` got bumped on disk. Listing all 10 packages explicitly guarantees a coordinated patch bump.
