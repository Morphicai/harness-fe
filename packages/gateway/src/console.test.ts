import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InProcessCoreClient } from '@harness-fe/core';
import { createGateway, type GatewayHandle } from './server.js';
import { Policy } from './policy.js';

describe('gateway /console', () => {
    let core: InProcessCoreClient;
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
        core = new InProcessCoreClient({ dataDir: coreDir, taskStore: null, autoPurge: { enabled: false } });
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
        expect(Array.isArray(projects.projects)).toBe(true);
    });

    it('serves session detail ({session, summary, timeline}) for a stored session', async () => {
        await boot();
        const store = core.bridge.store!;
        store.upsertProject('demo', { displayName: 'Demo', createdBy: 'local' });
        store.upsertSession('sess-1', {
            tabId: 'tab-1',
            startedAt: Date.now(),
            url: 'http://localhost/app',
            participants: [{ projectId: 'demo', joinedAt: Date.now() }],
        });
        store.appendEvent('sess-1', { ts: Date.now(), t: 'console', tab: 'tab-1', d: { level: 'log', args: ['hi'] } });
        await store.flush();

        // listed under its project
        const projects = await (await fetch(`${base}/console/api/projects`)).json();
        expect(projects.projects.some((e: any) => e.project.id === 'demo')).toBe(true);

        // detail carries session + summary + timeline (with our event)
        const detail = await (await fetch(`${base}/console/api/sessions/sess-1`)).json();
        expect(detail.session?.id).toBe('sess-1');
        expect(detail.summary).toBeTruthy();
        expect(Array.isArray(detail.timeline)).toBe(true);
        expect(detail.timeline.some((e: any) => e.t === 'console')).toBe(true);
        expect(Array.isArray(detail.exports)).toBe(true);

        // unknown session → 404
        const missing = await fetch(`${base}/console/api/sessions/nope`);
        expect(missing.status).toBe(404);
    });

    it('filters session timeline by ?type= (comma-separated)', async () => {
        await boot();
        const store = core.bridge.store!;
        store.upsertProject('demo', { displayName: 'Demo', createdBy: 'local' });
        store.upsertSession('sess-1', {
            tabId: 'tab-1',
            startedAt: Date.now(),
            url: 'http://localhost/app',
            participants: [{ projectId: 'demo', joinedAt: Date.now() }],
        });
        store.appendEvent('sess-1', { ts: 1000, t: 'console', tab: 'tab-1', d: { level: 'log', args: ['hi'] } });
        store.appendEvent('sess-1', { ts: 2000, t: 'error', tab: 'tab-1', d: { message: 'boom' } });
        store.appendEvent('sess-1', { ts: 3000, t: 'network', tab: 'tab-1', d: { phase: 'req', method: 'GET', url: '/x' } });
        await store.flush();

        const filtered = await (await fetch(`${base}/console/api/sessions/sess-1?type=console,error`)).json();
        expect(filtered.timeline.length).toBe(2);
        expect(filtered.timeline.every((e: any) => e.t === 'console' || e.t === 'error')).toBe(true);

        const unfiltered = await (await fetch(`${base}/console/api/sessions/sess-1`)).json();
        expect(unfiltered.timeline.length).toBe(3);
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
        const deep = await fetch(`${base}/console/sessions/abc`);
        expect(await deep.text()).toContain('id="root"');
    });
});
