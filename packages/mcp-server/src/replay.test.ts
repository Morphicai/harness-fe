import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Bridge } from './bridge.js';
import { JsonlStore } from './store/index.js';
import { createReplayExport } from './replayCreate.js';

const tempDirs: string[] = [];
function mkTmp(): string {
    const dir = mkdtempSync(join(tmpdir(), 'harnessa-replay-test-'));
    tempDirs.push(dir);
    return dir;
}

afterEach(async () => {
    while (tempDirs.length) {
        const d = tempDirs.pop()!;
        try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
    }
});

function seedRecording(store: JsonlStore, sessId: string, tabId: string, opts: {
    chunkId: string;
    startTs: number;
    endTs: number;
    events: unknown[];
}) {
    store.appendRecording(sessId, tabId, {
        chunkId: opts.chunkId,
        startTs: opts.startTs,
        endTs: opts.endTs,
        eventCount: opts.events.length,
        events: opts.events,
    });
}

describe('createReplayExport — pure logic', () => {
    it('rejects when neither ts nor since/until are provided', () => {
        const dir = mkTmp();
        const store = new JsonlStore(dir);
        const sessId = store.openSession('proj', { peerRole: 'vite-plugin' });
        const result = createReplayExport(store, undefined, { sessionId: sessId });
        expect(result.error).toMatch(/must provide either ts/);
    });

    it('rejects when until <= since', () => {
        const dir = mkTmp();
        const store = new JsonlStore(dir);
        const sessId = store.openSession('proj', { peerRole: 'vite-plugin' });
        const result = createReplayExport(store, undefined, { sessionId: sessId, since: 100, until: 100 });
        expect(result.error).toMatch(/until must be greater/);
    });

    it('rejects when session unknown', () => {
        const dir = mkTmp();
        const store = new JsonlStore(dir);
        const result = createReplayExport(store, undefined, { sessionId: 'nope', ts: 1000 });
        expect(result.error).toMatch(/session not found/);
    });

    it('rejects when no chunks in window', async () => {
        const dir = mkTmp();
        const store = new JsonlStore(dir);
        const sessId = store.openSession('proj', { peerRole: 'vite-plugin' });
        store.openTab(sessId, { id: 'tab-1' });
        seedRecording(store, sessId, 'tab-1', { chunkId: 'rrc_1', startTs: 1000, endTs: 1500, events: [{}, {}] });
        await store.flush();
        const result = createReplayExport(store, undefined, { sessionId: sessId, since: 5000, until: 6000 });
        expect(result.error).toMatch(/no rrweb chunks/);
    });

    it('rejects when fewer than 2 events in window', async () => {
        const dir = mkTmp();
        const store = new JsonlStore(dir);
        const sessId = store.openSession('proj', { peerRole: 'vite-plugin' });
        store.openTab(sessId, { id: 'tab-1' });
        seedRecording(store, sessId, 'tab-1', { chunkId: 'rrc_1', startTs: 1000, endTs: 1500, events: [{ type: 4 }] });
        await store.flush();
        const result = createReplayExport(store, undefined, { sessionId: sessId, since: 0, until: 5000 });
        expect(result.error).toMatch(/fewer than 2 rrweb events/);
    });

    it('builds an export from chunks in window and persists to disk', async () => {
        const dir = mkTmp();
        const store = new JsonlStore(dir);
        const sessId = store.openSession('proj', { peerRole: 'vite-plugin' });
        store.openTab(sessId, { id: 'tab-1' });
        seedRecording(store, sessId, 'tab-1', { chunkId: 'a', startTs: 1000, endTs: 1500, events: [{ type: 4 }, { type: 3 }] });
        seedRecording(store, sessId, 'tab-1', { chunkId: 'b', startTs: 1600, endTs: 2000, events: [{ type: 3 }, { type: 3 }, { type: 3 }] });
        // outside window — should NOT be in export
        seedRecording(store, sessId, 'tab-1', { chunkId: 'c', startTs: 9000, endTs: 9500, events: [{ type: 3 }, { type: 3 }] });
        await store.flush();

        const result = createReplayExport(store, 'http://127.0.0.1:47729', {
            sessionId: sessId, since: 900, until: 2100, label: 'bug-checkout',
        });
        expect(result.error).toBeUndefined();
        expect(result.exportId).toMatch(/^exp_/);
        expect(result.viewerUrl).toBe(`http://127.0.0.1:47729/replay/${result.exportId}`);
        expect(result.eventCount).toBe(5);
        expect(result.chunkCount).toBe(2);
        expect(result.durationMs).toBe(1000);
        expect(result.label).toBe('bug-checkout');

        // Round-trip through the store
        const events = store.readExportEvents(result.exportId!);
        expect(events).toHaveLength(5);
    });

    it('picks the tab with the most events when caller does not pin tabId', async () => {
        const dir = mkTmp();
        const store = new JsonlStore(dir);
        const sessId = store.openSession('proj', { peerRole: 'vite-plugin' });
        store.openTab(sessId, { id: 'tab-1' });
        store.openTab(sessId, { id: 'tab-2' });
        seedRecording(store, sessId, 'tab-1', { chunkId: 'a', startTs: 1000, endTs: 1500, events: [{ type: 4 }, { type: 3 }] });
        seedRecording(store, sessId, 'tab-2', {
            chunkId: 'b', startTs: 1000, endTs: 2000,
            events: [{ type: 4 }, { type: 3 }, { type: 3 }, { type: 3 }, { type: 3 }],
        });
        await store.flush();

        const result = createReplayExport(store, undefined, { sessionId: sessId, since: 500, until: 2500 });
        expect(result.error).toBeUndefined();
        expect(result.tabId).toBe('tab-2');
        expect(result.eventCount).toBe(5);
    });

    it('respects ts + windowMs as a center window', async () => {
        const dir = mkTmp();
        const store = new JsonlStore(dir);
        const sessId = store.openSession('proj', { peerRole: 'vite-plugin' });
        store.openTab(sessId, { id: 'tab-1' });
        seedRecording(store, sessId, 'tab-1', { chunkId: 'a', startTs: 1000, endTs: 1500, events: [{}, {}] });
        seedRecording(store, sessId, 'tab-1', { chunkId: 'b', startTs: 9000, endTs: 9500, events: [{}, {}] });
        await store.flush();

        const r1 = createReplayExport(store, undefined, { sessionId: sessId, ts: 1200, windowMs: 500 });
        expect(r1.chunkCount).toBe(1);

        const r2 = createReplayExport(store, undefined, { sessionId: sessId, ts: 5000, windowMs: 5000 });
        expect(r2.chunkCount).toBe(2);
    });
});

describe('replay HTTP routes', () => {
    async function startBridge() {
        const dir = mkTmp();
        const store = new JsonlStore(dir);
        const bridge = new Bridge({ port: 0, host: '127.0.0.1', store, taskStore: null, memoryStore: null });
        await bridge.start();
        const port = bridge.getBoundPort();
        if (!port) throw new Error('no port');
        return { bridge, store, port, dir };
    }

    it('serves HTML viewer for an existing export', async () => {
        const { bridge, store, port } = await startBridge();
        try {
            const sessId = store.openSession('proj', { peerRole: 'vite-plugin' });
            store.openTab(sessId, { id: 'tab-1' });
            seedRecording(store, sessId, 'tab-1', { chunkId: 'a', startTs: 1000, endTs: 1500, events: [{ type: 4 }, { type: 3 }] });
            await store.flush();
            const r = createReplayExport(store, `http://127.0.0.1:${port}`, { sessionId: sessId, since: 0, until: 5000 });
            expect(r.exportId).toBeTruthy();

            const resp = await fetch(`http://127.0.0.1:${port}/replay/${r.exportId}`);
            expect(resp.status).toBe(200);
            const html = await resp.text();
            expect(html).toContain('new rrwebPlayer');
            expect(html).toContain(r.exportId!);
        } finally {
            await bridge.stop();
        }
    });

    it('serves events JSON via /replay/:id.json', async () => {
        const { bridge, store, port } = await startBridge();
        try {
            const sessId = store.openSession('proj', { peerRole: 'vite-plugin' });
            store.openTab(sessId, { id: 'tab-1' });
            seedRecording(store, sessId, 'tab-1', { chunkId: 'a', startTs: 1000, endTs: 1500, events: [{ type: 4 }, { type: 3 }, { type: 3 }] });
            await store.flush();
            const r = createReplayExport(store, undefined, { sessionId: sessId, since: 0, until: 5000 });

            const resp = await fetch(`http://127.0.0.1:${port}/replay/${r.exportId}.json`);
            expect(resp.status).toBe(200);
            expect(resp.headers.get('content-type')).toMatch(/application\/json/);
            const body = await resp.json();
            expect(Array.isArray(body)).toBe(true);
            expect(body).toHaveLength(3);
        } finally {
            await bridge.stop();
        }
    });

    it('serves the bundled rrweb-player JS and CSS', async () => {
        const { bridge, port } = await startBridge();
        try {
            const js = await fetch(`http://127.0.0.1:${port}/replay/static/player.js`);
            expect(js.status).toBe(200);
            expect(js.headers.get('content-type')).toMatch(/javascript/);
            const jsBody = await js.text();
            expect(jsBody.length).toBeGreaterThan(1000);
            expect(jsBody).toContain('rrwebPlayer');

            const css = await fetch(`http://127.0.0.1:${port}/replay/static/player.css`);
            expect(css.status).toBe(200);
            expect(css.headers.get('content-type')).toMatch(/css/);
        } finally {
            await bridge.stop();
        }
    });

    it('returns 404 for unknown export', async () => {
        const { bridge, port } = await startBridge();
        try {
            const resp = await fetch(`http://127.0.0.1:${port}/replay/exp_nope`);
            expect(resp.status).toBe(404);
        } finally {
            await bridge.stop();
        }
    });

    it('rejects malformed export ids', async () => {
        const { bridge, port } = await startBridge();
        try {
            const resp = await fetch(`http://127.0.0.1:${port}/replay/has%20space`);
            expect(resp.status).toBe(400);
        } finally {
            await bridge.stop();
        }
    });
});

describe('export retention interacts cleanly with replay creation', () => {
    it('export created after a purge still resolves chunks still on disk', async () => {
        const dir = mkTmp();
        const store = new JsonlStore(dir);
        const sessId = store.openSession('proj', { peerRole: 'vite-plugin' });
        store.openTab(sessId, { id: 'tab-1' });
        // Three chunks; configure purge to drop oldest one.
        const now = Date.now();
        seedRecording(store, sessId, 'tab-1', { chunkId: 'a', startTs: now - 3000, endTs: now - 2800, events: [{ type: 4 }, { type: 3 }] });
        seedRecording(store, sessId, 'tab-1', { chunkId: 'b', startTs: now - 2000, endTs: now - 1800, events: [{ type: 3 }, { type: 3 }] });
        seedRecording(store, sessId, 'tab-1', { chunkId: 'c', startTs: now - 1000, endTs: now - 800, events: [{ type: 3 }, { type: 3 }] });
        await store.flush();

        // Trim to 2 chunks per tab.
        const purge = store.purge({ maxRecordingChunksPerTab: 2, preserveMarkedChunks: false });
        expect(purge.recordingsDeleted).toBeGreaterThanOrEqual(1);

        // Export over the full window — should only include surviving chunks.
        const r = createReplayExport(store, undefined, { sessionId: sessId, since: now - 10000, until: now + 10000 });
        expect(r.error).toBeUndefined();
        expect(r.chunkCount).toBe(2);
        expect(r.eventCount).toBe(4);
    });
});
