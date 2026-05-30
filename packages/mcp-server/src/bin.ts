#!/usr/bin/env node
/**
 * Compat shim: the `harness-fe` CLI moved to @harness-fe/dev-cli when the
 * monolith was split (daemon / mcp-server / dev-cli). We keep this bin so the
 * old `npx @harness-fe/mcp-server` keeps working, but forward to dev-cli via
 * npx at runtime — a static dependency would create an mcp-server ↔ dev-cli
 * cycle (dev-cli already depends on mcp-server).
 */
import { spawnSync } from 'node:child_process';

process.stderr.write(
    '[harness-fe] The CLI moved to @harness-fe/dev-cli; forwarding. ' +
        'Run `npx @harness-fe/dev-cli` directly to skip this hop.\n',
);

const result = spawnSync('npx', ['-y', '@harness-fe/dev-cli', ...process.argv.slice(2)], {
    stdio: 'inherit',
});
process.exit(result.status ?? 0);
