import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonlStore } from './JsonlStore.js';

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

    afterEach(() => {
        store.close();
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

    it('appends events and tails them back', () => {
        const sessId = store.openSession('proj', { peerRole: 'vite-plugin' });
        store.append(sessId, { ts: 1000, t: 'log', d: { level: 'info', args: ['hello'] } });
        store.append(sessId, { ts: 2000, t: 'err', d: { message: 'boom' } });
        store.append(sessId, { ts: 3000, t: 'hmr', d: { file: 'App.tsx' } });

        const events = store.tail(sessId);
        expect(events).toHaveLength(3);
        expect(events[0].t).toBe('log');
        expect(events[2].t).toBe('hmr');
    });

    it('tail filters by type', () => {
        const sessId = store.openSession('proj', { peerRole: 'vite-plugin' });
        store.append(sessId, { ts: 1000, t: 'log', d: {} });
        store.append(sessId, { ts: 2000, t: 'err', d: { message: 'oops' } });
        store.append(sessId, { ts: 3000, t: 'log', d: {} });

        const errors = store.tail(sessId, { type: 'err' });
        expect(errors).toHaveLength(1);
        expect(errors[0].t).toBe('err');
    });

    it('tail filters by multiple types', () => {
        const sessId = store.openSession('proj', { peerRole: 'vite-plugin' });
        store.append(sessId, { ts: 1000, t: 'log', d: {} });
        store.append(sessId, { ts: 2000, t: 'err', d: {} });
        store.append(sessId, { ts: 3000, t: 'hmr', d: {} });
        store.append(sessId, { ts: 4000, t: 'cmd', d: {} });

        const result = store.tail(sessId, { type: ['err', 'hmr'] });
        expect(result).toHaveLength(2);
        expect(result.map((e) => e.t).sort()).toEqual(['err', 'hmr']);
    });

    it('tail respects n limit', () => {
        const sessId = store.openSession('proj', { peerRole: 'vite-plugin' });
        for (let i = 0; i < 20; i++) {
            store.append(sessId, { ts: i * 100, t: 'log', d: { i } });
        }
        const result = store.tail(sessId, { n: 5 });
        expect(result).toHaveLength(5);
        // Should be the last 5
        expect((result[4].d as { i: number }).i).toBe(19);
    });

    it('appendBatch writes all events', () => {
        const sessId = store.openSession('proj', { peerRole: 'vite-plugin' });
        store.appendBatch(sessId, [
            { ts: 1000, t: 'log', d: { msg: 'a' } },
            { ts: 2000, t: 'log', d: { msg: 'b' } },
            { ts: 3000, t: 'err', d: { message: 'c' } },
        ]);
        const events = store.tail(sessId);
        expect(events).toHaveLength(3);
    });

    it('appends to tab timeline when tabId provided', () => {
        const sessId = store.openSession('proj', { peerRole: 'vite-plugin' });
        store.openTab(sessId, { id: 'tab-1' });
        store.append(sessId, { ts: 1000, t: 'log', d: {} }, 'tab-1');
        store.append(sessId, { ts: 2000, t: 'err', d: {} }, 'tab-1');

        // Session timeline has both
        const sessEvents = store.tail(sessId);
        expect(sessEvents).toHaveLength(2);

        // Tab timeline also has both
        const tabEvents = store.tail(sessId, {}, 'tab-1');
        expect(tabEvents).toHaveLength(2);
    });

    it('appends rrweb recording chunks', () => {
        const sessId = store.openSession('proj', { peerRole: 'vite-plugin' });
        store.openTab(sessId, { id: 'tab-1' });
        store.appendRecording(sessId, 'tab-1', [{ type: 4, data: {} }]);
        store.appendRecording(sessId, 'tab-1', [{ type: 3, data: {} }]);
        // No error = pass; recordings are written to disk
    });

    // ── Search ───────────────────────────────────────────────────────────

    it('searches events by substring', () => {
        const sessId = store.openSession('proj', { peerRole: 'vite-plugin' });
        store.append(sessId, { ts: 1000, t: 'log', d: { args: ['hello world'] } });
        store.append(sessId, { ts: 2000, t: 'log', d: { args: ['goodbye'] } });
        store.append(sessId, { ts: 3000, t: 'err', d: { message: 'hello error' } });

        const results = store.search(sessId, 'hello');
        expect(results).toHaveLength(2);
    });

    it('search filters by type', () => {
        const sessId = store.openSession('proj', { peerRole: 'vite-plugin' });
        store.append(sessId, { ts: 1000, t: 'log', d: { args: ['hello'] } });
        store.append(sessId, { ts: 2000, t: 'err', d: { message: 'hello error' } });

        const results = store.search(sessId, 'hello', { type: 'err' });
        expect(results).toHaveLength(1);
        expect(results[0].t).toBe('err');
    });

    // ── Summary ──────────────────────────────────────────────────────────

    it('returns a session summary with counts', () => {
        const sessId = store.openSession('proj', { peerRole: 'vite-plugin' });
        store.append(sessId, { ts: 1000, t: 'log', d: {} });
        store.append(sessId, { ts: 2000, t: 'log', d: {} });
        store.append(sessId, { ts: 3000, t: 'err', d: { message: 'boom' } });
        store.append(sessId, { ts: 4000, t: 'cmd', d: {} });

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
});
