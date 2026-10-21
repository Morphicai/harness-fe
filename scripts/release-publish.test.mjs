import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const script = fileURLToPath(new URL('./release-publish.sh', import.meta.url));

// Exercise the real publish script against tarballs and fake command boundaries.
// The fake npm records only credential presence, never credential values.
function run(mode) {
    const root = mkdtempSync(join(tmpdir(), 'harness-release-test-'));
    try {
        const bin = join(root, 'bin');
        mkdirSync(bin);
        for (const name of ['one', 'two']) {
            const dir = join(root, 'packages', name);
            mkdirSync(dir, { recursive: true });
            writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: `@release-test/${name}`, version: '1.0.0' }));
        }
        const trace = join(root, 'trace.jsonl');
        const writeCommand = (name, body) => {
            const path = join(bin, name);
            writeFileSync(path, `#!${process.execPath}\n${body}`);
            chmodSync(path, 0o755);
        };
        writeCommand('pnpm', `
            const fs = require('node:fs');
            const path = require('node:path');
            const { execFileSync } = require('node:child_process');
            const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
            const stage = fs.mkdtempSync(path.join(process.env.TEST_ROOT, 'pack-'));
            fs.mkdirSync(path.join(stage, 'package'));
            fs.copyFileSync('package.json', path.join(stage, 'package/package.json'));
            const dest = process.argv[process.argv.indexOf('--pack-destination') + 1];
            execFileSync('tar', ['-czf', path.join(dest, pkg.name.split('/')[1] + '.tgz'), '-C', stage, 'package']);
        `);
        writeCommand('npm', `
            const { appendFileSync } = require('node:fs');
            const args = process.argv.slice(2);
            if (args[0] === 'view') {
                if (process.env.TEST_MODE === 'already') console.log('1.0.0');
                else process.exitCode = 1;
            } else if (args[0] === 'publish') {
                const oidc = process.env.NPM_CONFIG_USERCONFIG === '/dev/null';
                appendFileSync(process.env.TEST_TRACE, JSON.stringify({
                    oidc,
                    tokenPresent: !!process.env.NODE_AUTH_TOKEN,
                    fallbackTokenPresent: !!process.env.NPM_TOKEN,
                    configTokenPresent: !!process.env.npm_config__authToken,
                    file: args[1].split('/').pop(),
                }) + '\\n');
                const fail = process.env.TEST_MODE === 'fallback' && oidc
                    || process.env.TEST_MODE === 'partial' && args[1].endsWith('/two.tgz');
                if (fail) { console.error('simulated registry refusal'); process.exitCode = 1; }
            } else { process.exitCode = 2; }
        `);
        const result = spawnSync('bash', [script], {
            cwd: root, encoding: 'utf8', timeout: 20000,
            env: {
                ...process.env, PATH: `${bin}:${process.env.PATH}`, TEST_ROOT: root, TEST_TRACE: trace, TEST_MODE: mode,
                NPM_TOKEN: randomBytes(16).toString('hex'), NODE_AUTH_TOKEN: randomBytes(16).toString('hex'),
                npm_config__authToken: randomBytes(16).toString('hex'), NPM_CONFIG_USERCONFIG: join(root, 'ci-npmrc'),
            },
        });
        const calls = mode === 'already' ? [] : readFileSync(trace, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
        return { status: result.status, calls, output: result.stdout + result.stderr };
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
}

test('OIDC ignores user token configuration and removes inherited tokens', () => {
    const result = run('oidc');
    assert.equal(result.status, 0, result.output);
    assert.equal(result.calls.length, 2);
    assert.ok(result.calls.every((call) => call.oidc && !call.tokenPresent && !call.fallbackTokenPresent && !call.configTokenPresent));
});

test('token fallback retains its configuration after an OIDC refusal', () => {
    const result = run('fallback');
    assert.equal(result.status, 0, result.output);
    assert.equal(result.calls.length, 4);
    assert.ok(result.calls.slice(2).every((call) => !call.oidc && call.tokenPresent && call.fallbackTokenPresent));
});

test('a partial publish fails instead of reporting a complete release', () => {
    const result = run('partial');
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /1 packages failed to publish/);
});

test('reruns skip versions already published without attempting an upload', () => {
    const result = run('already');
    assert.equal(result.status, 0, result.output);
    assert.deepEqual(result.calls, []);
});
