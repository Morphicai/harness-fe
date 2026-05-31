import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCoreClient, type CoreClient } from '@harness-fe/core';
import { createGateway, type GatewayHandle } from './server.js';
import { Policy } from './policy.js';

describe('gateway /console', () => {
    let core: CoreClient;
    let gw: GatewayHandle;
    let base: string;
    let dir: string;
    let coreDir: string;

    afterEach(async () => {
        await gw.close();
        await core.stop();
        if (dir) rmSync(dir, { recursive: true, force: true });
        if (coreDir) rmSync(coreDir, { recursive: true, force: true });
    });

    async function boot(consoleDir?: string): Promise<void> {
        coreDir = mkdtempSync(join(tmpdir(), 'hfe-console-core-'));
        core = createCoreClient({ dataDir: coreDir, taskStore: null, autoPurge: { enabled: false } });
        await core.start();
        gw = createGateway({ coreClient: core, policy: new Policy({ mode: 'open' }), consoleDir });
        base = `http://127.0.0.1:${await gw.listen(0)}`;
    }

    it('serves the data API (meta + projects) under Open policy', async () => {
        await boot();
        const meta = await (await fetch(`${base}/console/api/meta`)).json();
        expect(meta.mode).toBe('open');
        expect(typeof meta.protocolVersion).toBe('string');
        const projects = await (await fetch(`${base}/console/api/projects`)).json();
        expect(Array.isArray(projects)).toBe(true);
    });

    it('serves a placeholder SPA when no consoleDir is configured', async () => {
        await boot();
        const r = await fetch(`${base}/console`);
        expect(r.status).toBe(200);
        expect((await r.text()).toLowerCase()).toContain('console');
    });

    it('serves the built SPA index + assets from consoleDir', async () => {
        dir = mkdtempSync(join(tmpdir(), 'hfe-console-dir-'));
        writeFileSync(join(dir, 'index.html'), '<!doctype html><div id="root">SPA</div>');
        await boot(dir);
        const idx = await fetch(`${base}/console`);
        expect(await idx.text()).toContain('id="root"');
        // Unknown sub-path falls back to index.html (SPA client routing).
        const deep = await fetch(`${base}/console/session/abc`);
        expect(await deep.text()).toContain('id="root"');
    });
});
