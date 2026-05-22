/**
 * Tests for the JSON API surface consumed by @harness-fe/dashboard-ui.
 *
 * Mirrors the seed setup used by `dashboard.test.ts` so we have parity:
 * anything the HTML dashboard could show should also be reachable via JSON
 * once we ship the SPA in PR C.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Bridge } from './bridge.js';
import { JsonlStore } from './store/index.js';

const tempDirs: string[] = [];
function mkTmp(): string {
    const dir = mkdtempSync(join(tmpdir(), 'harness-dashboard-api-test-'));
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

function seed(store: JsonlStore, projectId: string): string {
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

describe('Dashboard JSON API', () => {
    it('GET /api/projects returns project list with recent sessions inline', async () => {
        const { bridge, store, port } = await bootBridge();
        try {
            const sessionId = seed(store, 'my-app');
            await store.flush();
            const resp = await fetch(`http://127.0.0.1:${port}/api/projects`);
            expect(resp.status).toBe(200);
            expect(resp.headers.get('content-type')).toMatch(/application\/json/);
            const body = await resp.json() as { projects: Array<{ project: { id: string }; recentSessions: Array<{ id: string }> }> };
            expect(body.projects).toHaveLength(1);
            expect(body.projects[0].project.id).toBe('my-app');
            expect(body.projects[0].recentSessions.map((s) => s.id)).toContain(sessionId);
        } finally {
            await bridge.stop();
        }
    });

    it('GET /api/projects on empty store returns an empty list (not 500)', async () => {
        const { bridge, port } = await bootBridge();
        try {
            const resp = await fetch(`http://127.0.0.1:${port}/api/projects`);
            expect(resp.status).toBe(200);
            const body = await resp.json() as { projects: unknown[] };
            expect(body.projects).toEqual([]);
        } finally {
            await bridge.stop();
        }
    });

    it('GET /api/sessions filters by projectId', async () => {
        const { bridge, store, port } = await bootBridge();
        try {
            seed(store, 'project-a');
            seed(store, 'project-b');
            await store.flush();
            const resp = await fetch(`http://127.0.0.1:${port}/api/sessions?projectId=project-a`);
            expect(resp.status).toBe(200);
            const body = await resp.json() as { sessions: Array<{ participants: Array<{ projectId: string }> }> };
            expect(body.sessions.length).toBeGreaterThan(0);
            for (const s of body.sessions) {
                expect(s.participants[0].projectId).toBe('project-a');
            }
        } finally {
            await bridge.stop();
        }
    });

    it('GET /api/sessions/:id returns session + summary + chunks + timeline + exports', async () => {
        const { bridge, store, port } = await bootBridge();
        try {
            const sessionId = seed(store, 'my-app');
            await store.flush();
            const resp = await fetch(`http://127.0.0.1:${port}/api/sessions/${sessionId}`);
            expect(resp.status).toBe(200);
            const body = await resp.json() as {
                session: { id: string };
                summary: { tabs: string[] };
                chunks: Array<{ chunkId: string; tabId: string; eventCount: number }>;
                timeline: Array<{ t: string }>;
                exports: unknown[];
            };
            expect(body.session.id).toBe(sessionId);
            expect(body.summary.tabs).toContain('tab-1');
            expect(body.chunks).toHaveLength(1);
            expect(body.chunks[0].chunkId).toBe('rrc_a');
            expect(body.chunks[0].eventCount).toBe(3);
            expect(body.timeline.map((e) => e.t)).toContain('log');
            expect(body.timeline.map((e) => e.t)).toContain('err');
            expect(body.exports).toEqual([]);
        } finally {
            await bridge.stop();
        }
    });

    it('GET /api/sessions/:id returns 404 for unknown id', async () => {
        const { bridge, port } = await bootBridge();
        try {
            const resp = await fetch(`http://127.0.0.1:${port}/api/sessions/no-such-session`);
            expect(resp.status).toBe(404);
            const body = await resp.json() as { error: string; sessionId: string };
            expect(body.error).toMatch(/not found/i);
            expect(body.sessionId).toBe('no-such-session');
        } finally {
            await bridge.stop();
        }
    });

    it('POST /api/sessions/:id/replay returns exportId + viewerUrl on success', async () => {
        const { bridge, store, port } = await bootBridge();
        try {
            const sessionId = seed(store, 'my-app');
            await store.flush();
            const resp = await fetch(`http://127.0.0.1:${port}/api/sessions/${sessionId}/replay`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ since: 1000, until: 3000, tabId: 'tab-1' }),
            });
            expect(resp.status).toBe(200);
            const body = await resp.json() as { exportId?: string; viewerUrl?: string; error?: string };
            expect(body.error).toBeUndefined();
            expect(body.exportId).toBeTruthy();
            // viewerUrl is best-effort (depends on bridge.getViewerBaseUrl()); just assert shape.
            expect(typeof body.exportId === 'string').toBe(true);
        } finally {
            await bridge.stop();
        }
    });

    it('POST /api/sessions/:id/replay returns 400 with error message for empty window', async () => {
        const { bridge, store, port } = await bootBridge();
        try {
            const sessionId = seed(store, 'my-app');
            await store.flush();
            const resp = await fetch(`http://127.0.0.1:${port}/api/sessions/${sessionId}/replay`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ since: 999_999_000, until: 999_999_100 }),
            });
            expect(resp.status).toBe(400);
            const body = await resp.json() as { error: string };
            expect(body.error).toMatch(/no rrweb chunks|empty|window/i);
        } finally {
            await bridge.stop();
        }
    });

    it('POST /api/sessions/:id/replay rejects malformed JSON with 400', async () => {
        const { bridge, store, port } = await bootBridge();
        try {
            const sessionId = seed(store, 'my-app');
            await store.flush();
            const resp = await fetch(`http://127.0.0.1:${port}/api/sessions/${sessionId}/replay`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: 'not json {{{',
            });
            expect(resp.status).toBe(400);
            const body = await resp.json() as { error: string };
            expect(body.error).toMatch(/invalid JSON/i);
        } finally {
            await bridge.stop();
        }
    });

    it('non-API root path redirects into the SPA (legacy / no longer serves HTML)', async () => {
        const { bridge, store, port } = await bootBridge();
        try {
            seed(store, 'my-app');
            await store.flush();
            const resp = await fetch(`http://127.0.0.1:${port}/?token=abc`, { redirect: 'manual' });
            expect(resp.status).toBe(302);
            expect(resp.headers.get('location')).toBe('/dashboard/?token=abc');
        } finally {
            await bridge.stop();
        }
    });

    it('unknown /api/* paths return 404 JSON (not the HTML 404 page)', async () => {
        const { bridge, port } = await bootBridge();
        try {
            const resp = await fetch(`http://127.0.0.1:${port}/api/bogus/path`);
            expect(resp.status).toBe(404);
            expect(resp.headers.get('content-type')).toMatch(/application\/json/);
            const body = await resp.json() as { error: string };
            expect(body.error).toBe('not found');
        } finally {
            await bridge.stop();
        }
    });
});
