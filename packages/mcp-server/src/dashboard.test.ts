import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Bridge } from './bridge.js';
import { JsonlStore } from './store/index.js';

const tempDirs: string[] = [];
function mkTmp(): string {
    const dir = mkdtempSync(join(tmpdir(), 'harnessa-dashboard-test-'));
    tempDirs.push(dir);
    return dir;
}

afterEach(async () => {
    while (tempDirs.length) {
        const d = tempDirs.pop()!;
        try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
    }
});

async function bootBridge() {
    const dir = mkTmp();
    const store = new JsonlStore(dir);
    const bridge = new Bridge({ port: 0, host: '127.0.0.1', store, taskStore: null, memoryStore: null });
    await bridge.start();
    const port = bridge.getBoundPort();
    if (!port) throw new Error('no port');
    return { bridge, store, port };
}

function seed(store: JsonlStore, projectId: string) {
    const { randomUUID } = require('node:crypto') as typeof import('node:crypto');
    const sessionId = randomUUID();
    store.upsertProject(projectId, { displayName: projectId });
    store.upsertTab('tab-1', { connectedAt: Date.now(), userAgent: 'test-agent' });
    store.upsertSession(sessionId, {
        tabId: 'tab-1',
        startedAt: Date.now(),
        url: 'http://localhost:5173/',
        title: 'Demo',
        participants: [{ projectId, joinedAt: Date.now() }],
    });
    store.appendEvent(sessionId, { ts: 1000, t: 'log', d: { args: ['hello'] } });
    store.appendEvent(sessionId, { ts: 1100, t: 'err', d: { message: 'boom' } });
    store.appendRecording(sessionId, {
        chunkId: 'rrc_a', startTs: 1000, endTs: 2000, eventCount: 3,
        events: [
            { type: 4, data: {}, timestamp: 1000 },
            { type: 2, data: {}, timestamp: 1100 },
            { type: 3, data: {}, timestamp: 2000 },
        ],
    });
    return sessionId;
}

describe('Dashboard HTTP routes', () => {
    it('GET / lists projects with their recent sessions', async () => {
        const { bridge, store, port } = await bootBridge();
        try {
            seed(store, 'my-app');
            await store.flush();
            const resp = await fetch(`http://127.0.0.1:${port}/`);
            expect(resp.status).toBe(200);
            expect(resp.headers.get('content-type')).toMatch(/text\/html/);
            const html = await resp.text();
            expect(html).toContain('my-app');
            expect(html).toContain('Harnessa dev console');
            expect(html).toContain('/sessions/');
        } finally {
            await bridge.stop();
        }
    });

    it('GET / on empty store still returns 200 with empty-state message', async () => {
        const { bridge, port } = await bootBridge();
        try {
            const resp = await fetch(`http://127.0.0.1:${port}/`);
            expect(resp.status).toBe(200);
            const html = await resp.text();
            expect(html).toMatch(/No projects yet/i);
        } finally {
            await bridge.stop();
        }
    });

    it('GET /sessions/:id renders detail with tabs, chunks, timeline', async () => {
        const { bridge, store, port } = await bootBridge();
        try {
            const sessId = seed(store, 'my-app');
            await store.flush();
            const resp = await fetch(`http://127.0.0.1:${port}/sessions/${sessId}`);
            expect(resp.status).toBe(200);
            const html = await resp.text();
            expect(html).toContain(sessId);
            expect(html).toContain('tab-1');
            expect(html).toContain('rrc_a');
            expect(html).toContain('Create replay');
            // err timeline tag present
            expect(html).toContain('tag-err');
        } finally {
            await bridge.stop();
        }
    });

    it('GET /sessions/:id returns 404 for unknown session', async () => {
        const { bridge, port } = await bootBridge();
        try {
            const resp = await fetch(`http://127.0.0.1:${port}/sessions/does-not-exist`);
            expect(resp.status).toBe(404);
        } finally {
            await bridge.stop();
        }
    });

    it('POST /sessions/:id/replay 302-redirects to the new /replay/:id', async () => {
        const { bridge, store, port } = await bootBridge();
        try {
            const sessId = seed(store, 'my-app');
            await store.flush();

            const body = new URLSearchParams({ tabId: 'tab-1', since: '0', until: '5000' }).toString();
            const resp = await fetch(`http://127.0.0.1:${port}/sessions/${sessId}/replay`, {
                method: 'POST',
                headers: { 'content-type': 'application/x-www-form-urlencoded' },
                body,
                redirect: 'manual',
            });
            expect(resp.status).toBe(302);
            const loc = resp.headers.get('location');
            expect(loc).toMatch(/^\/replay\/exp_/);

            // Follow up: viewer should now be reachable.
            const viewer = await fetch(`http://127.0.0.1:${port}${loc}`);
            expect(viewer.status).toBe(200);
            expect((await viewer.text())).toContain('new rrwebPlayer');
        } finally {
            await bridge.stop();
        }
    });

    it('POST /sessions/:id/replay shows a friendly error when the window is empty', async () => {
        const { bridge, store, port } = await bootBridge();
        try {
            const { randomUUID } = require('node:crypto') as typeof import('node:crypto');
            const sessId = randomUUID();
            store.upsertTab('tab-empty', { connectedAt: Date.now() });
            store.upsertSession(sessId, {
                tabId: 'tab-empty',
                startedAt: Date.now(),
                participants: [{ projectId: 'my-app', joinedAt: Date.now() }],
            });
            // intentionally no recordings
            await store.flush();
            const body = new URLSearchParams({ since: '0', until: '1' }).toString();
            const resp = await fetch(`http://127.0.0.1:${port}/sessions/${sessId}/replay`, {
                method: 'POST',
                headers: { 'content-type': 'application/x-www-form-urlencoded' },
                body,
                redirect: 'manual',
            });
            expect(resp.status).toBe(400);
            expect(await resp.text()).toMatch(/no rrweb chunks/);
        } finally {
            await bridge.stop();
        }
    });

    it('exports created via the dashboard appear in the session detail "Replay exports" list', async () => {
        const { bridge, store, port } = await bootBridge();
        try {
            const sessId = seed(store, 'my-app');
            await store.flush();
            const body = new URLSearchParams({ tabId: 'tab-1', since: '0', until: '5000' }).toString();
            const r = await fetch(`http://127.0.0.1:${port}/sessions/${sessId}/replay`, {
                method: 'POST',
                headers: { 'content-type': 'application/x-www-form-urlencoded' },
                body,
                redirect: 'manual',
            });
            const loc = r.headers.get('location') ?? '';
            const exportId = loc.split('/').pop();
            expect(exportId).toMatch(/^exp_/);

            const detail = await fetch(`http://127.0.0.1:${port}/sessions/${sessId}`);
            const html = await detail.text();
            expect(html).toContain(exportId!);
            expect(html).toContain('Replay exports (1)');
        } finally {
            await bridge.stop();
        }
    });
});
