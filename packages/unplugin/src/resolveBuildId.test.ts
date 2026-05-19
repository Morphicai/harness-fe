import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveBuildId } from './resolveBuildId.js';

describe('resolveBuildId', () => {
    let root: string;
    const origEnv = { ...process.env };

    beforeEach(() => {
        root = mkdtempSync(join(tmpdir(), 'rbid-'));
        // Strip CI env vars so tests aren't influenced by the host env.
        delete process.env.GITHUB_SHA;
        delete process.env.GIT_COMMIT;
        delete process.env.CI_COMMIT_SHA;
        delete process.env.BUILDKITE_COMMIT;
    });

    afterEach(() => {
        rmSync(root, { recursive: true, force: true });
        process.env = { ...origEnv };
    });

    it('userConfig wins over all auto-detection', () => {
        process.env.GITHUB_SHA = 'aaaaaaaaaa';
        const out = resolveBuildId({ root, userConfig: 'explicit-id-99' });
        expect(out.buildId).toBe('explicit-id-99');
        expect(out.gitSha).toBeUndefined();
    });

    it('falls back to dev hash + startTs when neither git nor CI is available', () => {
        // No package.json, no git → pure fallback path
        const out = resolveBuildId({ root, startTs: 1700000000000 });
        // dev-<8-char-hash>-<base36-ts>
        expect(out.buildId).toMatch(/^dev-[a-f0-9]{8}-[a-z0-9]+$/);
        expect(out.sourceDigest).toBeDefined();
        expect(out.gitSha).toBeUndefined();
    });

    it('two consecutive resolves with the same root + startTs produce the same buildId', () => {
        writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'fixture' }));
        const a = resolveBuildId({ root, startTs: 42 });
        const b = resolveBuildId({ root, startTs: 42 });
        expect(a.buildId).toBe(b.buildId);
    });

    it('changing package.json changes the dev hash component', () => {
        writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'a' }));
        const a = resolveBuildId({ root, startTs: 1 });
        writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'b' }));
        const b = resolveBuildId({ root, startTs: 1 });
        expect(a.buildId).not.toBe(b.buildId);
    });

    it('reads GITHUB_SHA when present', () => {
        process.env.GITHUB_SHA = '0123456789abcdef0123';
        const out = resolveBuildId({ root });
        expect(out.buildId).toBe('0123456789ab-ci');
        expect(out.gitSha).toBe('0123456789abcdef0123');
        expect(out.gitDirty).toBe(false);
    });
});
