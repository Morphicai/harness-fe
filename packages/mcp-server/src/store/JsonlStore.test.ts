import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as fc from 'fast-check';
import { JsonlStore, sanitizeId } from './JsonlStore.js';
import { WriteQueue } from './WriteQueue.js';

function makeStore() {
    const dir = mkdtempSync(join(tmpdir(), 'harnessa-store-test-'));
    const store = new JsonlStore(dir);
    return { store, dir };
}

function cleanup(dir: string) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

describe('JsonlStore', () => {
    let dir: string;
    let store: JsonlStore;

    beforeEach(() => {
        ({ store, dir } = makeStore());
    });

    afterEach(async () => {
        await store.close();
        cleanup(dir);
    });

    // ── Session lifecycle ────────────────────────────────────────────────

    it('opens a session and returns a sessionId', () => {
        const id = store.openSession('my-project', { peerRole: 'vite-plugin' });
        expect(typeof id).toBe('string');
        expect(id.length).toBeGreaterThan(0);
    });

    it('lists projects after opening a session', () => {
        store.openSession('proj-a', { peerRole: 'vite-plugin' });
        store.openSession('proj-b', { peerRole: 'webpack-plugin' });
        const projects = store.listProjects();
        expect(projects.map((p) => p.id)).toContain('proj-a');
        expect(projects.map((p) => p.id)).toContain('proj-b');
    });

    it('lists sessions for a project', () => {
        const s1 = store.openSession('proj', { peerRole: 'vite-plugin' });
        const s2 = store.openSession('proj', { peerRole: 'vite-plugin' });
        const sessions = store.listSessions('proj');
        const ids = sessions.map((s) => s.id);
        expect(ids).toContain(s1);
        expect(ids).toContain(s2);
    });

    it('closes a session and records endedAt', () => {
        const id = store.openSession('proj', { peerRole: 'vite-plugin' });
        store.closeSession(id);
        const meta = store.getSession(id);
        expect(meta?.endedAt).toBeDefined();
        expect(meta!.endedAt!).toBeGreaterThan(0);
    });

    it('opens and closes a tab', () => {
        const sessId = store.openSession('proj', { peerRole: 'vite-plugin' });
        store.openTab(sessId, { id: 'tab-1', url: 'http://localhost:5173', title: 'Demo' });
        store.closeTab(sessId, 'tab-1');
        // No error = pass; tab meta is written to disk
    });

    // ── Write + tail ─────────────────────────────────────────────────────

    it('appends events and tails them back', async () => {
        const sessId = store.openSession('proj', { peerRole: 'vite-plugin' });
        store.append(sessId, { ts: 1000, t: 'log', d: { level: 'info', args: ['hello'] } });
        store.append(sessId, { ts: 2000, t: 'err', d: { message: 'boom' } });
        store.append(sessId, { ts: 3000, t: 'hmr', d: { file: 'App.tsx' } });

        await store.flush();
        const events = store.tail(sessId);
        expect(events).toHaveLength(3);
        expect(events[0].t).toBe('log');
        expect(events[2].t).toBe('hmr');
    });

    it('tail filters by type', async () => {
        const sessId = store.openSession('proj', { peerRole: 'vite-plugin' });
        store.append(sessId, { ts: 1000, t: 'log', d: {} });
        store.append(sessId, { ts: 2000, t: 'err', d: { message: 'oops' } });
        store.append(sessId, { ts: 3000, t: 'log', d: {} });

        await store.flush();
        const errors = store.tail(sessId, { type: 'err' });
        expect(errors).toHaveLength(1);
        expect(errors[0].t).toBe('err');
    });

    it('tail filters by multiple types', async () => {
        const sessId = store.openSession('proj', { peerRole: 'vite-plugin' });
        store.append(sessId, { ts: 1000, t: 'log', d: {} });
        store.append(sessId, { ts: 2000, t: 'err', d: {} });
        store.append(sessId, { ts: 3000, t: 'hmr', d: {} });
        store.append(sessId, { ts: 4000, t: 'cmd', d: {} });

        await store.flush();
        const result = store.tail(sessId, { type: ['err', 'hmr'] });
        expect(result).toHaveLength(2);
        expect(result.map((e) => e.t).sort()).toEqual(['err', 'hmr']);
    });

    it('tail respects n limit', async () => {
        const sessId = store.openSession('proj', { peerRole: 'vite-plugin' });
        for (let i = 0; i < 20; i++) {
            store.append(sessId, { ts: i * 100, t: 'log', d: { i } });
        }
        await store.flush();
        const result = store.tail(sessId, { n: 5 });
        expect(result).toHaveLength(5);
        // Should be the last 5
        expect((result[4].d as { i: number }).i).toBe(19);
    });

    it('appendBatch writes all events', async () => {
        const sessId = store.openSession('proj', { peerRole: 'vite-plugin' });
        store.appendBatch(sessId, [
            { ts: 1000, t: 'log', d: { msg: 'a' } },
            { ts: 2000, t: 'log', d: { msg: 'b' } },
            { ts: 3000, t: 'err', d: { message: 'c' } },
        ]);
        await store.flush();
        const events = store.tail(sessId);
        expect(events).toHaveLength(3);
    });

    it('rejects tab-scoped append without load field', async () => {
        const sessId = store.openSession('proj', { peerRole: 'vite-plugin' });
        store.openTab(sessId, { id: 'tab-1' });
        expect(() =>
            store.append(sessId, { ts: 1, t: 'log', d: {} }, 'tab-1'),
        ).toThrow(/missing required load field/);
    });

    it('rejects session-scoped append carrying a load field', async () => {
        const sessId = store.openSession('proj', { peerRole: 'vite-plugin' });
        expect(() =>
            store.append(sessId, { ts: 1, t: 'hmr', load: 'L1', d: {} }),
        ).toThrow(/must not carry a load field/);
    });

    it('filters tail by loadId when provided', async () => {
        const sessId = store.openSession('proj', { peerRole: 'vite-plugin' });
        store.openTab(sessId, { id: 'tab-1' });
        store.append(sessId, { ts: 1, t: 'log', load: 'L1', d: {} }, 'tab-1');
        store.append(sessId, { ts: 2, t: 'log', load: 'L2', d: {} }, 'tab-1');
        store.append(sessId, { ts: 3, t: 'log', load: 'L1', d: {} }, 'tab-1');
        await store.flush();
        const l1 = store.tail(sessId, { loadId: 'L1' }, 'tab-1');
        const l2 = store.tail(sessId, { loadId: 'L2' }, 'tab-1');
        expect(l1.map((e) => e.ts)).toEqual([1, 3]);
        expect(l2.map((e) => e.ts)).toEqual([2]);
    });

    it('appends to tab timeline when tabId provided', async () => {
        const sessId = store.openSession('proj', { peerRole: 'vite-plugin' });
        store.openTab(sessId, { id: 'tab-1' });
        store.append(sessId, { ts: 1000, t: 'log', load: 'L1', d: {} }, 'tab-1');
        store.append(sessId, { ts: 2000, t: 'err', load: 'L1', d: {} }, 'tab-1');

        await store.flush();

        // Session timeline has both
        const sessEvents = store.tail(sessId);
        expect(sessEvents).toHaveLength(2);

        // Tab timeline also has both
        const tabEvents = store.tail(sessId, {}, 'tab-1');
        expect(tabEvents).toHaveLength(2);
    });

    it('openLoad appends to loads.jsonl and rewrites prior endedAt', () => {
        const sessId = store.openSession('proj', { peerRole: 'vite-plugin' });
        store.openTab(sessId, { id: 'tab-1' });
        store.openLoad(sessId, 'tab-1', { id: 'L1', startedAt: 1000, url: 'http://x/' });
        let loads = store.listLoads(sessId, 'tab-1');
        expect(loads).toHaveLength(1);
        expect(loads[0].endedAt).toBeUndefined();

        store.openLoad(sessId, 'tab-1', { id: 'L2', startedAt: 2000, url: 'http://x/' });
        loads = store.listLoads(sessId, 'tab-1');
        expect(loads).toHaveLength(2);
        // listLoads returns newest first
        expect(loads[0].id).toBe('L2');
        expect(loads[0].endedAt).toBeUndefined();
        expect(loads[1].id).toBe('L1');
        expect(loads[1].endedAt).toBe(2000);

        store.closeLatestLoad(sessId, 'tab-1', 3000);
        loads = store.listLoads(sessId, 'tab-1');
        expect(loads[0].endedAt).toBe(3000);
    });

    it('getLoad returns the matching LoadMeta', () => {
        const sessId = store.openSession('proj', { peerRole: 'vite-plugin' });
        store.openTab(sessId, { id: 'tab-1' });
        store.openLoad(sessId, 'tab-1', { id: 'L1', startedAt: 100 });
        expect(store.getLoad(sessId, 'tab-1', 'L1')?.id).toBe('L1');
        expect(store.getLoad(sessId, 'tab-1', 'missing')).toBeUndefined();
    });

    it('sliceRecordingsByLoad uses the load time window', async () => {
        const sessId = store.openSession('proj', { peerRole: 'vite-plugin' });
        store.openTab(sessId, { id: 'tab-1' });
        store.openLoad(sessId, 'tab-1', { id: 'L1', startedAt: 1000 });
        store.appendRecording(sessId, 'tab-1', {
            chunkId: 'c1', startTs: 1100, endTs: 1200, eventCount: 1, events: [],
        });
        store.appendRecording(sessId, 'tab-1', {
            chunkId: 'c2', startTs: 9000, endTs: 9500, eventCount: 1, events: [],
        });
        store.closeLatestLoad(sessId, 'tab-1', 2000);
        await store.flush();
        const chunks = store.sliceRecordingsByLoad(sessId, 'tab-1', 'L1');
        expect(chunks.map((c) => c.chunkId)).toEqual(['c1']);
    });

    it('appends rrweb recording chunks', async () => {
        const sessId = store.openSession('proj', { peerRole: 'vite-plugin' });
        store.openTab(sessId, { id: 'tab-1' });
        store.appendRecording(sessId, 'tab-1', [{ type: 4, data: {} }]);
        store.appendRecording(sessId, 'tab-1', [{ type: 3, data: {} }]);
        await store.flush();
        // No error = pass; recordings are written to disk
    });

    it('lists recording chunks across tabs in chronological order', async () => {
        const sessId = store.openSession('proj', { peerRole: 'vite-plugin' });
        store.openTab(sessId, { id: 'tab-1' });
        store.openTab(sessId, { id: 'tab-2' });
        store.appendRecording(sessId, 'tab-1', {
            chunkId: 'rrc_1',
            startTs: 1000,
            endTs: 1500,
            eventCount: 2,
            events: [{ type: 4 }, { type: 3 }],
        });
        store.appendRecording(sessId, 'tab-2', {
            chunkId: 'rrc_2',
            startTs: 2000,
            endTs: 2500,
            eventCount: 1,
            events: [{ type: 3 }],
        });

        await store.flush();
        expect(store.listRecordings(sessId)).toEqual([
            { chunkId: 'rrc_1', tabId: 'tab-1', startTs: 1000, endTs: 1500, eventCount: 2 },
            { chunkId: 'rrc_2', tabId: 'tab-2', startTs: 2000, endTs: 2500, eventCount: 1 },
        ]);
        expect(store.listRecordings(sessId, 'tab-1')).toEqual([
            { chunkId: 'rrc_1', tabId: 'tab-1', startTs: 1000, endTs: 1500, eventCount: 2 },
        ]);
    });

    it('slices recording chunks by overlapping time window', async () => {
        const sessId = store.openSession('proj', { peerRole: 'vite-plugin' });
        store.openTab(sessId, { id: 'tab-1' });
        store.appendRecording(sessId, 'tab-1', {
            chunkId: 'rrc_1',
            startTs: 1000,
            endTs: 1500,
            eventCount: 2,
            events: [{ type: 4 }, { type: 3 }],
        });
        store.appendRecording(sessId, 'tab-1', {
            chunkId: 'rrc_2',
            startTs: 2000,
            endTs: 2500,
            eventCount: 1,
            events: [{ type: 3 }],
        });

        await store.flush();
        const slice = store.sliceRecordings(sessId, 1200, 2100);
        expect(slice).toHaveLength(2);
        expect(slice.map((chunk) => chunk.chunkId)).toEqual(['rrc_1', 'rrc_2']);
        expect(slice[0].events).toHaveLength(2);
        expect(store.sliceRecordings(sessId, 2600, 3000)).toEqual([]);
    });

    it('purge trims recording chunks by per-tab count limit', async () => {
        const sessId = store.openSession('proj', { peerRole: 'vite-plugin' });
        store.openTab(sessId, { id: 'tab-1' });
        store.appendRecording(sessId, 'tab-1', {
            chunkId: 'rrc_1',
            startTs: Date.now() - 1000,
            endTs: Date.now() - 900,
            eventCount: 1,
            events: [{ type: 4 }],
        });
        store.appendRecording(sessId, 'tab-1', {
            chunkId: 'rrc_2',
            startTs: Date.now() - 800,
            endTs: Date.now() - 700,
            eventCount: 1,
            events: [{ type: 4 }],
        });
        store.appendRecording(sessId, 'tab-1', {
            chunkId: 'rrc_3',
            startTs: Date.now() - 600,
            endTs: Date.now() - 500,
            eventCount: 1,
            events: [{ type: 4 }],
        });

        await store.flush();
        const result = store.purge({
            maxAgeDays: 7,
            maxSessionsPerProject: 20,
            recordingRetentionDays: 7,
            maxRecordingChunksPerTab: 2,
        });

        expect(result.recordingsDeleted).toBe(1);
        expect(store.listRecordings(sessId, 'tab-1').map((chunk) => chunk.chunkId)).toEqual(['rrc_2', 'rrc_3']);
    });

    it('purge prefers keeping marked chunks when configured', async () => {
        const sessId = store.openSession('proj', { peerRole: 'vite-plugin' });
        store.openTab(sessId, { id: 'tab-1' });
        const now = Date.now();
        store.append(sessId, {
            ts: now - 450,
            t: 'rrweb:marker',
            tab: 'tab-1',
            load: 'L1',
            d: { markerId: 'rrm_1', kind: 'error', label: 'boom' },
        }, 'tab-1');
        store.appendRecording(sessId, 'tab-1', {
            chunkId: 'rrc_1',
            startTs: now - 1000,
            endTs: now - 900,
            eventCount: 1,
            events: [{ type: 4 }],
        });
        store.appendRecording(sessId, 'tab-1', {
            chunkId: 'rrc_2',
            startTs: now - 600,
            endTs: now - 400,
            eventCount: 1,
            events: [{ type: 4 }],
        });
        store.appendRecording(sessId, 'tab-1', {
            chunkId: 'rrc_3',
            startTs: now - 300,
            endTs: now - 200,
            eventCount: 1,
            events: [{ type: 4 }],
        });

        await store.flush();
        const result = store.purge({
            maxAgeDays: 7,
            maxSessionsPerProject: 20,
            recordingRetentionDays: 7,
            maxRecordingChunksPerTab: 2,
            preserveMarkedChunks: true,
        });

        expect(result.recordingsDeleted).toBe(1);
        expect(store.listRecordings(sessId, 'tab-1').map((chunk) => chunk.chunkId)).toEqual(['rrc_2', 'rrc_3']);
    });

    it('recording prune leaves session timeline and markers intact', async () => {
        const sessId = store.openSession('proj', { peerRole: 'vite-plugin' });
        store.openTab(sessId, { id: 'tab-1' });
        const now = Date.now();
        // Two ordinary timeline entries + one marker — none of these should be touched.
        store.append(sessId, { ts: now - 800, t: 'log', load: 'L1', d: { args: ['hello'] } }, 'tab-1');
        store.append(sessId, { ts: now - 500, t: 'err', load: 'L1', d: { message: 'boom' } }, 'tab-1');
        store.append(sessId, {
            ts: now - 450,
            t: 'rrweb:marker',
            tab: 'tab-1',
            load: 'L1',
            d: { markerId: 'rrm_1', kind: 'error', label: 'boom' },
        }, 'tab-1');
        // Three rrweb chunks — purge will trim to 2.
        for (let i = 0; i < 3; i++) {
            store.appendRecording(sessId, 'tab-1', {
                chunkId: `c_${i}`,
                startTs: now - 1000 + i * 100,
                endTs: now - 900 + i * 100,
                eventCount: 1,
                events: [{ type: 4 }],
            });
        }
        await store.flush();

        const before = store.tail(sessId, { n: 50 });
        const beforeMarkers = store.tail(sessId, { n: 50, type: 'rrweb:marker' });

        const result = store.purge({ maxRecordingChunksPerTab: 2, preserveMarkedChunks: false });
        expect(result.recordingsDeleted).toBe(1);

        const after = store.tail(sessId, { n: 50 });
        const afterMarkers = store.tail(sessId, { n: 50, type: 'rrweb:marker' });
        expect(after).toEqual(before);
        expect(afterMarkers).toEqual(beforeMarkers);
        expect(afterMarkers).toHaveLength(1);
    });

    // ── Exports (replay) ─────────────────────────────────────────────────

    it('writeExport persists events and metadata, readable by id', async () => {
        const sessId = store.openSession('proj', { peerRole: 'vite-plugin' });
        store.openTab(sessId, { id: 'tab-1' });
        const meta = store.writeExport({
            sessionId: sessId,
            tabId: 'tab-1',
            since: 1000,
            until: 2000,
            startTs: 1100,
            endTs: 1900,
            chunkCount: 2,
            events: [{ type: 4 }, { type: 3 }, { type: 3 }],
            label: 'bug-1',
        });
        expect(meta.exportId).toMatch(/^exp_/);
        expect(meta.eventCount).toBe(3);
        expect(meta.bytes).toBeGreaterThan(0);

        const fromIndex = store.getExport(meta.exportId);
        expect(fromIndex?.label).toBe('bug-1');
        expect(fromIndex?.chunkCount).toBe(2);

        const events = store.readExportEvents(meta.exportId);
        expect(events).toHaveLength(3);
    });

    it('listExports returns exports newest-first per project', () => {
        const s1 = store.openSession('proj', { peerRole: 'vite-plugin' });
        store.openTab(s1, { id: 'tab-1' });
        const a = store.writeExport({ sessionId: s1, tabId: 'tab-1', since: 0, until: 1, startTs: 0, endTs: 1, chunkCount: 1, events: [{}, {}] });
        // Tiny delay to differentiate createdAt.
        const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
        return (async () => {
            await sleep(5);
            const b = store.writeExport({ sessionId: s1, tabId: 'tab-1', since: 0, until: 1, startTs: 0, endTs: 1, chunkCount: 1, events: [{}, {}] });
            const all = store.listExports('proj');
            expect(all.map((m) => m.exportId)).toEqual([b.exportId, a.exportId]);
        })();
    });

    it('purge trims exports beyond the per-project count limit, oldest first', async () => {
        const s1 = store.openSession('proj', { peerRole: 'vite-plugin' });
        store.openTab(s1, { id: 'tab-1' });
        const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
        const exports: string[] = [];
        for (let i = 0; i < 4; i++) {
            const meta = store.writeExport({
                sessionId: s1, tabId: 'tab-1', since: 0, until: 1, startTs: 0, endTs: 1, chunkCount: 1, events: [{}, {}],
            });
            exports.push(meta.exportId);
            await sleep(3);
        }
        const result = store.purge({
            maxExportsPerProject: 2,
            // disable other knobs by leaving them at defaults
        });
        expect(result.exportsDeleted).toBe(2);
        const remaining = store.listExports('proj').map((m) => m.exportId);
        // newest two kept
        expect(remaining).toEqual([exports[3], exports[2]]);
        // deleted ones gone
        expect(store.getExport(exports[0])).toBeUndefined();
        expect(store.readExportEvents(exports[0])).toBeUndefined();
    });

    it('purge trims exports beyond the per-project byte ceiling', async () => {
        const s1 = store.openSession('proj', { peerRole: 'vite-plugin' });
        store.openTab(s1, { id: 'tab-1' });
        // Each export with ~1KB of events.
        const bigEvent = { type: 3, data: { payload: 'x'.repeat(900) } };
        const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
        const ids: string[] = [];
        for (let i = 0; i < 3; i++) {
            const meta = store.writeExport({
                sessionId: s1, tabId: 'tab-1', since: 0, until: 1, startTs: 0, endTs: 1, chunkCount: 1,
                events: [bigEvent, bigEvent],
            });
            ids.push(meta.exportId);
            await sleep(3);
        }
        // Allow only ~one export worth of bytes.
        const result = store.purge({ maxExportBytesPerProject: 2000 });
        expect(result.exportsDeleted).toBeGreaterThanOrEqual(1);
        const surviving = store.listExports('proj').map((m) => m.exportId);
        // newest survives
        expect(surviving[0]).toBe(ids[2]);
    });

    // ── Search ───────────────────────────────────────────────────────────

    it('searches events by substring', async () => {
        const sessId = store.openSession('proj', { peerRole: 'vite-plugin' });
        store.append(sessId, { ts: 1000, t: 'log', d: { args: ['hello world'] } });
        store.append(sessId, { ts: 2000, t: 'log', d: { args: ['goodbye'] } });
        store.append(sessId, { ts: 3000, t: 'err', d: { message: 'hello error' } });

        await store.flush();
        const results = store.search(sessId, 'hello');
        expect(results).toHaveLength(2);
    });

    it('search filters by type', async () => {
        const sessId = store.openSession('proj', { peerRole: 'vite-plugin' });
        store.append(sessId, { ts: 1000, t: 'log', d: { args: ['hello'] } });
        store.append(sessId, { ts: 2000, t: 'err', d: { message: 'hello error' } });

        await store.flush();
        const results = store.search(sessId, 'hello', { type: 'err' });
        expect(results).toHaveLength(1);
        expect(results[0].t).toBe('err');
    });

    // ── Summary ──────────────────────────────────────────────────────────

    it('returns a session summary with counts', async () => {
        const sessId = store.openSession('proj', { peerRole: 'vite-plugin' });
        store.append(sessId, { ts: 1000, t: 'log', d: {} });
        store.append(sessId, { ts: 2000, t: 'log', d: {} });
        store.append(sessId, { ts: 3000, t: 'err', d: { message: 'boom' } });
        store.append(sessId, { ts: 4000, t: 'cmd', d: {} });

        await store.flush();
        const s = store.summary(sessId);
        expect(s.counts['log']).toBe(2);
        expect(s.counts['err']).toBe(1);
        expect(s.counts['cmd']).toBe(1);
        expect(s.lastError?.t).toBe('err');
        expect(s.lastActivity).toBe(4000);
    });

    // ── Notes ────────────────────────────────────────────────────────────

    it('writes and reads project notes', () => {
        store.openSession('proj', { peerRole: 'vite-plugin' });
        store.writeNote('proj', 'known_issues', 'Login button broken on Safari');
        store.writeNote('proj', 'architecture', 'Uses React 18 + Vite 7');

        const notes = store.listNotes('proj');
        expect(notes.map((n) => n.key)).toContain('known_issues');
        expect(notes.map((n) => n.key)).toContain('architecture');
    });

    it('returns latest value when same key written multiple times', () => {
        store.openSession('proj', { peerRole: 'vite-plugin' });
        store.writeNote('proj', 'status', 'v1');
        store.writeNote('proj', 'status', 'v2');

        const notes = store.listNotes('proj');
        const status = notes.find((n) => n.key === 'status');
        expect(status?.value).toBe('v2');
    });

    // ── Purge ────────────────────────────────────────────────────────────

    it('purge removes sessions older than maxAgeDays', async () => {
        const sessId = store.openSession('proj', { peerRole: 'vite-plugin' });
        store.append(sessId, { ts: Date.now(), t: 'log', d: {} });

        // Manually backdate the session meta
        const meta = store.getSession(sessId)!;
        meta.startedAt = Date.now() - 10 * 86400000; // 10 days ago
        // Write it back directly
        const { writeFileSync } = await import('node:fs');
        const { join: pathJoin } = await import('node:path');
        const sessDir = pathJoin(dir, 'proj', 'sessions', sessId);
        writeFileSync(pathJoin(sessDir, 'meta.json'), JSON.stringify(meta));

        const result = store.purge({ maxAgeDays: 7 });
        expect(result.sessionsDeleted).toBe(1);
    });

    it('purge keeps recent sessions', () => {
        store.openSession('proj', { peerRole: 'vite-plugin' });
        store.openSession('proj', { peerRole: 'vite-plugin' });

        const result = store.purge({ maxAgeDays: 7 });
        expect(result.sessionsDeleted).toBe(0);

        const remaining = store.listSessions('proj');
        expect(remaining).toHaveLength(2);
    });

    it('purge respects maxSessionsPerProject', () => {
        for (let i = 0; i < 5; i++) {
            store.openSession('proj', { peerRole: 'vite-plugin' });
        }
        const result = store.purge({ maxAgeDays: 365, maxSessionsPerProject: 3 });
        expect(result.sessionsDeleted).toBe(2);
        expect(store.listSessions('proj')).toHaveLength(3);
    });

    // ── Startup recovery (Requirement 2.6) ───────────────────────────────

    it('startup recovery: rebuilds sessionIndex from disk', async () => {
        // Create sessions in the first store instance
        const s1 = store.openSession('proj', { peerRole: 'vite-plugin' });
        const s2 = store.openSession('proj', { peerRole: 'webpack-plugin' });
        store.closeSession(s1); // s1 has endedAt
        // s2 is left open (no endedAt)
        await store.close();

        // Create a new store instance pointing to the same directory
        const store2 = new JsonlStore(dir);

        // Both sessions should be accessible via getSession
        const meta1 = store2.getSession(s1);
        const meta2 = store2.getSession(s2);

        expect(meta1).toBeDefined();
        expect(meta1!.id).toBe(s1);
        expect(meta2).toBeDefined();
        expect(meta2!.id).toBe(s2);

        await store2.close();
    });

    it('startup recovery: sets endedAt on orphaned sessions', async () => {
        // Create a session and leave it open (no closeSession call)
        const orphanId = store.openSession('proj', { peerRole: 'vite-plugin' });
        // Verify it has no endedAt yet
        const metaBefore = store.getSession(orphanId);
        expect(metaBefore?.endedAt).toBeUndefined();
        await store.close();

        const beforeRestart = Date.now();

        // Create a new store instance — startup recovery should set endedAt
        const store2 = new JsonlStore(dir);

        const metaAfter = store2.getSession(orphanId);
        expect(metaAfter).toBeDefined();
        expect(metaAfter!.endedAt).toBeDefined();
        expect(metaAfter!.endedAt!).toBeGreaterThanOrEqual(beforeRestart);

        await store2.close();
    });

    it('startup recovery: does not overwrite endedAt on already-closed sessions', async () => {
        // Create and properly close a session
        const closedId = store.openSession('proj', { peerRole: 'vite-plugin' });
        store.closeSession(closedId);
        const metaBefore = store.getSession(closedId);
        const originalEndedAt = metaBefore!.endedAt!;
        expect(originalEndedAt).toBeDefined();
        await store.close();

        // Create a new store instance
        const store2 = new JsonlStore(dir);

        const metaAfter = store2.getSession(closedId);
        expect(metaAfter).toBeDefined();
        // endedAt should remain the original value, not overwritten
        expect(metaAfter!.endedAt).toBe(originalEndedAt);

        await store2.close();
    });

    it('startup recovery: handles multiple projects and sessions', async () => {
        // Create sessions across multiple projects
        const s1 = store.openSession('proj-alpha', { peerRole: 'vite-plugin' });
        const s2 = store.openSession('proj-beta', { peerRole: 'webpack-plugin' });
        const s3 = store.openSession('proj-alpha', { peerRole: 'vite-plugin' });
        store.closeSession(s1); // closed
        // s2 and s3 are orphaned
        await store.close();

        const store2 = new JsonlStore(dir);

        // All sessions should be in the index
        expect(store2.getSession(s1)).toBeDefined();
        expect(store2.getSession(s2)).toBeDefined();
        expect(store2.getSession(s3)).toBeDefined();

        // Orphaned sessions should have endedAt set
        expect(store2.getSession(s2)!.endedAt).toBeDefined();
        expect(store2.getSession(s3)!.endedAt).toBeDefined();

        // Closed session should retain its original endedAt
        expect(store2.getSession(s1)!.endedAt).toBeDefined();

        await store2.close();
    });
});

// ── Project tree + build metadata (v0.2 micro-frontend layer) ────────────────

describe('JsonlStore — project tree + build metadata', () => {
    let dataDir: string;
    let store: JsonlStore;

    beforeEach(() => {
        dataDir = mkdtempSync(join(tmpdir(), 'jstore-tree-'));
        store = new JsonlStore(dataDir);
    });

    afterEach(async () => {
        await store.close();
        rmSync(dataDir, { recursive: true, force: true });
    });

    it('upsertProject writes parentProjectId/displayName/tags into meta.json', () => {
        store.upsertProject('app-parent', { displayName: 'Parent App' });
        store.upsertProject('app-child', {
            parentProjectId: 'app-parent',
            displayName: 'Child App',
            tags: ['mfe', 'iframe'],
        });

        const parent = store.getProject('app-parent');
        const child = store.getProject('app-child');
        expect(parent?.displayName).toBe('Parent App');
        expect(parent?.parentProjectId).toBeUndefined();
        expect(child?.parentProjectId).toBe('app-parent');
        expect(child?.tags).toEqual(['mfe', 'iframe']);
    });

    it('upsertProject preserves fields not in the patch (last-write-wins per field)', () => {
        store.upsertProject('p1', { displayName: 'first', tags: ['a'] });
        store.upsertProject('p1', { parentProjectId: 'root' });

        const meta = store.getProject('p1');
        expect(meta?.displayName).toBe('first'); // preserved
        expect(meta?.tags).toEqual(['a']); // preserved
        expect(meta?.parentProjectId).toBe('root'); // newly set
        expect(meta?.id).toBe('p1');
        expect(typeof meta?.createdAt).toBe('number');
    });

    it('upsertProject refuses self-parent cycle', () => {
        store.upsertProject('p1', {});
        expect(() => store.upsertProject('p1', { parentProjectId: 'p1' })).toThrow(/itself/);
    });

    it('upsertProject refuses indirect parent cycle (A→B→A)', () => {
        store.upsertProject('a', {});
        store.upsertProject('b', { parentProjectId: 'a' });
        expect(() => store.upsertProject('a', { parentProjectId: 'b' })).toThrow(/cycle/);
    });

    it('subsequent openSession does NOT overwrite parentProjectId / displayName', () => {
        // Critical: hello-driven upsertProject runs first, then plugin opens
        // a session via openSession. Older code would wipe the new meta fields.
        store.upsertProject('p1', { displayName: 'Parent', parentProjectId: 'root' });
        store.openSession('p1', { peerRole: 'vite-plugin' });

        const meta = store.getProject('p1');
        expect(meta?.displayName).toBe('Parent');
        expect(meta?.parentProjectId).toBe('root');
    });

    it('upsertBuild + getBuild + listBuilds roundtrip', () => {
        store.upsertProject('app', {});
        store.upsertBuild('app', 'b1', {
            gitSha: 'abc',
            gitDirty: false,
            bundler: 'vite',
        });
        store.upsertBuild('app', 'b2', {
            gitSha: 'def',
            gitDirty: true,
            bundler: 'vite',
        });

        const b1 = store.getBuild('app', 'b1');
        expect(b1?.gitSha).toBe('abc');
        expect(b1?.projectId).toBe('app');

        const all = store.listBuilds('app');
        expect(all.map((b) => b.id).sort()).toEqual(['b1', 'b2']);
    });

    it('upsertBuild merges incremental patches', () => {
        store.upsertProject('app', {});
        store.upsertBuild('app', 'b1', { gitSha: 'abc' });
        store.upsertBuild('app', 'b1', { nodeVersion: 'v22.0.0' });

        const meta = store.getBuild('app', 'b1');
        expect(meta?.gitSha).toBe('abc');
        expect(meta?.nodeVersion).toBe('v22.0.0');
    });

    it('getProjectTree assembles parent/child relationships into a forest', () => {
        store.upsertProject('root1', { displayName: 'Root One' });
        store.upsertProject('child-a', { parentProjectId: 'root1', displayName: 'Alpha' });
        store.upsertProject('child-b', { parentProjectId: 'root1', displayName: 'Bravo' });
        store.upsertProject('grandchild', { parentProjectId: 'child-a' });
        store.upsertProject('root2', { displayName: 'Root Two' });

        const tree = store.getProjectTree();
        expect(tree.map((n) => n.id).sort()).toEqual(['root1', 'root2']);
        const r1 = tree.find((n) => n.id === 'root1')!;
        expect(r1.children.map((c) => c.id).sort()).toEqual(['child-a', 'child-b']);
        const ca = r1.children.find((c) => c.id === 'child-a')!;
        expect(ca.children.map((c) => c.id)).toEqual(['grandchild']);
    });

    it('getProjectTree with rootId returns just that sub-tree', () => {
        store.upsertProject('root', { displayName: 'Root' });
        store.upsertProject('mid', { parentProjectId: 'root' });
        store.upsertProject('leaf', { parentProjectId: 'mid' });

        const subtree = store.getProjectTree('mid');
        expect(subtree).toHaveLength(1);
        expect(subtree[0]?.id).toBe('mid');
        expect(subtree[0]?.children.map((c) => c.id)).toEqual(['leaf']);
    });

    // Edge-case hardening (Layer P1)

    it('getProjectTree handles a 1000-deep chain without stack overflow', () => {
        // Build a long linear chain p0 ← p1 ← p2 ← … ← p999 and ensure
        // getProjectTree returns without throwing.
        for (let i = 0; i < 1000; i++) {
            const parent = i === 0 ? undefined : `p${i - 1}`;
            store.upsertProject(`p${i}`, parent ? { parentProjectId: parent } : {});
        }
        const tree = store.getProjectTree('p0');
        // Walk to confirm depth.
        let depth = 0;
        let cursor = tree[0];
        while (cursor) {
            depth++;
            cursor = cursor.children[0];
        }
        expect(depth).toBe(1000);
    });

    it('upsertProject rejects tags + metadata exceeding 16KB', () => {
        const big = 'x'.repeat(20 * 1024);
        expect(() =>
            store.upsertProject('p1', { metadata: { blob: big } }),
        ).toThrow(/refused.*bytes.*limit/);
    });

    it('upsertProject accepts modest tags + metadata under the limit', () => {
        const ok = 'x'.repeat(1024);
        expect(() =>
            store.upsertProject('p1', {
                tags: ['a', 'b', 'c'],
                metadata: { note: ok },
            }),
        ).not.toThrow();
    });

    it('upsertBuild rejects tags + metadata exceeding 16KB', () => {
        store.upsertProject('app', {});
        const big = 'x'.repeat(20 * 1024);
        expect(() =>
            store.upsertBuild('app', 'b1', { metadata: { blob: big } }),
        ).toThrow(/refused.*bytes.*limit/);
    });

    it('purge enforces maxBuildsPerProject (newest builds kept)', () => {
        store.upsertProject('app', {});
        // Insert 5 builds with strictly increasing builtAt timestamps so
        // listBuilds returns them in known order.
        for (let i = 0; i < 5; i++) {
            store.upsertBuild('app', `b${i}`, {
                bundler: 'vite',
            });
            // Patch builtAt to force sortability — bypass the merge that
            // would re-stamp to "now" by writing the meta directly.
            const meta = store.getBuild('app', `b${i}`)!;
            const fixed = { ...meta, builtAt: 1_700_000_000_000 + i * 1000 };
            writeFileSync(
                join(dataDir, 'app', 'builds', `b${i}`, 'meta.json'),
                JSON.stringify(fixed),
            );
        }
        expect(store.listBuilds('app')).toHaveLength(5);

        const result = store.purge({ maxBuildsPerProject: 2 });
        expect(result.buildsDeleted).toBe(3);

        const remaining = store.listBuilds('app').map((b) => b.id);
        expect(remaining.sort()).toEqual(['b3', 'b4']); // newest 2 kept
    });
});

// ── Property-Based Tests ─────────────────────────────────────────────────────

// Feature: persistence, Property 13: ID sanitization safety
describe('sanitizeId — Property 13: ID sanitization safety', () => {
    it('sanitized output always matches /^[a-zA-Z0-9._-]{1,64}$/ for any string input', () => {
        // Validates: Requirements 13.3
        fc.assert(
            fc.property(fc.string({ minLength: 1 }), (id) => {
                const sanitized = sanitizeId(id);
                expect(sanitized).toMatch(/^[a-zA-Z0-9._-]{1,64}$/);
            }),
            { numRuns: 100 },
        );
    });

    it('sanitized output is at most 64 characters for any string input', () => {
        // Validates: Requirements 13.3
        fc.assert(
            fc.property(fc.string(), (id) => {
                const sanitized = sanitizeId(id);
                expect(sanitized.length).toBeLessThanOrEqual(64);
            }),
            { numRuns: 100 },
        );
    });

    it('sanitized output contains only allowed characters for any string input', () => {
        // Validates: Requirements 13.3
        fc.assert(
            fc.property(fc.string({ minLength: 1 }), (id) => {
                const sanitized = sanitizeId(id);
                expect(sanitized).toMatch(/^[a-zA-Z0-9._-]+$/);
            }),
            { numRuns: 100 },
        );
    });
});

// ── Property-Based Tests: Tasks 3.3–3.6 ─────────────────────────────────────

// Feature: persistence, Property 3: StoreEvent JSONL round-trip
describe('Property 3: StoreEvent JSONL round-trip', () => {
    it('writing an event and reading it back preserves ts, t, and d fields', async () => {
        // Validates: Requirements 5.5, 12.4
        await fc.assert(
            fc.asyncProperty(
                fc.record({
                    seq: fc.nat(),
                    ts: fc.integer({ min: 0 }),
                    t: fc.string(),
                    tab: fc.option(fc.string(), { nil: undefined }),
                    d: fc.jsonValue(),
                }),
                async (event) => {
                    const tmpDir = mkdtempSync(join(tmpdir(), 'pbt-p3-'));
                    try {
                        const store = new JsonlStore(tmpDir);
                        const sessId = store.openSession('proj', { peerRole: 'vite-plugin' });
                        store.append(sessId, { ts: event.ts, t: event.t, d: event.d });
                        await store.flush();

                        const events = store.tail(sessId);
                        expect(events).toHaveLength(1);
                        expect(events[0].ts).toBe(event.ts);
                        expect(events[0].t).toBe(event.t);
                        // toStrictEqual would distinguish -0 / +0, but JSON cannot
                        // round-trip -0 (JSON.stringify(-0) === "0"). toEqual treats
                        // them as equal in older vitest; v2 made it strict. Normalize.
                        expect(JSON.parse(JSON.stringify(events[0].d))).toEqual(
                            JSON.parse(JSON.stringify(event.d)),
                        );

                        await store.close();
                    } finally {
                        cleanup(tmpDir);
                    }
                },
            ),
            { numRuns: 100 },
        );
    });
});

// Feature: persistence, Property 4: Monotonically increasing seq values
describe('Property 4: Monotonically increasing seq values', () => {
    it('seq values are non-negative integers increasing by exactly 1 for each appended event', async () => {
        // Validates: Requirements 4.1, 4.8
        await fc.assert(
            fc.asyncProperty(
                fc.array(
                    fc.record({ ts: fc.integer(), t: fc.string() }),
                    { minLength: 2, maxLength: 50 },
                ),
                async (eventInputs) => {
                    const tmpDir = mkdtempSync(join(tmpdir(), 'pbt-p4-'));
                    try {
                        const store = new JsonlStore(tmpDir);
                        const sessId = store.openSession('proj', { peerRole: 'vite-plugin' });

                        for (const ev of eventInputs) {
                            store.append(sessId, { ts: ev.ts, t: ev.t });
                        }
                        await store.flush();

                        const events = store.tail(sessId, { n: eventInputs.length });
                        expect(events).toHaveLength(eventInputs.length);

                        for (let i = 0; i < events.length; i++) {
                            expect(events[i].seq).toBeGreaterThanOrEqual(0);
                            if (i > 0) {
                                expect(events[i].seq).toBe((events[i - 1].seq as number) + 1);
                            }
                        }

                        await store.close();
                    } finally {
                        cleanup(tmpDir);
                    }
                },
            ),
            { numRuns: 100 },
        );
    });
});

// Feature: persistence, Property 5: Dual-write invariant
describe('Property 5: Dual-write invariant', () => {
    it('an event appended with a tabId appears in both session and tab timelines with identical fields', async () => {
        // Validates: Requirements 4.3, 4.4
        await fc.assert(
            fc.asyncProperty(
                fc.record({ ts: fc.integer(), t: fc.string(), tab: fc.string({ minLength: 1 }) }),
                async (eventInput) => {
                    const tmpDir = mkdtempSync(join(tmpdir(), 'pbt-p5-'));
                    try {
                        const store = new JsonlStore(tmpDir);
                        const sessId = store.openSession('proj', { peerRole: 'vite-plugin' });
                        store.openTab(sessId, { id: eventInput.tab });
                        store.append(sessId, { ts: eventInput.ts, t: eventInput.t, load: 'L1' }, eventInput.tab);
                        await store.flush();

                        const sessEvents = store.tail(sessId);
                        const tabEvents = store.tail(sessId, {}, eventInput.tab);

                        expect(sessEvents).toHaveLength(1);
                        expect(tabEvents).toHaveLength(1);

                        // Both timelines should have identical ts, t, and d fields
                        expect(sessEvents[0].ts).toBe(tabEvents[0].ts);
                        expect(sessEvents[0].t).toBe(tabEvents[0].t);
                        expect(sessEvents[0].d).toEqual(tabEvents[0].d);

                        await store.close();
                    } finally {
                        cleanup(tmpDir);
                    }
                },
            ),
            { numRuns: 100 },
        );
    });
});

// Feature: persistence, Property 6: Session open/get round-trip
describe('Property 6: Session open/get round-trip', () => {
    it('getSession returns a SessionMeta with matching id and projectId for any openSession call', async () => {
        // Validates: Requirements 2.1, 2.5, 12.5
        await fc.assert(
            fc.asyncProperty(
                fc.tuple(
                    fc.string({ minLength: 1 }),
                    fc.constantFrom('vite-plugin', 'webpack-plugin'),
                ),
                async ([projectId, peerRole]) => {
                    const tmpDir = mkdtempSync(join(tmpdir(), 'pbt-p6-'));
                    try {
                        const store = new JsonlStore(tmpDir);
                        const sessId = store.openSession(projectId, { peerRole });

                        const meta = store.getSession(sessId);
                        expect(meta).toBeDefined();
                        expect(meta!.id).toBe(sessId);
                        expect(meta!.projectId).toBe(projectId);

                        await store.close();
                    } finally {
                        cleanup(tmpDir);
                    }
                },
            ),
            { numRuns: 100 },
        );
    });
});

// ── WriteQueue Unit Tests ────────────────────────────────────────────────────

describe('WriteQueue', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = mkdtempSync(join(tmpdir(), 'write-queue-test-'));
    });

    afterEach(() => {
        try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    });

    // ── Test 1: Events enqueued before flush appear in file after drain() ──

    it('events enqueued before flush appear in file after drain()', async () => {
        const queue = new WriteQueue();
        const filePath = join(tmpDir, 'timeline.jsonl');
        const sessionId = 'sess-1';

        queue.enqueue(filePath, sessionId, JSON.stringify({ ts: 1000, t: 'log', d: { msg: 'a' } }));
        queue.enqueue(filePath, sessionId, JSON.stringify({ ts: 2000, t: 'err', d: { msg: 'b' } }));
        queue.enqueue(filePath, sessionId, JSON.stringify({ ts: 3000, t: 'hmr', d: { msg: 'c' } }));

        await queue.drain();

        const content = readFileSync(filePath, 'utf-8');
        const lines = content.split('\n').filter((l) => l.trim());

        expect(lines).toHaveLength(3);

        const events = lines.map((l) => JSON.parse(l));
        expect(events[0].t).toBe('log');
        expect(events[1].t).toBe('err');
        expect(events[2].t).toBe('hmr');

        // Verify seq numbers are assigned in order starting from 0
        expect(events[0].seq).toBe(0);
        expect(events[1].seq).toBe(1);
        expect(events[2].seq).toBe(2);
    });

    it('all enqueued events are present in file after drain() with correct seq numbers', async () => {
        const queue = new WriteQueue();
        const filePath = join(tmpDir, 'timeline.jsonl');
        const sessionId = 'sess-2';
        const count = 10;

        for (let i = 0; i < count; i++) {
            queue.enqueue(filePath, sessionId, JSON.stringify({ ts: i * 100, t: 'log', d: { i } }));
        }

        await queue.drain();

        const content = readFileSync(filePath, 'utf-8');
        const lines = content.split('\n').filter((l) => l.trim());
        expect(lines).toHaveLength(count);

        const events = lines.map((l) => JSON.parse(l));
        for (let i = 0; i < count; i++) {
            expect(events[i].seq).toBe(i);
        }
    });

    // ── Test 2: Failed flush → seq numbers not reused, server continues ───

    it('failed flush does not throw and seq numbers are not reused', async () => {
        const queue = new WriteQueue();
        // Use a path in a non-existent directory to force a write failure
        const badPath = join(tmpDir, 'nonexistent-dir', 'timeline.jsonl');
        const goodPath = join(tmpDir, 'timeline.jsonl');
        const sessionId = 'sess-3';

        // Enqueue 3 events to the bad path — these will fail to write
        queue.enqueue(badPath, sessionId, JSON.stringify({ ts: 1000, t: 'log', d: {} }));
        queue.enqueue(badPath, sessionId, JSON.stringify({ ts: 2000, t: 'log', d: {} }));
        queue.enqueue(badPath, sessionId, JSON.stringify({ ts: 3000, t: 'log', d: {} }));

        // drain() should not throw even though the write will fail
        await expect(queue.drain()).resolves.toBeUndefined();

        // Seq counter should be at 3 (not reset to 0)
        expect(queue.getSeq(sessionId)).toBe(3);

        // Enqueue more events to a valid path
        queue.enqueue(goodPath, sessionId, JSON.stringify({ ts: 4000, t: 'log', d: {} }));
        queue.enqueue(goodPath, sessionId, JSON.stringify({ ts: 5000, t: 'log', d: {} }));

        await queue.drain();

        // Seq counter should now be at 5
        expect(queue.getSeq(sessionId)).toBe(5);

        // The second batch should have seq numbers continuing from 3 (not restarting from 0)
        const content = readFileSync(goodPath, 'utf-8');
        const lines = content.split('\n').filter((l) => l.trim());
        expect(lines).toHaveLength(2);

        const events = lines.map((l) => JSON.parse(l));
        expect(events[0].seq).toBe(3);
        expect(events[1].seq).toBe(4);
    });

    it('server continues after flush failure — subsequent enqueues work normally', async () => {
        const queue = new WriteQueue();
        const badPath = join(tmpDir, 'no-such-dir', 'file.jsonl');
        const goodPath = join(tmpDir, 'good.jsonl');
        const sessionId = 'sess-4';

        queue.enqueue(badPath, sessionId, JSON.stringify({ ts: 1, t: 'log', d: {} }));
        await queue.drain(); // fails silently

        // Queue is still usable
        queue.enqueue(goodPath, sessionId, JSON.stringify({ ts: 2, t: 'log', d: {} }));
        await queue.drain();

        const content = readFileSync(goodPath, 'utf-8');
        const lines = content.split('\n').filter((l) => l.trim());
        expect(lines).toHaveLength(1);
        // seq should be 1 (not 0), because the failed batch consumed seq 0
        expect(JSON.parse(lines[0]).seq).toBe(1);
    });

    // ── Test 3: drain() on close flushes all pending events ───────────────

    it('drain() flushes all pending events without waiting for the timer', async () => {
        const queue = new WriteQueue();
        const filePath = join(tmpDir, 'timeline.jsonl');
        const sessionId = 'sess-5';

        queue.enqueue(filePath, sessionId, JSON.stringify({ ts: 1000, t: 'log', d: { msg: 'first' } }));
        queue.enqueue(filePath, sessionId, JSON.stringify({ ts: 2000, t: 'log', d: { msg: 'second' } }));
        queue.enqueue(filePath, sessionId, JSON.stringify({ ts: 3000, t: 'log', d: { msg: 'third' } }));

        // Call drain() immediately — should not wait for the 16ms timer
        await queue.drain();

        const content = readFileSync(filePath, 'utf-8');
        const lines = content.split('\n').filter((l) => l.trim());

        // All 3 events must be on disk
        expect(lines).toHaveLength(3);
        const events = lines.map((l) => JSON.parse(l));
        expect(events[0].d.msg).toBe('first');
        expect(events[1].d.msg).toBe('second');
        expect(events[2].d.msg).toBe('third');
    });

    it('drain() is idempotent — calling it twice does not duplicate events', async () => {
        const queue = new WriteQueue();
        const filePath = join(tmpDir, 'timeline.jsonl');
        const sessionId = 'sess-6';

        queue.enqueue(filePath, sessionId, JSON.stringify({ ts: 1000, t: 'log', d: {} }));
        queue.enqueue(filePath, sessionId, JSON.stringify({ ts: 2000, t: 'log', d: {} }));

        await queue.drain();
        await queue.drain(); // second drain on empty queue should be a no-op

        const content = readFileSync(filePath, 'utf-8');
        const lines = content.split('\n').filter((l) => l.trim());
        expect(lines).toHaveLength(2);
    });

    it('drain() flushes events enqueued across multiple file paths', async () => {
        const queue = new WriteQueue();
        const fileA = join(tmpDir, 'session.jsonl');
        const fileB = join(tmpDir, 'tab.jsonl');
        const sessionId = 'sess-7';

        queue.enqueue(fileA, sessionId, JSON.stringify({ ts: 1000, t: 'log', d: {} }));
        queue.enqueue(fileB, sessionId, JSON.stringify({ ts: 1000, t: 'log', d: {} }));
        queue.enqueue(fileA, sessionId, JSON.stringify({ ts: 2000, t: 'err', d: {} }));

        await queue.drain();

        const linesA = readFileSync(fileA, 'utf-8').split('\n').filter((l) => l.trim());
        const linesB = readFileSync(fileB, 'utf-8').split('\n').filter((l) => l.trim());

        expect(linesA).toHaveLength(2);
        expect(linesB).toHaveLength(1);
    });
});

// ── Property-Based Tests: Tasks 13.1–13.6 ────────────────────────────────────

// Feature: persistence, Property 8: session.tail type filter correctness
describe('Property 8: session.tail type filter correctness', () => {
    it('tail with a single type filter returns only events of that type', async () => {
        // Validates: Requirements 8.3, 8.7
        await fc.assert(
            fc.asyncProperty(
                fc.array(
                    fc.record({ ts: fc.integer(), t: fc.constantFrom('log', 'err', 'req') }),
                    { minLength: 1, maxLength: 30 },
                ),
                async (eventInputs) => {
                    const tmpDir = mkdtempSync(join(tmpdir(), 'pbt-p8-'));
                    try {
                        const store = new JsonlStore(tmpDir);
                        const sessId = store.openSession('proj', { peerRole: 'vite-plugin' });

                        for (const ev of eventInputs) {
                            store.append(sessId, { ts: ev.ts, t: ev.t });
                        }
                        await store.flush();

                        // Test each type filter individually
                        for (const filterType of ['log', 'err', 'req'] as const) {
                            const results = store.tail(sessId, { type: filterType, n: eventInputs.length });
                            // Every returned event must have the requested type
                            for (const ev of results) {
                                expect(ev.t).toBe(filterType);
                            }
                            // No event with a different type should appear
                            const wrongType = results.find((ev) => ev.t !== filterType);
                            expect(wrongType).toBeUndefined();
                        }

                        await store.close();
                    } finally {
                        cleanup(tmpDir);
                    }
                },
            ),
            { numRuns: 100 },
        );
    });

    it('tail with an array type filter returns only events whose type is in the array', async () => {
        // Validates: Requirements 8.3, 8.7
        await fc.assert(
            fc.asyncProperty(
                fc.array(
                    fc.record({ ts: fc.integer(), t: fc.constantFrom('log', 'err', 'req') }),
                    { minLength: 1, maxLength: 30 },
                ),
                async (eventInputs) => {
                    const tmpDir = mkdtempSync(join(tmpdir(), 'pbt-p8b-'));
                    try {
                        const store = new JsonlStore(tmpDir);
                        const sessId = store.openSession('proj', { peerRole: 'vite-plugin' });

                        for (const ev of eventInputs) {
                            store.append(sessId, { ts: ev.ts, t: ev.t });
                        }
                        await store.flush();

                        const filterTypes: Array<'log' | 'err'> = ['log', 'err'];
                        const results = store.tail(sessId, { type: filterTypes, n: eventInputs.length });

                        // Every returned event must have a type in the filter array
                        for (const ev of results) {
                            expect(filterTypes).toContain(ev.t);
                        }
                        // No event with type 'req' should appear
                        const wrongType = results.find((ev) => ev.t === 'req');
                        expect(wrongType).toBeUndefined();

                        await store.close();
                    } finally {
                        cleanup(tmpDir);
                    }
                },
            ),
            { numRuns: 100 },
        );
    });
});

// Feature: persistence, Property 9: session.search substring correctness
describe('Property 9: session.search substring correctness', () => {
    it('search returns only events whose JSON line contains the query as a case-insensitive substring', async () => {
        // Validates: Requirements 8.4
        await fc.assert(
            fc.asyncProperty(
                fc.tuple(
                    fc.array(
                        fc.record({ ts: fc.integer(), t: fc.string(), d: fc.jsonValue() }),
                        { minLength: 1, maxLength: 20 },
                    ),
                    fc.string({ minLength: 1 }),
                ),
                async ([eventInputs, query]) => {
                    const tmpDir = mkdtempSync(join(tmpdir(), 'pbt-p9-'));
                    try {
                        const store = new JsonlStore(tmpDir);
                        const sessId = store.openSession('proj', { peerRole: 'vite-plugin' });

                        for (const ev of eventInputs) {
                            store.append(sessId, { ts: ev.ts, t: ev.t, d: ev.d });
                        }
                        await store.flush();

                        const results = store.search(sessId, query, { limit: eventInputs.length + 10 });
                        const lowerQuery = query.toLowerCase();

                        // Every returned event's JSON line must contain the query
                        for (const ev of results) {
                            const line = JSON.stringify(ev);
                            expect(line.toLowerCase()).toContain(lowerQuery);
                        }

                        // No event whose line does NOT contain the query should appear
                        for (const ev of results) {
                            const line = JSON.stringify(ev);
                            expect(line.toLowerCase().includes(lowerQuery)).toBe(true);
                        }

                        await store.close();
                    } finally {
                        cleanup(tmpDir);
                    }
                },
            ),
            { numRuns: 100 },
        );
    });
});

// Feature: persistence, Property 10: Purge age-based deletion
describe('Property 10: Purge age-based deletion', () => {
    it('purge deletes sessions older than maxAgeDays and retains sessions within the window', async () => {
        // Validates: Requirements 10.2
        await fc.assert(
            fc.asyncProperty(
                fc.array(fc.integer({ min: 1, max: 30 }), { minLength: 1, maxLength: 10 }),
                async (daysAgoList) => {
                    const tmpDir = mkdtempSync(join(tmpdir(), 'pbt-p10-'));
                    try {
                        const store = new JsonlStore(tmpDir);
                        const maxAgeDays = 7;
                        const now = Date.now();
                        const sessionIds: string[] = [];

                        // Create sessions and backdate their meta.json
                        for (const daysAgo of daysAgoList) {
                            const sessId = store.openSession('proj', { peerRole: 'vite-plugin' });
                            sessionIds.push(sessId);

                            // Backdate the session meta
                            const meta = store.getSession(sessId)!;
                            meta.startedAt = now - daysAgo * 86400000;
                            const sessDir = join(tmpDir, 'proj', 'sessions', sessId);
                            writeFileSync(join(sessDir, 'meta.json'), JSON.stringify(meta));
                        }

                        store.purge({ maxAgeDays, maxSessionsPerProject: 1000 });

                        // Verify: sessions strictly older than maxAgeDays should be deleted.
                        // Sessions at exactly maxAgeDays boundary may be deleted due to timing
                        // (the 'now' in purge() is slightly later than when we set startedAt),
                        // so we only assert on sessions clearly within or clearly outside the window.
                        for (let i = 0; i < daysAgoList.length; i++) {
                            const daysAgo = daysAgoList[i];
                            const sessId = sessionIds[i];
                            const meta = store.getSession(sessId);

                            if (daysAgo > maxAgeDays) {
                                // Clearly older — must be deleted
                                expect(meta).toBeUndefined();
                            } else if (daysAgo < maxAgeDays) {
                                // Clearly within window — must be retained
                                expect(meta).toBeDefined();
                            }
                            // daysAgo === maxAgeDays: boundary case, skip assertion due to timing
                        }

                        await store.close();
                    } finally {
                        cleanup(tmpDir);
                    }
                },
            ),
            { numRuns: 100 },
        );
    });
});

// Feature: persistence, Property 11: Purge count-based deletion
describe('Property 11: Purge count-based deletion', () => {
    it('purge retains exactly the M most recent sessions when count exceeds maxSessionsPerProject', async () => {
        // Validates: Requirements 10.3
        await fc.assert(
            fc.asyncProperty(
                fc.integer({ min: 1, max: 20 }),
                async (sessionCount) => {
                    const tmpDir = mkdtempSync(join(tmpdir(), 'pbt-p11-'));
                    try {
                        const store = new JsonlStore(tmpDir);
                        const maxSessionsPerProject = Math.max(1, Math.floor(sessionCount / 2));
                        const now = Date.now();
                        const sessionIds: string[] = [];
                        const startedAts: number[] = [];

                        // Create sessions with distinct startedAt timestamps
                        for (let i = 0; i < sessionCount; i++) {
                            const sessId = store.openSession('proj', { peerRole: 'vite-plugin' });
                            sessionIds.push(sessId);

                            // Assign distinct startedAt values (older sessions have smaller timestamps)
                            const startedAt = now - (sessionCount - i) * 1000;
                            startedAts.push(startedAt);

                            const meta = store.getSession(sessId)!;
                            meta.startedAt = startedAt;
                            const sessDir = join(tmpDir, 'proj', 'sessions', sessId);
                            writeFileSync(join(sessDir, 'meta.json'), JSON.stringify(meta));
                        }

                        // Purge with a large maxAgeDays so only count-based deletion applies
                        store.purge({ maxAgeDays: 365, maxSessionsPerProject });

                        const remaining = store.listSessions('proj', 1000);
                        expect(remaining.length).toBeLessThanOrEqual(maxSessionsPerProject);

                        // The retained sessions should be the most recent ones
                        if (remaining.length > 0) {
                            // Sort by startedAt descending — most recent first
                            const sortedByRecency = [...sessionIds]
                                .map((id, idx) => ({ id, startedAt: startedAts[idx] }))
                                .sort((a, b) => b.startedAt - a.startedAt)
                                .slice(0, maxSessionsPerProject)
                                .map((s) => s.id);

                            for (const retainedSess of remaining) {
                                expect(sortedByRecency).toContain(retainedSess.id);
                            }
                        }

                        await store.close();
                    } finally {
                        cleanup(tmpDir);
                    }
                },
            ),
            { numRuns: 100 },
        );
    });
});

// Feature: persistence, Property 12: Recording purge preserves timeline
describe('Property 12: Recording purge preserves timeline', () => {
    it('purge deletes recording.jsonl but preserves timeline.jsonl and the tab directory', async () => {
        // Validates: Requirements 10.4, 11.3, 11.4
        const { writeFileSync: wfs, utimesSync } = await import('node:fs');
        const { existsSync: efs } = await import('node:fs');

        await fc.assert(
            fc.asyncProperty(
                fc.integer({ min: 1, max: 10 }),
                async (daysAgo) => {
                    const tmpDir = mkdtempSync(join(tmpdir(), 'pbt-p12-'));
                    try {
                        const store = new JsonlStore(tmpDir);
                        const sessId = store.openSession('proj', { peerRole: 'vite-plugin' });
                        store.openTab(sessId, { id: 'tab-1' });

                        // Write a timeline event and a recording chunk
                        store.append(sessId, { ts: Date.now(), t: 'log', load: 'L1', d: {} }, 'tab-1');
                        store.appendRecording(sessId, 'tab-1', [{ type: 4, data: {} }]);
                        await store.flush();

                        // Backdate the recording.jsonl mtime to simulate an old recording
                        const projectId = 'proj';
                        const tabDir = join(tmpDir, projectId, 'sessions', sessId, 'tabs', 'tab-1');
                        const recordingPath = join(tabDir, 'recording.jsonl');
                        const timelinePath = join(tabDir, 'timeline.jsonl');

                        // Set mtime to daysAgo days in the past
                        const oldTime = new Date(Date.now() - daysAgo * 86400000);
                        if (efs(recordingPath)) {
                            utimesSync(recordingPath, oldTime, oldTime);
                        }

                        // Purge with recordingRetentionDays less than daysAgo
                        const recordingRetentionDays = Math.max(0, daysAgo - 1);
                        store.purge({
                            maxAgeDays: 365,
                            maxSessionsPerProject: 1000,
                            recordingRetentionDays,
                        });

                        // recording.jsonl should be deleted (it's older than retention)
                        if (daysAgo > recordingRetentionDays) {
                            expect(efs(recordingPath)).toBe(false);
                        }

                        // timeline.jsonl must still exist
                        expect(efs(timelinePath)).toBe(true);

                        // The tab directory itself must still exist
                        expect(efs(tabDir)).toBe(true);

                        await store.close();
                    } finally {
                        cleanup(tmpDir);
                    }
                },
            ),
            { numRuns: 100 },
        );
    });
});

// Feature: persistence, Property 7: Tab metadata schema completeness
describe('Property 7: Tab metadata schema completeness', () => {
    it('openTab writes meta.json with required fields and optional fields iff provided', async () => {
        // Validates: Requirements 3.3, 3.6
        const { readFileSync: rfs, existsSync: efs } = await import('node:fs');

        await fc.assert(
            fc.asyncProperty(
                fc.record({
                    id: fc.string({ minLength: 1 }),
                    url: fc.option(fc.string(), { nil: undefined }),
                    title: fc.option(fc.string(), { nil: undefined }),
                    userAgent: fc.option(fc.string(), { nil: undefined }),
                }),
                async (tabInput) => {
                    const tmpDir = mkdtempSync(join(tmpdir(), 'pbt-p7-'));
                    try {
                        const store = new JsonlStore(tmpDir);
                        const sessId = store.openSession('proj', { peerRole: 'vite-plugin' });

                        // Build the tab object — only include optional fields if they were generated
                        const tabArg: { id: string; url?: string; title?: string; userAgent?: string } = {
                            id: tabInput.id,
                        };
                        if (tabInput.url !== undefined) tabArg.url = tabInput.url;
                        if (tabInput.title !== undefined) tabArg.title = tabInput.title;
                        if (tabInput.userAgent !== undefined) tabArg.userAgent = tabInput.userAgent;

                        store.openTab(sessId, tabArg);

                        // Read the written meta.json from disk
                        const sanitizedTabId = tabInput.id.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 64);
                        const metaPath = join(
                            tmpDir,
                            'proj',
                            'sessions',
                            sessId,
                            'tabs',
                            sanitizedTabId,
                            'meta.json',
                        );

                        expect(efs(metaPath)).toBe(true);
                        const meta = JSON.parse(rfs(metaPath, 'utf-8'));

                        // Required fields must be present and non-null
                        expect(meta.id).toBeDefined();
                        expect(meta.id).not.toBeNull();
                        expect(meta.sessionId).toBeDefined();
                        expect(meta.sessionId).not.toBeNull();
                        expect(meta.connectedAt).toBeDefined();
                        expect(meta.connectedAt).not.toBeNull();

                        // sessionId must match the session
                        expect(meta.sessionId).toBe(sessId);

                        // Optional fields: present iff provided to openTab
                        if (tabInput.url !== undefined) {
                            expect(meta.url).toBeDefined();
                            expect(meta.url).toBe(tabInput.url);
                        } else {
                            expect(meta.url).toBeUndefined();
                        }

                        if (tabInput.title !== undefined) {
                            expect(meta.title).toBeDefined();
                            expect(meta.title).toBe(tabInput.title);
                        } else {
                            expect(meta.title).toBeUndefined();
                        }

                        if (tabInput.userAgent !== undefined) {
                            expect(meta.userAgent).toBeDefined();
                            expect(meta.userAgent).toBe(tabInput.userAgent);
                        } else {
                            expect(meta.userAgent).toBeUndefined();
                        }

                        await store.close();
                    } finally {
                        cleanup(tmpDir);
                    }
                },
            ),
            { numRuns: 100 },
        );
    });
});
