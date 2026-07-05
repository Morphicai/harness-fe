import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as fc from 'fast-check';
import { randomUUID } from 'node:crypto';
import { JsonlStore, sanitizeId } from './JsonlStore.js';
import { WriteQueue } from './WriteQueue.js';

/** Helper: create a fresh store + temp dir */
function makeStore(opts?: { recordingChunkBytes?: number; timelineChunkBytes?: number }) {
    const dir = mkdtempSync(join(tmpdir(), 'harness-store-test-'));
    const store = new JsonlStore(dir, opts);
    return { store, dir };
}

/**
 * Store whose chunk files rotate on every line — each recording chunk / timeline
 * event lands in its own `NNNNNN.jsonl`. Used by retention tests so whole-file
 * eviction operates at single-chunk granularity (harness-fe#171).
 */
function makePerChunkStore() {
    return makeStore({ recordingChunkBytes: 1, timelineChunkBytes: 1 });
}

function cleanup(dir: string) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

/**
 * Helper: open a session the v0.4.0 way.
 * Returns a sessionId and the tabId used so callers can reference them.
 */
function openSession(store: JsonlStore, projectId: string, tabId?: string): { sessionId: string; tabId: string } {
    const resolvedTabId = tabId ?? `tab-${randomUUID().slice(0, 8)}`;
    const sessionId = randomUUID();
    store.upsertTab(resolvedTabId, { connectedAt: Date.now() });
    store.upsertSession(sessionId, {
        tabId: resolvedTabId,
        startedAt: Date.now(),
        participants: [{ projectId, joinedAt: Date.now() }],
    });
    return { sessionId, tabId: resolvedTabId };
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

    it('upsertSession returns a SessionMeta with matching id', () => {
        const { sessionId } = openSession(store, 'my-project');
        const meta = store.getSession(sessionId);
        expect(meta).toBeDefined();
        expect(meta!.id).toBe(sessionId);
    });

    it('lists projects after opening a build', () => {
        store.openBuild('proj-a', { bundler: 'vite' });
        store.openBuild('proj-b', { bundler: 'webpack' });
        const projects = store.listProjects();
        expect(projects.map((p) => p.id)).toContain('proj-a');
        expect(projects.map((p) => p.id)).toContain('proj-b');
    });

    it('lists sessions for a project', () => {
        const { sessionId: s1 } = openSession(store, 'proj');
        const { sessionId: s2 } = openSession(store, 'proj');
        const sessions = store.listSessions({ projectId: 'proj' });
        const ids = sessions.map((s) => s.id);
        expect(ids).toContain(s1);
        expect(ids).toContain(s2);
    });

    it('closes a session and records endedAt', () => {
        const { sessionId } = openSession(store, 'proj');
        store.closeSession(sessionId);
        const meta = store.getSession(sessionId);
        expect(meta?.endedAt).toBeDefined();
        expect(meta!.endedAt!).toBeGreaterThan(0);
    });

    it('upsertTab and closeTab roundtrip', () => {
        store.upsertTab('tab-1', { connectedAt: Date.now(), userAgent: 'Chrome' });
        store.closeTab('tab-1');
        const meta = store.getTab('tab-1');
        expect(meta?.disconnectedAt).toBeDefined();
    });

    // ── Write + tail ─────────────────────────────────────────────────────

    it('appends events and tails them back', async () => {
        const { sessionId } = openSession(store, 'proj');
        store.appendEvent(sessionId, { ts: 1000, t: 'log', d: { level: 'info', args: ['hello'] } });
        store.appendEvent(sessionId, { ts: 2000, t: 'err', d: { message: 'boom' } });
        store.appendEvent(sessionId, { ts: 3000, t: 'hmr', d: { file: 'App.tsx' } });

        await store.flush();
        const events = store.tail(sessionId);
        expect(events).toHaveLength(3);
        expect(events[0].t).toBe('log');
        expect(events[2].t).toBe('hmr');
    });

    it('tail filters by type', async () => {
        const { sessionId } = openSession(store, 'proj');
        store.appendEvent(sessionId, { ts: 1000, t: 'log', d: {} });
        store.appendEvent(sessionId, { ts: 2000, t: 'err', d: { message: 'oops' } });
        store.appendEvent(sessionId, { ts: 3000, t: 'log', d: {} });

        await store.flush();
        const errors = store.tail(sessionId, { type: 'err' });
        expect(errors).toHaveLength(1);
        expect(errors[0].t).toBe('err');
    });

    it('tail filters by multiple types', async () => {
        const { sessionId } = openSession(store, 'proj');
        store.appendEvent(sessionId, { ts: 1000, t: 'log', d: {} });
        store.appendEvent(sessionId, { ts: 2000, t: 'err', d: {} });
        store.appendEvent(sessionId, { ts: 3000, t: 'hmr', d: {} });
        store.appendEvent(sessionId, { ts: 4000, t: 'cmd', d: {} });

        await store.flush();
        const result = store.tail(sessionId, { type: ['err', 'hmr'] });
        expect(result).toHaveLength(2);
        expect(result.map((e) => e.t).sort()).toEqual(['err', 'hmr']);
    });

    it('tail respects n limit', async () => {
        const { sessionId } = openSession(store, 'proj');
        for (let i = 0; i < 20; i++) {
            store.appendEvent(sessionId, { ts: i * 100, t: 'log', d: { i } });
        }
        await store.flush();
        const result = store.tail(sessionId, { n: 5 });
        expect(result).toHaveLength(5);
        // Should be the last 5
        expect((result[4].d as { i: number }).i).toBe(19);
    });

    it('appendEventBatch writes all events', async () => {
        const { sessionId } = openSession(store, 'proj');
        store.appendEventBatch(sessionId, [
            { ts: 1000, t: 'log', d: { msg: 'a' } },
            { ts: 2000, t: 'log', d: { msg: 'b' } },
            { ts: 3000, t: 'err', d: { message: 'c' } },
        ]);
        await store.flush();
        const events = store.tail(sessionId);
        expect(events).toHaveLength(3);
    });

    it('appendEvent drops oversized events silently', async () => {
        const { sessionId } = openSession(store, 'proj');
        // 300 KB — above the 256 KB per-event ceiling
        const huge = 'A'.repeat(300 * 1024);
        store.appendEvent(sessionId, { ts: Date.now(), t: 'log', d: { msg: huge } });
        await store.flush();
        expect(store.tail(sessionId)).toHaveLength(0);
    });

    it('appendRecording drops chunks larger than the rrweb byte limit', async () => {
        const { sessionId } = openSession(store, 'proj');
        // 3 MB chunk — above the 2 MB ceiling.
        const fatChunk = {
            chunkId: 'c1',
            startTs: 1,
            endTs: 2,
            eventCount: 1,
            events: [{ blob: 'B'.repeat(3 * 1024 * 1024) }],
        };
        store.appendRecording(sessionId, fatChunk);
        await store.flush();
        expect(store.listRecordings(sessionId)).toHaveLength(0);
    });

    it('appends rrweb recording chunks', async () => {
        const { sessionId } = openSession(store, 'proj');
        store.appendRecording(sessionId, {
            chunkId: 'c1', startTs: 1000, endTs: 1200, eventCount: 2,
            events: [{ type: 4, data: {} }, { type: 3, data: {} }],
        });
        store.appendRecording(sessionId, {
            chunkId: 'c2', startTs: 2000, endTs: 2100, eventCount: 1,
            events: [{ type: 3, data: {} }],
        });
        await store.flush();
        const recordings = store.listRecordings(sessionId);
        expect(recordings).toHaveLength(2);
    });

    it('lists recording chunks in chronological order', async () => {
        const { sessionId } = openSession(store, 'proj', 'tab-1');
        store.appendRecording(sessionId, {
            chunkId: 'rrc_1',
            startTs: 1000,
            endTs: 1500,
            eventCount: 2,
            events: [{ type: 4 }, { type: 3 }],
        });
        store.appendRecording(sessionId, {
            chunkId: 'rrc_2',
            startTs: 2000,
            endTs: 2500,
            eventCount: 1,
            events: [{ type: 3 }],
        });

        await store.flush();
        const all = store.listRecordings(sessionId);
        expect(all).toHaveLength(2);
        expect(all[0].chunkId).toBe('rrc_1');
        expect(all[1].chunkId).toBe('rrc_2');
        // tabId is derived from sessionMeta.tabId
        expect(all[0].tabId).toBe('tab-1');
    });

    it('slices recording chunks by overlapping time window', async () => {
        const { sessionId } = openSession(store, 'proj', 'tab-1');
        store.appendRecording(sessionId, {
            chunkId: 'rrc_1',
            startTs: 1000,
            endTs: 1500,
            eventCount: 2,
            events: [{ type: 4 }, { type: 3 }],
        });
        store.appendRecording(sessionId, {
            chunkId: 'rrc_2',
            startTs: 2000,
            endTs: 2500,
            eventCount: 1,
            events: [{ type: 3 }],
        });

        await store.flush();
        const slice = store.sliceRecordings(sessionId, 1200, 2100);
        expect(slice).toHaveLength(2);
        expect(slice.map((chunk) => chunk.chunkId)).toEqual(['rrc_1', 'rrc_2']);
        expect(slice[0].events).toHaveLength(2);
        expect(store.sliceRecordings(sessionId, 2600, 3000)).toEqual([]);
    });

    it('reads recordings via the streaming line reader across buffer boundaries + unicode (harness-fe#166)', async () => {
        const { sessionId } = openSession(store, 'proj', 'tab-1');
        // Chunk with multibyte text and an embedded (JSON-escaped) newline — must
        // survive line splitting + UTF-8 decoding intact.
        const tricky = '日本語🎉 line-one\nline-two 末';
        store.appendRecording(sessionId, {
            chunkId: 'rrc_uni',
            startTs: 1000,
            endTs: 1100,
            eventCount: 1,
            events: [{ type: 3, data: { text: tricky } }],
        });
        // A ~1.5 MB chunk pushes the file past the 1 MB read buffer, forcing
        // forEachLineSync to stitch lines across multiple reads.
        store.appendRecording(sessionId, {
            chunkId: 'rrc_big',
            startTs: 2000,
            endTs: 2100,
            eventCount: 1,
            events: [{ type: 3, data: { blob: 'x'.repeat(1_500_000) } }],
        });
        await store.flush();

        const all = store.listRecordings(sessionId).map((c) => c.chunkId);
        expect(all).toEqual(['rrc_uni', 'rrc_big']);

        const slice = store.sliceRecordings(sessionId, 0, 3000);
        expect(slice.map((c) => c.chunkId)).toEqual(['rrc_uni', 'rrc_big']);
        // Unicode + embedded newline round-tripped correctly through streaming read.
        expect((slice[0].events[0] as any).data.text).toBe(tricky);
        expect((slice[1].events[0] as any).data.blob).toHaveLength(1_500_000);
    });

    it('reads a >1MB timeline via streaming — summary counts + search early-stop (harness-fe#166 timeline)', async () => {
        const { sessionId } = openSession(store, 'proj', 'tab-1');
        const filler = 'y'.repeat(600);
        const events = [];
        for (let i = 0; i < 2500; i++) {
            events.push({ ts: 1000 + i, t: i === 1234 ? 'err' : 'log', d: { args: [filler], i } });
        }
        store.appendEventBatch(sessionId, events as any);
        await store.flush();

        // summary streams the whole (>1MB) timeline without building one big string
        const sum = store.summary(sessionId);
        expect(sum.counts.log).toBe(2499);
        expect(sum.counts.err).toBe(1);

        // search streams + stops early once `limit` matches are collected
        const found = store.search(sessionId, 'yyy', { limit: 5 });
        expect(found).toHaveLength(5);
    });

    it('purge trims recording chunks by per-session count limit', async () => {
        const { store, dir } = makePerChunkStore(); // one chunk per file → file-granular eviction
        const { sessionId } = openSession(store, 'proj', 'tab-1');
        store.appendRecording(sessionId, {
            chunkId: 'rrc_1',
            startTs: Date.now() - 1000,
            endTs: Date.now() - 900,
            eventCount: 1,
            events: [{ type: 4 }],
        });
        store.appendRecording(sessionId, {
            chunkId: 'rrc_2',
            startTs: Date.now() - 800,
            endTs: Date.now() - 700,
            eventCount: 1,
            events: [{ type: 4 }],
        });
        store.appendRecording(sessionId, {
            chunkId: 'rrc_3',
            startTs: Date.now() - 600,
            endTs: Date.now() - 500,
            eventCount: 1,
            events: [{ type: 4 }],
        });

        await store.flush();
        const result = store.purge({
            maxAgeDays: 7,
            maxSessions: 20,
            recordingRetentionDays: 7,
            maxRecordingChunksPerSession: 2,
        });

        expect(result.recordingsDeleted).toBe(1);
        // Only the 2 newest chunks should remain
        const remaining = store.listRecordings(sessionId).map((chunk) => chunk.chunkId);
        expect(remaining).toEqual(['rrc_2', 'rrc_3']);
        await store.close();
        cleanup(dir);
    });

    it('purge prefers keeping marked chunks when configured', async () => {
        const { store, dir } = makePerChunkStore();
        const { sessionId } = openSession(store, 'proj', 'tab-1');
        const now = Date.now();
        // Marker event overlaps rrc_2
        store.appendEvent(sessionId, {
            ts: now - 450,
            t: 'rrweb:marker',
            d: { markerId: 'rrm_1', kind: 'error', label: 'boom' },
        });
        store.appendRecording(sessionId, {
            chunkId: 'rrc_1',
            startTs: now - 1000,
            endTs: now - 900,
            eventCount: 1,
            events: [{ type: 4 }],
        });
        store.appendRecording(sessionId, {
            chunkId: 'rrc_2',
            startTs: now - 600,
            endTs: now - 400,
            eventCount: 1,
            events: [{ type: 4 }],
        });
        store.appendRecording(sessionId, {
            chunkId: 'rrc_3',
            startTs: now - 300,
            endTs: now - 200,
            eventCount: 1,
            events: [{ type: 4 }],
        });

        await store.flush();
        const result = store.purge({
            maxAgeDays: 7,
            maxSessions: 20,
            recordingRetentionDays: 7,
            maxRecordingChunksPerSession: 2,
            preserveMarkedChunks: true,
        });

        expect(result.recordingsDeleted).toBe(1);
        const remaining = store.listRecordings(sessionId).map((chunk) => chunk.chunkId);
        // rrc_2 must survive (overlaps marker); rrc_1 is oldest and dropped
        expect(remaining).toEqual(['rrc_2', 'rrc_3']);
        await store.close();
        cleanup(dir);
    });

    it('age purge rescues the FullSnapshot baseline that surviving chunks need (harness-fe#160)', async () => {
        const { store, dir } = makePerChunkStore(); // each chunk → its own file; rescue spans files
        const { sessionId } = openSession(store, 'proj', 'tab-1');
        const now = Date.now();
        // Old baseline chunk (FullSnapshot type:2), well beyond the retention
        // window, followed by recent increments inside the window.
        store.appendRecording(sessionId, {
            chunkId: 'rrc_base',
            startTs: now - 600_000,
            endTs: now - 590_000,
            eventCount: 2,
            events: [{ type: 4 }, { type: 2 }], // Meta + FullSnapshot
        });
        store.appendRecording(sessionId, {
            chunkId: 'rrc_inc1',
            startTs: now - 950,
            endTs: now - 900,
            eventCount: 1,
            events: [{ type: 3 }], // increment, inside the window
        });
        store.appendRecording(sessionId, {
            chunkId: 'rrc_inc2',
            startTs: now - 600,
            endTs: now - 500,
            eventCount: 1,
            events: [{ type: 3 }],
        });

        await store.flush();
        // 1-second retention: the baseline is far older and would be age-evicted,
        // but the surviving increments depend on it.
        const result = store.purge({ recordingRetentionMs: 1000 });

        const remaining = store.listRecordings(sessionId).map((c) => c.chunkId);
        // Baseline is rescued and persisted in chronological order, ahead of the
        // increments it anchors.
        expect(remaining).toEqual(['rrc_base', 'rrc_inc1', 'rrc_inc2']);
        expect(result.recordingsDeleted).toBe(0);
        // The baseline stays on disk so replay assembly's lookback can still find
        // a FullSnapshot for the surviving window (replayCreate searches earlier
        // chunks, not just the requested window).
        expect(
            store.sliceRecordings(sessionId, 0, now).some((c) => c.events.some((e: any) => e?.type === 2)),
        ).toBe(true);
        await store.close();
        cleanup(dir);
    });

    it('age purge does NOT keep an old non-baseline chunk (rescue is baseline-specific)', async () => {
        const { store, dir } = makePerChunkStore();
        const { sessionId } = openSession(store, 'proj', 'tab-1');
        const now = Date.now();
        store.appendRecording(sessionId, {
            chunkId: 'rrc_old',
            startTs: now - 600_000,
            endTs: now - 590_000,
            eventCount: 1,
            events: [{ type: 3 }], // increment, no baseline
        });
        store.appendRecording(sessionId, {
            chunkId: 'rrc_new',
            startTs: now - 800,
            endTs: now - 400,
            eventCount: 2,
            events: [{ type: 4 }, { type: 2 }], // recent baseline survives on its own
        });

        await store.flush();
        const result = store.purge({ recordingRetentionMs: 1000 });

        const remaining = store.listRecordings(sessionId).map((c) => c.chunkId);
        expect(remaining).toEqual(['rrc_new']);
        expect(result.recordingsDeleted).toBe(1);
        await store.close();
        cleanup(dir);
    });

    it('recording prune leaves session timeline intact', async () => {
        const { store, dir } = makePerChunkStore();
        const { sessionId } = openSession(store, 'proj', 'tab-1');
        const now = Date.now();
        store.appendEvent(sessionId, { ts: now - 800, t: 'log', d: { args: ['hello'] } });
        store.appendEvent(sessionId, { ts: now - 500, t: 'err', d: { message: 'boom' } });
        store.appendEvent(sessionId, {
            ts: now - 450,
            t: 'rrweb:marker',
            d: { markerId: 'rrm_1', kind: 'error', label: 'boom' },
        });
        // Three rrweb chunks — purge will trim to 2.
        for (let i = 0; i < 3; i++) {
            store.appendRecording(sessionId, {
                chunkId: `c_${i}`,
                startTs: now - 1000 + i * 100,
                endTs: now - 900 + i * 100,
                eventCount: 1,
                events: [{ type: 4 }],
            });
        }
        await store.flush();

        const before = store.tail(sessionId, { n: 50 });
        const beforeMarkers = store.tail(sessionId, { n: 50, type: 'rrweb:marker' });

        const result = store.purge({ maxRecordingChunksPerSession: 2, preserveMarkedChunks: false });
        expect(result.recordingsDeleted).toBe(1);

        const after = store.tail(sessionId, { n: 50 });
        const afterMarkers = store.tail(sessionId, { n: 50, type: 'rrweb:marker' });
        expect(after).toEqual(before);
        expect(afterMarkers).toEqual(beforeMarkers);
        expect(afterMarkers).toHaveLength(1);
        await store.close();
        cleanup(dir);
    });

    // ── Chunk-file storage (harness-fe#171) ──────────────────────────────

    it('rotates recordings into numbered chunk files and reads merge across them', async () => {
        const { existsSync: efs, readdirSync: rdir } = await import('node:fs');
        const { store, dir } = makePerChunkStore(); // each chunk → its own file
        const { sessionId, tabId } = openSession(store, 'proj', 'tab-1');
        for (let i = 0; i < 5; i++) {
            store.appendRecording(sessionId, {
                chunkId: `c_${i}`, startTs: 1000 + i * 100, endTs: 1050 + i * 100,
                eventCount: 1, events: [{ type: i === 0 ? 2 : 3 }],
            });
        }
        await store.flush();

        const recDir = join(dir, 'sessions', sanitizeId(sessionId), 'recording');
        const files = rdir(recDir).filter((f) => f.endsWith('.jsonl')).sort();
        expect(files).toEqual(['000001.jsonl', '000002.jsonl', '000003.jsonl', '000004.jsonl', '000005.jsonl']);
        // every chunk landed whole in exactly one file (no split lines)
        expect(efs(join(dir, 'sessions', sanitizeId(sessionId), 'recording.jsonl'))).toBe(false);

        // reads merge across files, chronological
        expect(store.listRecordings(sessionId).map((c) => c.chunkId)).toEqual(['c_0', 'c_1', 'c_2', 'c_3', 'c_4']);
        const slice = store.sliceRecordings(sessionId, 1150, 1260); // overlaps c_1,c_2
        expect(slice.map((c) => c.chunkId)).toEqual(['c_1', 'c_2']);
        void tabId;
        await store.close();
        cleanup(dir);
    });

    it('reads a legacy single recording.jsonl merged with new chunk-dir files (migration compat)', async () => {
        const { writeFileSync: wf, mkdirSync: mkd } = await import('node:fs');
        const { store, dir } = makePerChunkStore();
        const { sessionId } = openSession(store, 'proj', 'tab-1');
        // Hand-write a legacy single file as it existed pre-#171.
        const sessDir = join(dir, 'sessions', sanitizeId(sessionId));
        mkd(sessDir, { recursive: true });
        wf(
            join(sessDir, 'recording.jsonl'),
            JSON.stringify({ chunkId: 'legacy', startTs: 10, endTs: 20, eventCount: 1, events: [{ type: 2 }] }) + '\n',
            'utf-8',
        );
        // New writes go to the chunk dir.
        store.appendRecording(sessionId, { chunkId: 'fresh', startTs: 100, endTs: 110, eventCount: 1, events: [{ type: 3 }] });
        await store.flush();

        // Legacy chunk is read as the oldest, ahead of the dir chunk.
        expect(store.listRecordings(sessionId).map((c) => c.chunkId)).toEqual(['legacy', 'fresh']);
        await store.close();
        cleanup(dir);
    });

    it('timeline trimming drops the OLDEST chunk files and keeps recent events (harness-fe#171)', async () => {
        const { store, dir } = makePerChunkStore(); // each event → its own file
        const { sessionId } = openSession(store, 'proj', 'tab-1');
        const now = Date.now();
        for (let i = 0; i < 30; i++) {
            store.appendEvent(sessionId, { ts: now - (30 - i) * 1000, t: 'log', d: { i } });
        }
        await store.flush();

        // Keep at most 5 timeline files — oldest dropped, recent kept.
        store.purge({ maxTimelineChunksPerSession: 5 });

        const recent = store.tail(sessionId, { n: 100 });
        // The newest events survive; the oldest (i=0) is gone.
        expect(recent.some((e) => (e.d as any).i === 29)).toBe(true);
        expect(recent.some((e) => (e.d as any).i === 0)).toBe(false);
        expect(recent.length).toBeLessThanOrEqual(6); // ~5 files × 1 event
        await store.close();
        cleanup(dir);
    });

    // ── Exports (replay) ─────────────────────────────────────────────────

    it('writeExport persists events and metadata, readable by id', async () => {
        const { sessionId, tabId } = openSession(store, 'proj', 'tab-1');
        const meta = store.writeExport({
            sessionId,
            tabId,
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
        const { sessionId, tabId } = openSession(store, 'proj', 'tab-1');
        const a = store.writeExport({ sessionId, tabId, since: 0, until: 1, startTs: 0, endTs: 1, chunkCount: 1, events: [{}, {}] });
        const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
        return (async () => {
            await sleep(5);
            const b = store.writeExport({ sessionId, tabId, since: 0, until: 1, startTs: 0, endTs: 1, chunkCount: 1, events: [{}, {}] });
            const all = store.listExports('proj');
            expect(all.map((m) => m.exportId)).toEqual([b.exportId, a.exportId]);
        })();
    });

    it('purge trims exports beyond the per-project count limit, oldest first', async () => {
        const { sessionId, tabId } = openSession(store, 'proj', 'tab-1');
        const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
        const exports: string[] = [];
        for (let i = 0; i < 4; i++) {
            const meta = store.writeExport({
                sessionId, tabId, since: 0, until: 1, startTs: 0, endTs: 1, chunkCount: 1, events: [{}, {}],
            });
            exports.push(meta.exportId);
            await sleep(3);
        }
        const result = store.purge({
            maxExportsPerProject: 2,
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
        const { sessionId, tabId } = openSession(store, 'proj', 'tab-1');
        const bigEvent = { type: 3, data: { payload: 'x'.repeat(900) } };
        const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
        const ids: string[] = [];
        for (let i = 0; i < 3; i++) {
            const meta = store.writeExport({
                sessionId, tabId, since: 0, until: 1, startTs: 0, endTs: 1, chunkCount: 1,
                events: [bigEvent, bigEvent],
            });
            ids.push(meta.exportId);
            await sleep(3);
        }
        const result = store.purge({ maxExportBytesPerProject: 2000 });
        expect(result.exportsDeleted).toBeGreaterThanOrEqual(1);
        const surviving = store.listExports('proj').map((m) => m.exportId);
        // newest survives
        expect(surviving[0]).toBe(ids[2]);
    });

    // ── Search ───────────────────────────────────────────────────────────

    it('searches events by substring', async () => {
        const { sessionId } = openSession(store, 'proj');
        store.appendEvent(sessionId, { ts: 1000, t: 'log', d: { args: ['hello world'] } });
        store.appendEvent(sessionId, { ts: 2000, t: 'log', d: { args: ['goodbye'] } });
        store.appendEvent(sessionId, { ts: 3000, t: 'err', d: { message: 'hello error' } });

        await store.flush();
        const results = store.search(sessionId, 'hello');
        expect(results).toHaveLength(2);
    });

    it('search filters by type', async () => {
        const { sessionId } = openSession(store, 'proj');
        store.appendEvent(sessionId, { ts: 1000, t: 'log', d: { args: ['hello'] } });
        store.appendEvent(sessionId, { ts: 2000, t: 'err', d: { message: 'hello error' } });

        await store.flush();
        const results = store.search(sessionId, 'hello', { type: 'err' });
        expect(results).toHaveLength(1);
        expect(results[0].t).toBe('err');
    });

    // ── Summary ──────────────────────────────────────────────────────────

    it('returns a session summary with counts', async () => {
        const { sessionId } = openSession(store, 'proj');
        store.appendEvent(sessionId, { ts: 1000, t: 'console', d: {} });
        store.appendEvent(sessionId, { ts: 2000, t: 'console', d: {} });
        store.appendEvent(sessionId, { ts: 3000, t: 'error', d: { message: 'boom' } });
        store.appendEvent(sessionId, { ts: 4000, t: 'cmd', d: {} });

        await store.flush();
        const s = store.summary(sessionId);
        expect(s.counts['console']).toBe(2);
        expect(s.counts['error']).toBe(1);
        expect(s.counts['cmd']).toBe(1);
        expect(s.lastError?.t).toBe('error');
        expect(s.lastActivity).toBe(4000);
    });

    it('lastError is populated for real-world error events (t: "error", not the stale "err")', async () => {
        const { sessionId } = openSession(store, 'proj');
        store.appendEvent(sessionId, { ts: 1000, t: 'console', d: {} });
        store.appendEvent(sessionId, { ts: 2000, t: 'error', d: { message: 'boom' } });

        await store.flush();
        const s = store.summary(sessionId);
        expect(s.lastError).toBeDefined();
        expect(s.lastError?.d).toMatchObject({ message: 'boom' });
    });

    // ── Notes ────────────────────────────────────────────────────────────

    it('writes and reads project notes', () => {
        store.upsertProject('proj', {});
        store.writeNote('proj', 'known_issues', 'Login button broken on Safari');
        store.writeNote('proj', 'architecture', 'Uses React 18 + Vite 7');

        const notes = store.listNotes('proj');
        expect(notes.map((n) => n.key)).toContain('known_issues');
        expect(notes.map((n) => n.key)).toContain('architecture');
    });

    it('returns latest value when same key written multiple times', () => {
        store.upsertProject('proj', {});
        store.writeNote('proj', 'status', 'v1');
        store.writeNote('proj', 'status', 'v2');

        const notes = store.listNotes('proj');
        const status = notes.find((n) => n.key === 'status');
        expect(status?.value).toBe('v2');
    });

    // ── Purge ────────────────────────────────────────────────────────────

    it('purge removes sessions older than maxAgeDays', async () => {
        const { sessionId } = openSession(store, 'proj');
        store.appendEvent(sessionId, { ts: Date.now(), t: 'log', d: {} });

        // Manually backdate the session meta to the new flat path
        const { writeFileSync: wfs } = await import('node:fs');
        const { join: pathJoin } = await import('node:path');
        const sessDir = pathJoin(dir, 'sessions', sanitizeId(sessionId));
        const meta = store.getSession(sessionId)!;
        meta.startedAt = Date.now() - 10 * 86400000; // 10 days ago
        wfs(pathJoin(sessDir, 'meta.json'), JSON.stringify(meta));

        const result = store.purge({ maxAgeDays: 7 });
        expect(result.sessionsDeleted).toBe(1);
    });

    it('purge keeps recent sessions', () => {
        openSession(store, 'proj');
        openSession(store, 'proj');

        const result = store.purge({ maxAgeDays: 7 });
        expect(result.sessionsDeleted).toBe(0);

        const remaining = store.listSessions({ projectId: 'proj' });
        expect(remaining).toHaveLength(2);
    });

    it('purge respects maxSessions (global cap)', () => {
        for (let i = 0; i < 5; i++) {
            openSession(store, 'proj');
        }
        const result = store.purge({ maxAgeDays: 365, maxSessions: 3 });
        expect(result.sessionsDeleted).toBe(2);
        expect(store.listSessions({ projectId: 'proj' })).toHaveLength(3);
    });

    // ── Startup recovery ──────────────────────────────────────────────────

    it('startup recovery: rebuilds sessionIndex from disk', async () => {
        const { sessionId: s1 } = openSession(store, 'proj');
        const { sessionId: s2 } = openSession(store, 'proj');
        store.closeSession(s1); // s1 has endedAt
        // s2 is left open (no endedAt)
        await store.close();

        // Create a new store instance pointing to the same directory
        const store2 = new JsonlStore(dir);

        const meta1 = store2.getSession(s1);
        const meta2 = store2.getSession(s2);

        expect(meta1).toBeDefined();
        expect(meta1!.id).toBe(s1);
        expect(meta2).toBeDefined();
        expect(meta2!.id).toBe(s2);

        await store2.close();
    });

    it('startup recovery: sets endedAt on orphaned sessions', async () => {
        const { sessionId: orphanId } = openSession(store, 'proj');
        const metaBefore = store.getSession(orphanId);
        expect(metaBefore?.endedAt).toBeUndefined();
        await store.close();

        const beforeRestart = Date.now();

        const store2 = new JsonlStore(dir);

        const metaAfter = store2.getSession(orphanId);
        expect(metaAfter).toBeDefined();
        expect(metaAfter!.endedAt).toBeDefined();
        expect(metaAfter!.endedAt!).toBeGreaterThanOrEqual(beforeRestart);

        await store2.close();
    });

    it('startup recovery: does not overwrite endedAt on already-closed sessions', async () => {
        const { sessionId: closedId } = openSession(store, 'proj');
        store.closeSession(closedId);
        const metaBefore = store.getSession(closedId);
        const originalEndedAt = metaBefore!.endedAt!;
        expect(originalEndedAt).toBeDefined();
        await store.close();

        const store2 = new JsonlStore(dir);

        const metaAfter = store2.getSession(closedId);
        expect(metaAfter).toBeDefined();
        expect(metaAfter!.endedAt).toBe(originalEndedAt);

        await store2.close();
    });

    it('startup recovery: handles multiple projects and sessions', async () => {
        const { sessionId: s1 } = openSession(store, 'proj-alpha');
        const { sessionId: s2 } = openSession(store, 'proj-beta');
        const { sessionId: s3 } = openSession(store, 'proj-alpha');
        store.closeSession(s1); // closed
        // s2 and s3 are orphaned
        await store.close();

        const store2 = new JsonlStore(dir);

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

// ── Project tree + build metadata ────────────────────────────────────────────

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

    it('subsequent upsertProject does NOT overwrite parentProjectId / displayName', () => {
        store.upsertProject('p1', { displayName: 'Parent', parentProjectId: 'root' });
        // A second upsert without parentProjectId should preserve existing values
        store.upsertProject('p1', { tags: ['new-tag'] });

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

    it('getProjectTree handles a 1000-deep chain without stack overflow', () => {
        for (let i = 0; i < 1000; i++) {
            const parent = i === 0 ? undefined : `p${i - 1}`;
            store.upsertProject(`p${i}`, parent ? { parentProjectId: parent } : {});
        }
        const tree = store.getProjectTree('p0');
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
        for (let i = 0; i < 5; i++) {
            store.upsertBuild('app', `b${i}`, { bundler: 'vite' });
            // Patch builtAt to force sortability — write directly to the NEW flat path
            const meta = store.getBuild('app', `b${i}`)!;
            const fixed = { ...meta, builtAt: 1_700_000_000_000 + i * 1000 };
            writeFileSync(
                join(dataDir, 'projects', 'app', 'builds', `b${i}`, 'meta.json'),
                JSON.stringify(fixed),
            );
        }
        expect(store.listBuilds('app')).toHaveLength(5);

        const result = store.purge({ maxBuildsPerProject: 2 });
        expect(result.buildsDeleted).toBe(3);

        const remaining = store.listBuilds('app').map((b) => b.id);
        expect(remaining.sort()).toEqual(['b3', 'b4']); // newest 2 kept
    });

    // ── Session participants (upsertSession merge semantics) ───────────────

    it('upsertSession merges participants without duplicates', () => {
        const sessionId = randomUUID();
        store.upsertTab('tab-merge', { connectedAt: Date.now() });
        store.upsertSession(sessionId, {
            tabId: 'tab-merge',
            startedAt: Date.now(),
            participants: [{ projectId: 'proj-a', joinedAt: Date.now() }],
        });
        // Second upsert adds a new participant
        store.upsertSession(sessionId, {
            tabId: 'tab-merge',
            startedAt: Date.now(),
            participants: [
                { projectId: 'proj-a', joinedAt: Date.now() }, // duplicate — must not double
                { projectId: 'proj-b', joinedAt: Date.now() }, // new
            ],
        });
        const meta = store.getSession(sessionId)!;
        expect(meta.participants.map((p) => p.projectId).sort()).toEqual(['proj-a', 'proj-b']);
    });

    it('listSessions filters by projectId', () => {
        const { sessionId: s1 } = openSession(store, 'proj-x');
        const { sessionId: s2 } = openSession(store, 'proj-y');

        const xSessions = store.listSessions({ projectId: 'proj-x' });
        const ySessions = store.listSessions({ projectId: 'proj-y' });

        expect(xSessions.map((s) => s.id)).toContain(s1);
        expect(xSessions.map((s) => s.id)).not.toContain(s2);
        expect(ySessions.map((s) => s.id)).toContain(s2);
    });

    it('listSessions filters by tabId', () => {
        const { sessionId: s1 } = openSession(store, 'proj', 'tab-A');
        const { sessionId: s2 } = openSession(store, 'proj', 'tab-B');

        const tabA = store.listSessions({ tabId: 'tab-A' });
        expect(tabA.map((s) => s.id)).toContain(s1);
        expect(tabA.map((s) => s.id)).not.toContain(s2);
    });
});

// ── Property-Based Tests ─────────────────────────────────────────────────────

// Feature: persistence, Property 13: ID sanitization safety
describe('sanitizeId — Property 13: ID sanitization safety', () => {
    it('sanitized output always matches /^[a-zA-Z0-9._-]{1,64}$/ for any string input', () => {
        fc.assert(
            fc.property(fc.string({ minLength: 1 }), (id) => {
                const sanitized = sanitizeId(id);
                expect(sanitized).toMatch(/^[a-zA-Z0-9._-]{1,64}$/);
            }),
            { numRuns: 100 },
        );
    });

    it('sanitized output is at most 64 characters for any string input', () => {
        fc.assert(
            fc.property(fc.string(), (id) => {
                const sanitized = sanitizeId(id);
                expect(sanitized.length).toBeLessThanOrEqual(64);
            }),
            { numRuns: 100 },
        );
    });

    it('sanitized output contains only allowed characters for any string input', () => {
        fc.assert(
            fc.property(fc.string({ minLength: 1 }), (id) => {
                const sanitized = sanitizeId(id);
                expect(sanitized).toMatch(/^[a-zA-Z0-9._-]+$/);
            }),
            { numRuns: 100 },
        );
    });
});

// Feature: persistence, Property 3: StoreEvent JSONL round-trip
describe('Property 3: StoreEvent JSONL round-trip', () => {
    it('writing an event and reading it back preserves ts, t, and d fields', async () => {
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
                        const s = new JsonlStore(tmpDir);
                        const { sessionId } = openSession(s, 'proj');
                        s.appendEvent(sessionId, { ts: event.ts, t: event.t, d: event.d });
                        await s.flush();

                        const events = s.tail(sessionId);
                        expect(events).toHaveLength(1);
                        expect(events[0].ts).toBe(event.ts);
                        expect(events[0].t).toBe(event.t);
                        expect(JSON.parse(JSON.stringify(events[0].d))).toEqual(
                            JSON.parse(JSON.stringify(event.d)),
                        );

                        await s.close();
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
        await fc.assert(
            fc.asyncProperty(
                fc.array(
                    fc.record({ ts: fc.integer(), t: fc.string() }),
                    { minLength: 2, maxLength: 50 },
                ),
                async (eventInputs) => {
                    const tmpDir = mkdtempSync(join(tmpdir(), 'pbt-p4-'));
                    try {
                        const s = new JsonlStore(tmpDir);
                        const { sessionId } = openSession(s, 'proj');

                        for (const ev of eventInputs) {
                            s.appendEvent(sessionId, { ts: ev.ts, t: ev.t });
                        }
                        await s.flush();

                        const events = s.tail(sessionId, { n: eventInputs.length });
                        expect(events).toHaveLength(eventInputs.length);

                        for (let i = 0; i < events.length; i++) {
                            expect(events[i].seq).toBeGreaterThanOrEqual(0);
                            if (i > 0) {
                                expect(events[i].seq).toBe((events[i - 1].seq as number) + 1);
                            }
                        }

                        await s.close();
                    } finally {
                        cleanup(tmpDir);
                    }
                },
            ),
            { numRuns: 100 },
        );
    });
});

// Feature: persistence, Property 5: Single-timeline write (v0.4.0 — no dual-write)
describe('Property 5: Single-timeline write invariant', () => {
    it('an event appended to a session appears in the session timeline', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.record({ ts: fc.integer(), t: fc.string() }),
                async (eventInput) => {
                    const tmpDir = mkdtempSync(join(tmpdir(), 'pbt-p5-'));
                    try {
                        const s = new JsonlStore(tmpDir);
                        const { sessionId } = openSession(s, 'proj');
                        s.appendEvent(sessionId, { ts: eventInput.ts, t: eventInput.t });
                        await s.flush();

                        const sessEvents = s.tail(sessionId);
                        expect(sessEvents).toHaveLength(1);
                        expect(sessEvents[0].ts).toBe(eventInput.ts);
                        expect(sessEvents[0].t).toBe(eventInput.t);

                        await s.close();
                    } finally {
                        cleanup(tmpDir);
                    }
                },
            ),
            { numRuns: 100 },
        );
    });
});

// Feature: persistence, Property 6: Session upsert/get round-trip
describe('Property 6: Session upsert/get round-trip', () => {
    it('getSession returns a SessionMeta with matching id and tabId for any upsertSession call', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.string({ minLength: 1 }),
                async (projectId) => {
                    const tmpDir = mkdtempSync(join(tmpdir(), 'pbt-p6-'));
                    try {
                        const s = new JsonlStore(tmpDir);
                        const { sessionId, tabId } = openSession(s, projectId);

                        const meta = s.getSession(sessionId);
                        expect(meta).toBeDefined();
                        expect(meta!.id).toBe(sessionId);
                        expect(meta!.tabId).toBe(tabId);
                        expect(meta!.participants[0]?.projectId).toBe(projectId);

                        await s.close();
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

    it('failed flush does not throw and seq numbers are not reused', async () => {
        const queue = new WriteQueue();
        const badPath = join(tmpDir, 'nonexistent-dir', 'timeline.jsonl');
        const goodPath = join(tmpDir, 'timeline.jsonl');
        const sessionId = 'sess-3';

        queue.enqueue(badPath, sessionId, JSON.stringify({ ts: 1000, t: 'log', d: {} }));
        queue.enqueue(badPath, sessionId, JSON.stringify({ ts: 2000, t: 'log', d: {} }));
        queue.enqueue(badPath, sessionId, JSON.stringify({ ts: 3000, t: 'log', d: {} }));

        await expect(queue.drain()).resolves.toBeUndefined();

        expect(queue.getSeq(sessionId)).toBe(3);

        queue.enqueue(goodPath, sessionId, JSON.stringify({ ts: 4000, t: 'log', d: {} }));
        queue.enqueue(goodPath, sessionId, JSON.stringify({ ts: 5000, t: 'log', d: {} }));

        await queue.drain();

        expect(queue.getSeq(sessionId)).toBe(5);

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

        queue.enqueue(goodPath, sessionId, JSON.stringify({ ts: 2, t: 'log', d: {} }));
        await queue.drain();

        const content = readFileSync(goodPath, 'utf-8');
        const lines = content.split('\n').filter((l) => l.trim());
        expect(lines).toHaveLength(1);
        expect(JSON.parse(lines[0]).seq).toBe(1);
    });

    it('drain() flushes all pending events without waiting for the timer', async () => {
        const queue = new WriteQueue();
        const filePath = join(tmpDir, 'timeline.jsonl');
        const sessionId = 'sess-5';

        queue.enqueue(filePath, sessionId, JSON.stringify({ ts: 1000, t: 'log', d: { msg: 'first' } }));
        queue.enqueue(filePath, sessionId, JSON.stringify({ ts: 2000, t: 'log', d: { msg: 'second' } }));
        queue.enqueue(filePath, sessionId, JSON.stringify({ ts: 3000, t: 'log', d: { msg: 'third' } }));

        await queue.drain();

        const content = readFileSync(filePath, 'utf-8');
        const lines = content.split('\n').filter((l) => l.trim());

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
        await queue.drain();

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

// Feature: persistence, Property 8: session.tail type filter correctness
describe('Property 8: session.tail type filter correctness', () => {
    it('tail with a single type filter returns only events of that type', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.array(
                    fc.record({ ts: fc.integer(), t: fc.constantFrom('log', 'err', 'req') }),
                    { minLength: 1, maxLength: 30 },
                ),
                async (eventInputs) => {
                    const tmpDir = mkdtempSync(join(tmpdir(), 'pbt-p8-'));
                    try {
                        const s = new JsonlStore(tmpDir);
                        const { sessionId } = openSession(s, 'proj');

                        for (const ev of eventInputs) {
                            s.appendEvent(sessionId, { ts: ev.ts, t: ev.t });
                        }
                        await s.flush();

                        for (const filterType of ['log', 'err', 'req'] as const) {
                            const results = s.tail(sessionId, { type: filterType, n: eventInputs.length });
                            for (const ev of results) {
                                expect(ev.t).toBe(filterType);
                            }
                            const wrongType = results.find((ev) => ev.t !== filterType);
                            expect(wrongType).toBeUndefined();
                        }

                        await s.close();
                    } finally {
                        cleanup(tmpDir);
                    }
                },
            ),
            { numRuns: 100 },
        );
    });

    it('tail with an array type filter returns only events whose type is in the array', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.array(
                    fc.record({ ts: fc.integer(), t: fc.constantFrom('log', 'err', 'req') }),
                    { minLength: 1, maxLength: 30 },
                ),
                async (eventInputs) => {
                    const tmpDir = mkdtempSync(join(tmpdir(), 'pbt-p8b-'));
                    try {
                        const s = new JsonlStore(tmpDir);
                        const { sessionId } = openSession(s, 'proj');

                        for (const ev of eventInputs) {
                            s.appendEvent(sessionId, { ts: ev.ts, t: ev.t });
                        }
                        await s.flush();

                        const filterTypes: Array<'log' | 'err'> = ['log', 'err'];
                        const results = s.tail(sessionId, { type: filterTypes, n: eventInputs.length });

                        for (const ev of results) {
                            expect(filterTypes).toContain(ev.t);
                        }
                        const wrongType = results.find((ev) => ev.t === 'req');
                        expect(wrongType).toBeUndefined();

                        await s.close();
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
                        const s = new JsonlStore(tmpDir);
                        const { sessionId } = openSession(s, 'proj');

                        for (const ev of eventInputs) {
                            s.appendEvent(sessionId, { ts: ev.ts, t: ev.t, d: ev.d });
                        }
                        await s.flush();

                        const results = s.search(sessionId, query, { limit: eventInputs.length + 10 });
                        const lowerQuery = query.toLowerCase();

                        for (const ev of results) {
                            const line = JSON.stringify(ev);
                            expect(line.toLowerCase()).toContain(lowerQuery);
                        }

                        for (const ev of results) {
                            const line = JSON.stringify(ev);
                            expect(line.toLowerCase().includes(lowerQuery)).toBe(true);
                        }

                        await s.close();
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
        await fc.assert(
            fc.asyncProperty(
                fc.array(fc.integer({ min: 1, max: 30 }), { minLength: 1, maxLength: 10 }),
                async (daysAgoList) => {
                    const tmpDir = mkdtempSync(join(tmpdir(), 'pbt-p10-'));
                    try {
                        const s = new JsonlStore(tmpDir);
                        const maxAgeDays = 7;
                        const now = Date.now();
                        const sessionIds: string[] = [];

                        for (const daysAgo of daysAgoList) {
                            const { sessionId } = openSession(s, 'proj');
                            sessionIds.push(sessionId);

                            // Backdate using the NEW flat path
                            const meta = s.getSession(sessionId)!;
                            meta.startedAt = now - daysAgo * 86400000;
                            const sessDir = join(tmpDir, 'sessions', sanitizeId(sessionId));
                            writeFileSync(join(sessDir, 'meta.json'), JSON.stringify(meta));
                        }

                        s.purge({ maxAgeDays, maxSessions: 1000 });

                        for (let i = 0; i < daysAgoList.length; i++) {
                            const daysAgo = daysAgoList[i];
                            const sessId = sessionIds[i];
                            const meta = s.getSession(sessId);

                            if (daysAgo > maxAgeDays) {
                                expect(meta).toBeUndefined();
                            } else if (daysAgo < maxAgeDays) {
                                expect(meta).toBeDefined();
                            }
                        }

                        await s.close();
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
    it('purge retains exactly the M most recent sessions when count exceeds maxSessions', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.integer({ min: 1, max: 20 }),
                async (sessionCount) => {
                    const tmpDir = mkdtempSync(join(tmpdir(), 'pbt-p11-'));
                    try {
                        const s = new JsonlStore(tmpDir);
                        const maxSessions = Math.max(1, Math.floor(sessionCount / 2));
                        const now = Date.now();
                        const sessionIds: string[] = [];
                        const startedAts: number[] = [];

                        for (let i = 0; i < sessionCount; i++) {
                            const { sessionId } = openSession(s, 'proj');
                            sessionIds.push(sessionId);

                            const startedAt = now - (sessionCount - i) * 1000;
                            startedAts.push(startedAt);

                            const meta = s.getSession(sessionId)!;
                            meta.startedAt = startedAt;
                            const sessDir = join(tmpDir, 'sessions', sanitizeId(sessionId));
                            writeFileSync(join(sessDir, 'meta.json'), JSON.stringify(meta));
                        }

                        s.purge({ maxAgeDays: 365, maxSessions });

                        const remaining = s.listSessions({ limit: 1000 });
                        expect(remaining.length).toBeLessThanOrEqual(maxSessions);

                        if (remaining.length > 0) {
                            const sortedByRecency = [...sessionIds]
                                .map((id, idx) => ({ id, startedAt: startedAts[idx] }))
                                .sort((a, b) => b.startedAt - a.startedAt)
                                .slice(0, maxSessions)
                                .map((sess) => sess.id);

                            for (const retainedSess of remaining) {
                                expect(sortedByRecency).toContain(retainedSess.id);
                            }
                        }

                        await s.close();
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
    it('age purge deletes the recording chunk but preserves the timeline (chunk-file layout, harness-fe#171)', async () => {
        const { existsSync: efs, readdirSync: rdir } = await import('node:fs');

        await fc.assert(
            fc.asyncProperty(
                fc.integer({ min: 1, max: 10 }),
                async (daysAgo) => {
                    const tmpDir = mkdtempSync(join(tmpdir(), 'pbt-p12-'));
                    try {
                        const s = new JsonlStore(tmpDir);
                        const { sessionId } = openSession(s, 'proj');

                        // Recent timeline event; a recording chunk whose endTs is
                        // `daysAgo` old (the chunk's own time drives age eviction).
                        const now = Date.now();
                        s.appendEvent(sessionId, { ts: now, t: 'log', d: {} });
                        const recEnd = now - daysAgo * 86400000;
                        s.appendRecording(sessionId, {
                            chunkId: 'c1', startTs: recEnd - 1000, endTs: recEnd, eventCount: 1,
                            events: [{ type: 4, data: {} }],
                        });
                        await s.flush();

                        const sessDir = join(tmpDir, 'sessions', sanitizeId(sessionId));
                        const recDir = join(sessDir, 'recording');
                        const tlDir = join(sessDir, 'timeline');

                        const recordingRetentionDays = Math.max(0, daysAgo - 1);
                        s.purge({ maxAgeDays: 365, maxSessions: 1000, recordingRetentionDays });

                        // The recording chunk file is age-evicted (its endTs is older
                        // than the retention window); recording dir ends up empty.
                        if (daysAgo > recordingRetentionDays) {
                            const recFiles = efs(recDir) ? rdir(recDir).filter((f) => f.endsWith('.jsonl')) : [];
                            expect(recFiles).toHaveLength(0);
                        }
                        // Timeline (recent) is untouched.
                        const tlFiles = efs(tlDir) ? rdir(tlDir).filter((f) => f.endsWith('.jsonl')) : [];
                        expect(tlFiles.length).toBeGreaterThan(0);
                        expect(s.tail(sessionId, { n: 10 }).length).toBeGreaterThan(0);

                        await s.close();
                    } finally {
                        cleanup(tmpDir);
                    }
                },
            ),
            { numRuns: 50 },
        );
    });
});

// Feature: persistence, Property 7: Tab metadata schema completeness
describe('Property 7: Tab metadata schema completeness', () => {
    it('upsertTab writes meta.json with required fields and optional fields iff provided', async () => {
        const { readFileSync: rfs, existsSync: efs } = await import('node:fs');

        await fc.assert(
            fc.asyncProperty(
                fc.record({
                    id: fc.string({ minLength: 1 }),
                    userAgent: fc.option(fc.string(), { nil: undefined }),
                }),
                async (tabInput) => {
                    const tmpDir = mkdtempSync(join(tmpdir(), 'pbt-p7-'));
                    try {
                        const s = new JsonlStore(tmpDir);

                        const tabArg: { connectedAt: number; userAgent?: string } = {
                            connectedAt: Date.now(),
                        };
                        if (tabInput.userAgent !== undefined) tabArg.userAgent = tabInput.userAgent;

                        s.upsertTab(tabInput.id, tabArg);

                        // Read the written meta.json from disk using new flat path
                        const sanitizedTabId = sanitizeId(tabInput.id);
                        const metaPath = join(tmpDir, 'tabs', sanitizedTabId, 'meta.json');

                        expect(efs(metaPath)).toBe(true);
                        const meta = JSON.parse(rfs(metaPath, 'utf-8'));

                        // Required fields must be present
                        expect(meta.id).toBeDefined();
                        expect(meta.id).not.toBeNull();
                        expect(meta.connectedAt).toBeDefined();
                        expect(meta.connectedAt).not.toBeNull();

                        // Optional fields: present iff provided to upsertTab
                        if (tabInput.userAgent !== undefined) {
                            expect(meta.userAgent).toBeDefined();
                            expect(meta.userAgent).toBe(tabInput.userAgent);
                        } else {
                            expect(meta.userAgent).toBeUndefined();
                        }

                        await s.close();
                    } finally {
                        cleanup(tmpDir);
                    }
                },
            ),
            { numRuns: 100 },
        );
    });
});
