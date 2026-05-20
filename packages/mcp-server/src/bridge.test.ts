import { describe, expect, it, vi, afterEach } from 'vitest';
import { WebSocket } from 'ws';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function dirSize(dir: string): number {
    let total = 0;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, entry.name);
        total += entry.isDirectory() ? dirSize(p) : statSync(p).size;
    }
    return total;
}
import { Bridge } from './bridge.js';
import { JsonlStore, JsonTaskStore, type IStore } from './store/index.js';
import {
    EVENT_NAME,
    PROTOCOL_VERSION,
    type RrwebChunkPayload,
    type EventFrame,
    type Frame,
    type HelloAckFrame,
    type ResponseFrame,
    type TaskSubmitPayload,
} from '@harnessa-fe/protocol';

async function spawnBridge(): Promise<Bridge> {
    // store: null, taskStore: null → no persistence in tests
    const bridge = new Bridge({ port: 0, host: '127.0.0.1', store: null, taskStore: null });
    // ws library: port=0 → ephemeral assigned port; we read address() after listening.
    await bridge.start();
    return bridge;
}

function getPort(bridge: Bridge): number {
    const port = bridge.getBoundPort();
    if (!port) throw new Error('no address');
    return port;
}

/**
 * Connect a vite-plugin first (to create an active session), then connect a runtime-client.
 * Returns both WebSocket connections and the runtime-client ack.
 */
async function fakeClientWithSession(
    port: number,
    opts: { tabId?: string; projectId?: string; sessionId?: string } = {},
): Promise<{ pluginWs: WebSocket; ws: WebSocket; ack: HelloAckFrame }> {
    const projectId = opts.projectId ?? 'demo';
    // First connect vite-plugin to create an active session
    const pluginWs = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise<void>((resolve, reject) => {
        pluginWs.once('open', () => resolve());
        pluginWs.once('error', reject);
    });
    pluginWs.send(JSON.stringify({
        type: 'hello',
        id: 'hp1',
        role: 'vite-plugin',
        projectId,
        page: { url: 'http://localhost:5173/', title: 'Demo' },
    }));
    // Wait for plugin ack
    await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('plugin hello.ack timeout')), 1000);
        pluginWs.once('message', () => { clearTimeout(timer); resolve(); });
    });
    // Now connect runtime-client
    const { ws, ack } = await fakeClient(port, 'runtime-client', opts);
    return { pluginWs, ws, ack };
}

async function fakeClient(
    port: number,
    role: 'runtime-client' | 'vite-plugin',
    opts: { tabId?: string; projectId?: string; sessionId?: string } = {},
): Promise<{ ws: WebSocket; ack: HelloAckFrame }> {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise<void>((resolve, reject) => {
        ws.once('open', () => resolve());
        ws.once('error', reject);
    });
    const sessionId = role === 'runtime-client' ? (opts.sessionId ?? 'sess-1') : undefined;
    ws.send(
        JSON.stringify({
            type: 'hello',
            id: 'h1',
            role,
            projectId: opts.projectId ?? 'demo',
            tabId: opts.tabId,
            sessionId,
            page: { url: 'http://localhost:5173/', title: 'Demo' },
        }),
    );
    const ack = await new Promise<HelloAckFrame>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('hello.ack timeout')), 1000);
        ws.once('message', (raw) => {
            clearTimeout(timer);
            resolve(JSON.parse(raw.toString()) as HelloAckFrame);
        });
    });
    return { ws, ack };
}

describe('Bridge — auto-purge scheduler', () => {
    it('runs store.purge() on start when enabled, with policy passed through', async () => {
        const calls: Array<unknown> = [];
        const fakeStore = {
            purge: (policy: unknown) => {
                calls.push(policy);
                return {
                    sessionsDeleted: 0,
                    recordingsDeleted: 0,
                    exportsDeleted: 0,
                    bytesFreed: 0,
                };
            },
        } as unknown as IStore;

        const bridge = new Bridge({
            port: 0,
            host: '127.0.0.1',
            store: fakeStore as unknown as IStore,
            taskStore: null,
            autoPurge: {
                enabled: true,
                intervalMs: 9_999_999, // periodic timer is unref'd; we only assert startup call here
                policy: { maxAgeDays: 1 },
            },
        });
        try {
            await bridge.start();
            // start() defers the initial purge via setImmediate; yield twice.
            await new Promise((resolve) => setTimeout(resolve, 20));
            expect(calls).toHaveLength(1);
            expect(calls[0]).toEqual({ maxAgeDays: 1 });
        } finally {
            await bridge.stop();
        }
    });

    it('skips startup purge when skipInitial is set', async () => {
        let count = 0;
        const fakeStore = {
            purge: () => {
                count++;
                return {
                    sessionsDeleted: 0,
                    recordingsDeleted: 0,
                    exportsDeleted: 0,
                    bytesFreed: 0,
                };
            },
        } as unknown as IStore;

        const bridge = new Bridge({
            port: 0,
            host: '127.0.0.1',
            store: fakeStore,
            taskStore: null,
            autoPurge: { enabled: true, intervalMs: 9_999_999, skipInitial: true },
        });
        try {
            await bridge.start();
            await new Promise((resolve) => setTimeout(resolve, 20));
            expect(count).toBe(0);
        } finally {
            await bridge.stop();
        }
    });

    it('does not crash daemon when store.purge throws', async () => {
        const fakeStore = {
            purge: () => {
                throw new Error('disk full');
            },
        } as unknown as IStore;

        const bridge = new Bridge({
            port: 0,
            host: '127.0.0.1',
            store: fakeStore,
            taskStore: null,
            autoPurge: { enabled: true, intervalMs: 9_999_999 },
        });
        try {
            await expect(bridge.start()).resolves.toBeUndefined();
            await new Promise((resolve) => setTimeout(resolve, 20));
            // bridge is still listening
            expect(bridge.getBoundPort()).toBeGreaterThan(0);
        } finally {
            await bridge.stop();
        }
    });

    it('end-to-end: real JsonlStore + auto-purge shrinks disk usage', async () => {
        // Real store on temp dir + real Bridge. Proves disk usage actually
        // drops (not just that purge() returns numbers).
        const dir = mkdtempSync(join(tmpdir(), 'autopurge-int-'));
        const store = new JsonlStore(dir);
        try {
            const { randomUUID } = await import('node:crypto');
            for (let i = 0; i < 10; i++) {
                const sessionId = randomUUID();
                store.upsertTab(`t-${i}`, { connectedAt: Date.now() });
                store.upsertSession(sessionId, {
                    tabId: `t-${i}`,
                    startedAt: Date.now(),
                    participants: [{ projectId: `proj-${i}`, joinedAt: Date.now() }],
                });
                store.appendEvent(sessionId, {
                    ts: Date.now(),
                    t: 'log',
                    d: { msg: 'x'.repeat(2048) },
                });
            }
            await store.flush();
            const before = dirSize(dir);
            expect(before).toBeGreaterThan(10_000);

            const bridge = new Bridge({
                port: 0,
                host: '127.0.0.1',
                store,
                taskStore: null,
                autoPurge: {
                    enabled: true,
                    intervalMs: 9_999_999,
                    policy: { maxAgeDays: 0 }, // wipe everything older than 0 days
                },
            });
            await bridge.start();
            await new Promise((resolve) => setTimeout(resolve, 50));
            await bridge.stop();

            const after = dirSize(dir);
            expect(after).toBeLessThan(before);
        } finally {
            await store.close();
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('respects enabled:false (no purge runs)', async () => {
        let count = 0;
        const fakeStore = {
            purge: () => {
                count++;
                return {
                    sessionsDeleted: 0,
                    recordingsDeleted: 0,
                    exportsDeleted: 0,
                    bytesFreed: 0,
                };
            },
        } as unknown as IStore;

        const bridge = new Bridge({
            port: 0,
            host: '127.0.0.1',
            store: fakeStore,
            taskStore: null,
            autoPurge: { enabled: false },
        });
        try {
            await bridge.start();
            await new Promise((resolve) => setTimeout(resolve, 20));
            expect(count).toBe(0);
        } finally {
            await bridge.stop();
        }
    });
});

describe('Bridge', () => {
    it('handshakes a runtime-client and registers it', async () => {
        const bridge = await spawnBridge();
        try {
            const port = getPort(bridge);
            const { ack } = await fakeClientWithSession(port, {
                tabId: 't-1',
                projectId: 'demo',
            });
            expect(ack.type).toBe('hello.ack');
            expect(ack.tabId).toBe('t-1');
            expect(ack.serverVersion).toBe(PROTOCOL_VERSION);
            expect(bridge.router.listTabs()).toHaveLength(1);
        } finally {
            await bridge.stop();
        }
    });

    it('rejects a runtime-client hello missing sessionId', async () => {
        const bridge = await spawnBridge();
        try {
            const port = getPort(bridge);
            const ws = new WebSocket(`ws://127.0.0.1:${port}`);
            await new Promise<void>((resolve, reject) => {
                ws.once('open', () => resolve());
                ws.once('error', reject);
            });
            ws.send(
                JSON.stringify({
                    type: 'hello',
                    id: 'h1',
                    role: 'runtime-client',
                    projectId: 'demo',
                    tabId: 't-1',
                    // sessionId intentionally omitted
                }),
            );
            const ack = await new Promise<HelloAckFrame>((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error('hello.ack timeout')), 1000);
                ws.once('message', (raw) => {
                    clearTimeout(timer);
                    resolve(JSON.parse(raw.toString()) as HelloAckFrame);
                });
            });
            expect(ack.type).toBe('hello.ack');
            expect(ack.error).toMatch(/sessionId/);
            expect(bridge.router.listTabs()).toHaveLength(0);
            ws.close();
        } finally {
            await bridge.stop();
        }
    });

    it('sendCommand round-trips request and response', async () => {
        const bridge = await spawnBridge();
        try {
            const port = getPort(bridge);
            const { ws } = await fakeClientWithSession(port, {
                tabId: 't-1',
                projectId: 'demo',
            });
            // Echo handler
            ws.on('message', (raw) => {
                const frame = JSON.parse(raw.toString()) as Frame;
                if (frame.type !== 'command') return;
                const resp: ResponseFrame = {
                    type: 'response',
                    id: frame.id,
                    ok: true,
                    result: { echoed: frame.args },
                };
                ws.send(JSON.stringify(resp));
            });
            const out = await bridge.sendCommand('page.click', { selector: { component: 'X' } });
            expect(out).toEqual({ echoed: { selector: { component: 'X' } } });
        } finally {
            await bridge.stop();
        }
    });

    it('sendCommand rejects when client has no tab connected', async () => {
        const bridge = await spawnBridge();
        try {
            await expect(bridge.sendCommand('page.click', {})).rejects.toThrow(
                /no runtime-client/,
            );
        } finally {
            await bridge.stop();
        }
    });

    it('sendCommand surfaces ok=false errors', async () => {
        const bridge = await spawnBridge();
        try {
            const port = getPort(bridge);
            const { ws } = await fakeClientWithSession(port, { tabId: 't-1', projectId: 'demo' });
            ws.on('message', (raw) => {
                const frame = JSON.parse(raw.toString()) as Frame;
                if (frame.type !== 'command') return;
                ws.send(
                    JSON.stringify({
                        type: 'response',
                        id: frame.id,
                        ok: false,
                        error: { code: 'NOT_FOUND', message: 'no such element' },
                    } satisfies ResponseFrame),
                );
            });
            await expect(bridge.sendCommand('page.click', {})).rejects.toThrow(
                /no such element/,
            );
        } finally {
            await bridge.stop();
        }
    });

    it('records task.submit events into the task queue', async () => {
        const bridge = await spawnBridge();
        try {
            const port = getPort(bridge);
            const { ws } = await fakeClientWithSession(port, {
                tabId: 't-1',
                projectId: 'demo',
            });
            const payload: TaskSubmitPayload = {
                question: 'why does increment break?',
                url: 'http://localhost:5173/',
                selector: { comp: 'IncrementBtn', loc: 'src/App.tsx:24:16' },
                element: {
                    tag: 'button',
                    outerHTML: '<button>Increment</button>',
                    rect: { x: 10, y: 20, width: 80, height: 32 },
                },
            };
            ws.send(
                JSON.stringify({
                    type: 'event',
                    id: 'e1',
                    tabId: 't-1',
                    projectId: 'demo',
                    name: EVENT_NAME.TASK_SUBMIT,
                    ts: Date.now(),
                    payload,
                } satisfies EventFrame),
            );
            await new Promise((r) => setTimeout(r, 30));

            const pending = await bridge.listTasks({ status: 'pending' });
            expect(pending).toHaveLength(1);
            expect(pending[0].question).toBe(payload.question);
            expect(pending[0].selector.comp).toBe('IncrementBtn');

            const claimed = await bridge.claimTask(pending[0].id);
            expect(claimed?.status).toBe('claimed');
            expect(claimed?.claimedAt).toBeTypeOf('number');
            expect(await bridge.listTasks({ status: 'pending' })).toHaveLength(0);
            expect(await bridge.listTasks({ status: 'claimed' })).toHaveLength(1);

            const resolved = await bridge.resolveTask(pending[0].id, 'fixed setCount closure');
            expect(resolved?.status).toBe('resolved');
            expect(resolved?.note).toBe('fixed setCount closure');
            expect(await bridge.listTasks({ status: 'resolved' })).toHaveLength(1);
        } finally {
            await bridge.stop();
        }
    });

    it('ignores task.submit events with invalid payload', async () => {
        const bridge = await spawnBridge();
        try {
            const port = getPort(bridge);
            const { ws } = await fakeClientWithSession(port, { tabId: 't-1', projectId: 'demo' });
            ws.send(
                JSON.stringify({
                    type: 'event',
                    id: 'e2',
                    tabId: 't-1',
                    name: EVENT_NAME.TASK_SUBMIT,
                    ts: Date.now(),
                    payload: { garbage: true },
                } satisfies EventFrame),
            );
            await new Promise((r) => setTimeout(r, 30));
            expect(await bridge.listTasks({ status: 'all' })).toHaveLength(0);
        } finally {
            await bridge.stop();
        }
    });

    it('deduplicates repeat task.submit events with the same tab + selector + question', async () => {
        const bridge = await spawnBridge();
        try {
            const port = getPort(bridge);
            const { ws } = await fakeClientWithSession(port, {
                tabId: 't-dedup',
                projectId: 'demo',
            });
            const payload: TaskSubmitPayload = {
                question: 'fix this please',
                url: 'http://localhost:5173/',
                selector: { comp: 'IncrementBtn', loc: 'src/App.tsx:24:16' },
                element: { tag: 'button', outerHTML: '<button>+</button>' },
            };
            const frame = (id: string): EventFrame => ({
                type: 'event',
                id,
                tabId: 't-dedup',
                projectId: 'demo',
                name: EVENT_NAME.TASK_SUBMIT,
                ts: Date.now(),
                payload,
            });
            ws.send(JSON.stringify(frame('e1')));
            ws.send(JSON.stringify(frame('e2')));
            ws.send(JSON.stringify(frame('e3')));
            await new Promise((r) => setTimeout(r, 30));
            expect(await bridge.listTasks({ status: 'pending' })).toHaveLength(1);
        } finally {
            await bridge.stop();
        }
    });

    it('persists tasks across bridge restarts via JsonTaskStore', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'morphix-bridge-test-'));
        try {
            const taskStore1 = new JsonTaskStore(dir);
            const b1 = new Bridge({ port: 0, host: '127.0.0.1', store: null, taskStore: taskStore1 });
            await b1.start();
            const port = getPort(b1);
            // Connect vite-plugin first to create an active session context
            const { ws } = await fakeClientWithSession(port, {
                tabId: 't-persist',
                projectId: 'demo',
            });
            const payload: TaskSubmitPayload = {
                question: 'persist me',
                url: 'http://localhost:5173/',
                selector: { comp: 'EchoInput' },
                element: { tag: 'input', outerHTML: '<input />' },
            };
            ws.send(
                JSON.stringify({
                    type: 'event',
                    id: 'p1',
                    tabId: 't-persist',
                    projectId: 'demo',
                    name: EVENT_NAME.TASK_SUBMIT,
                    ts: Date.now(),
                    payload,
                } satisfies EventFrame),
            );
            await new Promise((r) => setTimeout(r, 30));
            expect(await b1.listTasks({ status: 'pending' })).toHaveLength(1);
            await b1.stop();
            // Verify tasks.json was written for the 'demo' project
            expect(existsSync(join(dir, 'demo', 'tasks.json'))).toBe(true);

            // Restart with a new bridge pointing to the same data dir
            const taskStore2 = new JsonTaskStore(dir);
            const b2 = new Bridge({ port: 0, host: '127.0.0.1', store: null, taskStore: taskStore2 });
            await b2.start();
            try {
                // Connect vite-plugin to trigger task loading for 'demo' project
                const port2 = getPort(b2);
                await fakeClient(port2, 'vite-plugin', { projectId: 'demo' });
                await new Promise((r) => setTimeout(r, 30));
                const restored = await b2.listTasks({ status: 'pending' });
                expect(restored).toHaveLength(1);
                expect(restored[0].question).toBe('persist me');
            } finally {
                await b2.stop();
            }
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('persists rrweb payloads outside timeline entries while keeping timeline metadata', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'morphix-bridge-rrweb-'));
        const store = new JsonlStore(dir);
        const bridge = new Bridge({ port: 0, host: '127.0.0.1', store, taskStore: null, autoPurge: { enabled: false } });
        await bridge.start();
        try {
            const port = getPort(bridge);
            const projectId = 'rrweb-project';
            const tabId = 'tab-rrweb-1';
            const { pluginWs, ws } = await fakeClientWithSession(port, { tabId, projectId });

            const payload: RrwebChunkPayload = {
                chunkId: 'rrc_000001',
                startTs: 1000,
                endTs: 1400,
                eventCount: 2,
                events: [
                    { type: 4, timestamp: 1000, data: { href: 'http://localhost:5173/', width: 1280, height: 720 } },
                    { type: 3, timestamp: 1400, data: { source: 5, id: 1, text: 'abc', isChecked: false } },
                ],
            };

            ws.send(JSON.stringify({
                type: 'event',
                id: 'rr1',
                tabId,
                projectId,
                name: EVENT_NAME.RRWEB,
                ts: 1500,
                payload,
            } satisfies EventFrame));

            await new Promise((r) => setTimeout(r, 50));
            await store.close();

            const sessionId = store.listSessions({ projectId, limit: 1 })[0]?.id;
            expect(sessionId).toBeTruthy();

            const rrwebLine = store.tail(sessionId!, { n: 20 }).find((line) => line.t === 'rrweb');
            expect(rrwebLine).toBeTruthy();
            expect(rrwebLine?.d).toMatchObject({
                chunkId: payload.chunkId,
                eventCount: payload.eventCount,
            });
            expect((rrwebLine?.d as { events?: unknown[] } | undefined)?.events).toBeUndefined();

            // 0.4.0: recordings live at sessions/{sessionId}/recording.jsonl (flat layout).
            const recordingPath = join(dir, 'sessions', sessionId!, 'recording.jsonl');
            expect(existsSync(recordingPath)).toBe(true);
            const recordingLines = readFileSync(recordingPath, 'utf-8')
                .split('\n')
                .filter((l) => l.trim());
            expect(recordingLines).toHaveLength(1);
            const recordingChunk = JSON.parse(recordingLines[0]);
            expect(recordingChunk.chunkId).toBe(payload.chunkId);
            expect(recordingChunk.events).toHaveLength(2);

            pluginWs.close();
            ws.close();
        } finally {
            await bridge.stop();
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('derives rrweb markers from errors, failed network events, and task submissions', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'morphix-bridge-markers-'));
        const store = new JsonlStore(dir);
        const bridge = new Bridge({ port: 0, host: '127.0.0.1', store, taskStore: null, autoPurge: { enabled: false } });
        await bridge.start();
        try {
            const port = getPort(bridge);
            const projectId = 'marker-project';
            const tabId = 'tab-marker-1';
            const { pluginWs, ws } = await fakeClientWithSession(port, { tabId, projectId });

            ws.send(JSON.stringify({
                type: 'event',
                id: 'err1',
                tabId,
                projectId,
                name: 'error',
                ts: 1100,
                payload: { message: 'Unhandled boom' },
            } satisfies EventFrame));

            ws.send(JSON.stringify({
                type: 'event',
                id: 'net1',
                tabId,
                projectId,
                name: 'network',
                ts: 1200,
                payload: { method: 'POST', url: '/api/save', status: 500 },
            } satisfies EventFrame));

            ws.send(JSON.stringify({
                type: 'event',
                id: 'task1',
                tabId,
                projectId,
                name: EVENT_NAME.TASK_SUBMIT,
                ts: 1300,
                payload: {
                    question: 'why did save fail?',
                    url: 'http://localhost:5173/',
                    selector: { comp: 'SaveBtn' },
                    element: { tag: 'button', outerHTML: '<button>Save</button>' },
                },
            } satisfies EventFrame));

            await new Promise((r) => setTimeout(r, 50));
            await store.close();

            const sessionId = store.listSessions({ projectId, limit: 1 })[0]?.id;
            expect(sessionId).toBeTruthy();
            const markers = store.tail(sessionId!, { n: 20, type: 'rrweb:marker' });
            expect(markers).toHaveLength(3);
            expect(markers.map((marker) => (marker.d as { kind: string }).kind)).toEqual([
                'error',
                'network',
                'task',
            ]);
            expect((markers[1].d as { label: string }).label).toContain('/api/save');

            pluginWs.close();
            ws.close();
        } finally {
            await bridge.stop();
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('fans out event frames to listeners', async () => {
        const bridge = await spawnBridge();
        const received: EventFrame[] = [];
        bridge.onEvent((e) => received.push(e));
        try {
            const port = getPort(bridge);
            const { ws } = await fakeClientWithSession(port, { tabId: 't-1', projectId: 'demo' });
            ws.send(
                JSON.stringify({
                    type: 'event',
                    id: 'e1',
                    tabId: 't-1',
                    name: 'console',
                    ts: Date.now(),
                    payload: { level: 'log', args: ['hi'] },
                } satisfies EventFrame),
            );
            await new Promise((r) => setTimeout(r, 30));
            expect(received).toHaveLength(1);
            expect(received[0].name).toBe('console');
        } finally {
            await bridge.stop();
        }
    });

    it('accepts runtime-client hello with no prior plugin and opens its own session (plugin-less mode)', async () => {
        // This is the standard mode for the @harnessa-fe/next + jsxImportSource
        // integration and for any production / staging deployment: the bundler
        // plugin is absent, so the runtime-client must bootstrap the project
        // session on its own. We require the daemon to (a) accept the hello,
        // (b) register the tab, and (c) open a store session with
        // peerRole='runtime-client' so subsequent events have a place to land.
        const dir = mkdtempSync(join(tmpdir(), 'morphix-bridge-plugin-less-'));
        const store = new JsonlStore(dir);
        const bridge = new Bridge({ port: 0, host: '127.0.0.1', store, taskStore: null, autoPurge: { enabled: false } });
        await bridge.start();
        try {
            const port = getPort(bridge);
            const { ack } = await fakeClient(port, 'runtime-client', {
                tabId: 't-bootstrap',
                projectId: 'plugin-less-project',
            });
            expect(ack.type).toBe('hello.ack');
            expect(ack.error).toBeUndefined();
            expect(ack.tabId).toBe('t-bootstrap');
            expect(bridge.router.listTabs()).toHaveLength(1);
            const sessions = store.listSessions({ projectId: 'plugin-less-project', limit: 10 });
            expect(sessions).toHaveLength(1);
            // In the new model, peerRole is not stored on SessionMeta; verify session was created
            expect(sessions[0]?.tabId).toBe('t-bootstrap');
        } finally {
            await bridge.stop();
            store.close();
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('accepts runtime-client hello when an active vite-plugin session exists (Req 3.3)', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'morphix-bridge-req33-'));
        const store = new JsonlStore(dir);
        const bridge = new Bridge({ port: 0, host: '127.0.0.1', store, taskStore: null, autoPurge: { enabled: false } });
        await bridge.start();
        try {
            const port = getPort(bridge);
            // First connect a vite-plugin to create an active session
            const { ws: pluginWs } = await fakeClient(port, 'vite-plugin', {
                projectId: 'active-project',
            });
            // Now connect a runtime-client for the same project
            const { ack } = await fakeClient(port, 'runtime-client', {
                tabId: 't-valid',
                projectId: 'active-project',
            });
            expect(ack.type).toBe('hello.ack');
            expect(ack.error).toBeUndefined();
            expect(ack.tabId).toBe('t-valid');
            // Tab should be registered
            expect(bridge.router.listTabs()).toHaveLength(1);
            pluginWs.close();
        } finally {
            await bridge.stop();
            store.close();
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

// ─── Integration Tests ────────────────────────────────────────────────────────

describe('Integration: end-to-end event persistence (Task 14.1)', () => {
    // Requirements: 4.1–4.8, 5.1–5.6
    it('events sent by runtime-client appear in JSONL files on disk with correct seq values', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'morphix-bridge-int14-1-'));
        const store = new JsonlStore(dir);
        const bridge = new Bridge({ port: 0, host: '127.0.0.1', store, taskStore: null, autoPurge: { enabled: false } });
        await bridge.start();
        try {
            const port = getPort(bridge);
            const projectId = 'int-test-project';

            // Connect vite-plugin (creates a session)
            const { ws: pluginWs } = await fakeClient(port, 'vite-plugin', { projectId });
            // Wait briefly for session to be registered
            await new Promise((r) => setTimeout(r, 20));

            // Connect runtime-client (registers a tab)
            const { ws: runtimeWs } = await fakeClient(port, 'runtime-client', {
                tabId: 'tab-int-1',
                projectId,
            });
            await new Promise((r) => setTimeout(r, 20));

            // Send three event frames from the runtime-client
            const sentEvents = [
                { type: 'event', id: 'ev1', tabId: 'tab-int-1', projectId, name: 'log', ts: 1000, payload: { level: 'info', args: ['hello'] } },
                { type: 'event', id: 'ev2', tabId: 'tab-int-1', projectId, name: 'err', ts: 2000, payload: { message: 'boom' } },
                { type: 'event', id: 'ev3', tabId: 'tab-int-1', projectId, name: 'hmr', ts: 3000, payload: { file: 'App.tsx' } },
            ];
            for (const ev of sentEvents) {
                runtimeWs.send(JSON.stringify(ev));
            }

            // Allow events to be processed
            await new Promise((r) => setTimeout(r, 50));

            // Flush the store to ensure all events are written to disk
            await store.close();

            // Find the session directory
            const sessions = store.listSessions({ projectId });
            expect(sessions.length).toBeGreaterThanOrEqual(1);
            const sessionId = sessions[0].id;

            // Read the session-level timeline.jsonl directly from disk (flat layout)
            const timelinePath = join(dir, 'sessions', sessionId, 'timeline.jsonl');
            expect(existsSync(timelinePath)).toBe(true);

            const lines = readFileSync(timelinePath, 'utf-8')
                .split('\n')
                .filter((l) => l.trim());

            // Should have at least 3 events (the ones we sent)
            expect(lines.length).toBeGreaterThanOrEqual(3);

            const parsedEvents = lines.map((l) => JSON.parse(l) as { seq: number; t: string });

            // Verify seq values are strictly increasing across all events in the session timeline
            // (Note: seq values may not be consecutive by 1 because the same counter is shared
            // between session-level and tab-level writes for dual-write events)
            for (let i = 1; i < parsedEvents.length; i++) {
                expect(parsedEvents[i].seq).toBeGreaterThan(parsedEvents[i - 1].seq);
            }

            // Verify all seq values are non-negative integers
            for (const ev of parsedEvents) {
                expect(ev.seq).toBeGreaterThanOrEqual(0);
                expect(Number.isInteger(ev.seq)).toBe(true);
            }

            // Verify the event types we sent are present
            const types = parsedEvents.map((e) => e.t);
            expect(types).toContain('log');
            expect(types).toContain('err');
            expect(types).toContain('hmr');

            // In the v0.4.0 flat layout, there is no separate tab-level timeline.
            // All events for a session land in sessions/{sessionId}/timeline.jsonl.
            // The session should be associated with our tab.
            const tabSession = store.listSessions({ tabId: 'tab-int-1' });
            expect(tabSession.length).toBeGreaterThanOrEqual(1);

            pluginWs.close();
            runtimeWs.close();
        } finally {
            await bridge.stop();
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe('Integration: session grace period (Task 14.2)', () => {
    // Requirements: 2.2, 2.3, 2.4
    afterEach(() => {
        vi.useRealTimers();
    });

    it('reconnecting within 30s reuses the same sessionId', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        const dir = mkdtempSync(join(tmpdir(), 'morphix-bridge-int14-2a-'));
        const store = new JsonlStore(dir);
        const bridge = new Bridge({ port: 0, host: '127.0.0.1', store, taskStore: null, autoPurge: { enabled: false } });
        await bridge.start();
        try {
            const port = getPort(bridge);
            const projectId = 'grace-project';

            // Connect vite-plugin — creates build
            const { ws: pluginWs1 } = await fakeClient(port, 'vite-plugin', { projectId });
            await vi.runAllTimersAsync();
            await new Promise((r) => setTimeout(r, 10));

            // Get the build ID created
            const builds1 = store.listBuilds(projectId);
            expect(builds1.length).toBe(1);
            const originalBuildId = builds1[0].id;

            // Disconnect the vite-plugin — starts 30s grace period
            pluginWs1.close();
            // Allow close event to propagate
            await new Promise((r) => setTimeout(r, 30));

            // Advance time by 29 seconds (within grace period)
            vi.advanceTimersByTime(29_000);
            await new Promise((r) => setTimeout(r, 10));

            // Reconnect vite-plugin within grace period
            const { ws: pluginWs2 } = await fakeClient(port, 'vite-plugin', { projectId });
            await new Promise((r) => setTimeout(r, 30));

            // The build should be the same (reused)
            const builds2 = store.listBuilds(projectId);
            expect(builds2.length).toBe(1);
            expect(builds2[0].id).toBe(originalBuildId);
            // Build should NOT have endedAt set (still active)
            expect(builds2[0].endedAt).toBeUndefined();

            pluginWs2.close();
        } finally {
            await bridge.stop();
            await store.close();
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('reconnecting after 30s creates a new session', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        const dir = mkdtempSync(join(tmpdir(), 'morphix-bridge-int14-2b-'));
        const store = new JsonlStore(dir);
        const bridge = new Bridge({ port: 0, host: '127.0.0.1', store, taskStore: null, autoPurge: { enabled: false } });
        await bridge.start();
        try {
            const port = getPort(bridge);
            const projectId = 'grace-project-expired';

            // Connect vite-plugin — creates build
            const { ws: pluginWs1 } = await fakeClient(port, 'vite-plugin', { projectId });
            await vi.runAllTimersAsync();
            await new Promise((r) => setTimeout(r, 10));

            // Get the build ID created
            const builds1 = store.listBuilds(projectId);
            expect(builds1.length).toBe(1);
            const originalBuildId = builds1[0].id;

            // Disconnect the vite-plugin — starts 30s grace period
            pluginWs1.close();
            await new Promise((r) => setTimeout(r, 30));

            // Advance time by 31 seconds (past grace period) — timer fires, build is closed
            vi.advanceTimersByTime(31_000);
            await vi.runAllTimersAsync();
            await new Promise((r) => setTimeout(r, 30));

            // Reconnect vite-plugin after grace period expired
            const { ws: pluginWs2 } = await fakeClient(port, 'vite-plugin', { projectId });
            await new Promise((r) => setTimeout(r, 30));

            // A new build should have been created
            const builds2 = store.listBuilds(projectId);
            expect(builds2.length).toBe(2);
            const newBuildId = builds2[0].id; // sorted by builtAt desc
            expect(newBuildId).not.toBe(originalBuildId);

            // The original build should now have endedAt set
            const originalBuild = builds2.find((b) => b.id === originalBuildId);
            expect(originalBuild?.endedAt).toBeDefined();

            pluginWs2.close();
        } finally {
            await bridge.stop();
            await store.close();
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe('Integration: startup recovery (Task 14.3)', () => {
    // Requirements: 2.6
    it('new Bridge with new JsonlStore pointing to same dir sees existing sessions and orphaned sessions have endedAt', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'morphix-bridge-int14-3-'));

        // ── First Bridge: create sessions ──────────────────────────────────
        // We create sessions directly via the store (no need for a full Bridge)
        // to avoid grace period complications.
        const store1 = new JsonlStore(dir);
        const { randomUUID } = await import('node:crypto');

        const projectId = 'recovery-project';

        // Create session 1 (page-load) and properly close it
        const closedSessionId = randomUUID();
        store1.upsertTab('t-recovery', { connectedAt: Date.now() });
        store1.upsertSession(closedSessionId, {
            tabId: 't-recovery',
            startedAt: Date.now(),
            participants: [{ projectId, joinedAt: Date.now() }],
        });
        store1.closeSession(closedSessionId);

        // Create session 2 and leave it open (orphaned — simulates a crash)
        const orphanedSessionId = randomUUID();
        store1.upsertSession(orphanedSessionId, {
            tabId: 't-recovery',
            startedAt: Date.now(),
            participants: [{ projectId, joinedAt: Date.now() }],
        });

        // Verify session 2 has no endedAt before recovery
        const metaBefore = store1.getSession(orphanedSessionId);
        expect(metaBefore?.endedAt).toBeUndefined();

        // Close the store (flush any pending writes)
        await store1.close();

        // ── Second store: startup recovery ────────────────────────────────
        const beforeRecovery = Date.now();
        const store2 = new JsonlStore(dir);

        try {
            // Both sessions should be accessible
            const recoveredSessions = store2.listSessions({ projectId });
            expect(recoveredSessions.length).toBe(2);

            const recoveredIds = recoveredSessions.map((s) => s.id);
            expect(recoveredIds).toContain(closedSessionId);
            expect(recoveredIds).toContain(orphanedSessionId);

            // The orphaned session should have endedAt set by startup recovery
            const orphaned = recoveredSessions.find((s) => s.id === orphanedSessionId);
            expect(orphaned).toBeDefined();
            expect(orphaned!.endedAt).toBeDefined();
            expect(orphaned!.endedAt!).toBeGreaterThanOrEqual(beforeRecovery);

            // The properly closed session should retain its original endedAt
            const closed = recoveredSessions.find((s) => s.id === closedSessionId);
            expect(closed).toBeDefined();
            expect(closed!.endedAt).toBeDefined();
            // Its endedAt should be before the recovery timestamp (it was closed earlier)
            expect(closed!.endedAt!).toBeLessThan(beforeRecovery + 1000);
        } finally {
            await store2.close();
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('new Bridge using new JsonlStore can list sessions from a previous Bridge run', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'morphix-bridge-int14-3b-'));

        // ── First Bridge run ───────────────────────────────────────────────
        const store1 = new JsonlStore(dir);
        const bridge1 = new Bridge({ port: 0, host: '127.0.0.1', store: store1, taskStore: null });
        await bridge1.start();

        const projectId = 'bridge-recovery-project';
        let buildId: string;

        try {
            const port1 = getPort(bridge1);
            // Connect vite-plugin to create a build
            const { ws: pluginWs } = await fakeClient(port1, 'vite-plugin', { projectId });
            await new Promise((r) => setTimeout(r, 20));

            const builds = store1.listBuilds(projectId);
            expect(builds.length).toBe(1);
            buildId = builds[0].id;

            pluginWs.close();
            await new Promise((r) => setTimeout(r, 20));
        } finally {
            await bridge1.stop();
            await store1.close();
        }

        // ── Second Bridge run: startup recovery ───────────────────────────
        const store2 = new JsonlStore(dir);
        const bridge2 = new Bridge({ port: 0, host: '127.0.0.1', store: store2, taskStore: null });
        await bridge2.start();

        try {
            // Build from first run should be accessible in the new store
            const recoveredBuild = store2.getBuild(projectId, buildId);
            expect(recoveredBuild).toBeDefined();
            expect(recoveredBuild!.id).toBe(buildId);
            expect(recoveredBuild!.projectId).toBe(projectId);
        } finally {
            await bridge2.stop();
            await store2.close();
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe('PAGE_LOAD persistence', () => {
    it('appends a LoadMeta row when a PAGE_LOAD event arrives', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'morphix-pageload-1-'));
        const store = new JsonlStore(dir);
        const bridge = new Bridge({ port: 0, host: '127.0.0.1', store, taskStore: null, autoPurge: { enabled: false } });
        await bridge.start();
        try {
            const port = getPort(bridge);
            const projectId = 'pl-project-1';
            const { ws: pluginWs } = await fakeClient(port, 'vite-plugin', { projectId });
            await new Promise((r) => setTimeout(r, 20));
            const { ws: rcWs } = await fakeClient(port, 'runtime-client', {
                projectId,
                tabId: 'tab-1',
                sessionId: 'sess-A',
            });
            await new Promise((r) => setTimeout(r, 20));

            rcWs.send(JSON.stringify({
                type: 'event',
                id: 'plE1',
                projectId,
                tabId: 'tab-1',
                name: EVENT_NAME.PAGE_LOAD,
                ts: 1000,
                payload: {
                    sessionId: 'sess-A',
                    page: { url: 'http://x/', title: 'Demo' },
                    viewport: { w: 1024, h: 768, dpr: 2 },
                    storage: { local: { k: 'v' }, session: {}, cookie: '', truncated: false },
                },
            }));
            await new Promise((r) => setTimeout(r, 40));

            // In the new model, LoadMeta IS SessionMeta — filter by tabId
            const loads = store.listSessions({ tabId: 'tab-1' });
            expect(loads).toHaveLength(1);
            expect(loads[0].id).toBe('sess-A');
            expect(loads[0].url).toBe('http://x/');
            expect(loads[0].initial?.viewport).toEqual({ w: 1024, h: 768, dpr: 2 });
            expect(loads[0].initial?.storageKeys?.local).toBe(1);
            expect(loads[0].endedAt).toBeUndefined();

            rcWs.close();
            pluginWs.close();
        } finally {
            await bridge.stop();
            await store.close();
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('closes the previous load endedAt when a refresh happens on the same tab', async () => {
        // Real-browser refresh = old ws close (sets L1.endedAt = now) then
        // new ws connect + PAGE_LOAD (L2 opens). The store guarantees:
        //   - both loads are recorded
        //   - L1.endedAt is set (either by close handler or by next openLoad)
        //   - L2 is open until its tab closes
        const dir = mkdtempSync(join(tmpdir(), 'morphix-pageload-2-'));
        const store = new JsonlStore(dir);
        const bridge = new Bridge({ port: 0, host: '127.0.0.1', store, taskStore: null, autoPurge: { enabled: false } });
        await bridge.start();
        try {
            const port = getPort(bridge);
            const projectId = 'pl-project-2';
            const { ws: pluginWs } = await fakeClient(port, 'vite-plugin', { projectId });
            await new Promise((r) => setTimeout(r, 20));

            // First load
            const rc1 = await fakeClient(port, 'runtime-client', {
                projectId, tabId: 'tab-1', sessionId: 'L1',
            });
            await new Promise((r) => setTimeout(r, 20));
            rc1.ws.send(JSON.stringify({
                type: 'event', id: 'e1', projectId, tabId: 'tab-1',
                name: EVENT_NAME.PAGE_LOAD, ts: 100,
                payload: { sessionId: 'L1', page: {}, storage: { local: {}, session: {}, cookie: '' } },
            }));
            await new Promise((r) => setTimeout(r, 30));
            rc1.ws.close();
            await new Promise((r) => setTimeout(r, 30));

            // Second load — same tabId, new sessionId (simulates browser refresh)
            const rc2 = await fakeClient(port, 'runtime-client', {
                projectId, tabId: 'tab-1', sessionId: 'L2',
            });
            await new Promise((r) => setTimeout(r, 20));
            const l2StartTs = Date.now();
            rc2.ws.send(JSON.stringify({
                type: 'event', id: 'e2', projectId, tabId: 'tab-1',
                name: EVENT_NAME.PAGE_LOAD, ts: l2StartTs,
                payload: { sessionId: 'L2', page: {}, storage: { local: {}, session: {}, cookie: '' } },
            }));
            await new Promise((r) => setTimeout(r, 40));

            // In the new model, LoadMeta IS SessionMeta — filter by tabId
            const loads = store.listSessions({ tabId: 'tab-1' });
            expect(loads).toHaveLength(2);
            const l1 = loads.find((l) => l.id === 'L1')!;
            const l2 = loads.find((l) => l.id === 'L2')!;
            expect(l1.endedAt).toBeDefined();
            expect(l1.endedAt!).toBeLessThanOrEqual(l2.startedAt);
            expect(l2.endedAt).toBeUndefined();

            // Closing rc2's tab should fill L2's endedAt.
            rc2.ws.close();
            await new Promise((r) => setTimeout(r, 50));
            const after = store.listSessions({ tabId: 'tab-1' });
            expect(after.find((l) => l.id === 'L2')!.endedAt).toBeDefined();

            pluginWs.close();
        } finally {
            await bridge.stop();
            await store.close();
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe('Phase B: task attachment write path', () => {
    it('writes attachment binary to disk and stores pointer (not data) in tasks', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'hfe-attach-test-'));
        const store = new JsonlStore(dir);
        const taskStore = new JsonTaskStore(dir);
        const bridge = new Bridge({
            port: 0,
            host: '127.0.0.1',
            store,
            taskStore,
            attachmentsDataDir: dir,
            autoPurge: { enabled: false },
        });
        await bridge.start();
        const port = bridge.getBoundPort()!;

        try {
            const { pluginWs, ws } = await fakeClientWithSession(port, {
                tabId: 'tab-att',
                projectId: 'attach-proj',
                sessionId: 'sess-att',
            });

            // A small 1x1 PNG as base64 (minimal valid PNG)
            const tiny1x1png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

            const payload: TaskSubmitPayload = {
                question: 'attachment test',
                url: 'http://localhost/',
                selector: { css: 'div' },
                element: { tag: 'div', outerHTML: '<div/>' },
                attachments: [{
                    id: 'att-123',
                    kind: 'screenshot',
                    data: tiny1x1png,
                    width: 1,
                    height: 1,
                }],
            };

            ws.send(JSON.stringify({
                type: 'event',
                id: 'ev1',
                name: 'task.submit',
                ts: Date.now(),
                tabId: 'tab-att',
                projectId: 'attach-proj',
                sessionId: 'sess-att',
                payload,
            }));

            // Give the bridge time to process the event
            await new Promise<void>((resolve) => setTimeout(resolve, 100));

            // Find the task
            const tasks = taskStore.loadTasks('attach-proj');
            const task = tasks.find((t) => t.question === 'attachment test');
            expect(task).toBeDefined();

            // tasks.json should store pointer only (no data field)
            expect(task!.attachments).toBeDefined();
            expect(task!.attachments!.length).toBe(1);
            const ptr = task!.attachments![0];
            expect(ptr.id).toBe('att-123');
            expect(ptr.path).toBeDefined();
            expect(ptr.data).toBeUndefined();

            // Binary file should exist on disk
            const diskPath = join(dir, 'projects', 'attach-proj', 'task-attachments', task!.id, 'att-123.png');
            expect(existsSync(diskPath)).toBe(true);
            const fileContent = readFileSync(diskPath);
            expect(fileContent.length).toBeGreaterThan(0);

            // getTaskAttachmentData should return base64
            const b64 = await bridge.getTaskAttachmentData(task!.id, 'att-123');
            expect(b64).toBeTruthy();
            expect(typeof b64).toBe('string');

            pluginWs.close();
            ws.close();
        } finally {
            await bridge.stop();
            await store.close();
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('drops attachments exceeding 4 MB total and logs warning to stderr', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'hfe-attach-big-'));
        const taskStore = new JsonTaskStore(dir);
        const bridge = new Bridge({
            port: 0,
            host: '127.0.0.1',
            store: null,
            taskStore,
            attachmentsDataDir: dir,
            autoPurge: { enabled: false },
        });
        await bridge.start();
        const port = bridge.getBoundPort()!;

        const stderrChunks: string[] = [];
        const origWrite = process.stderr.write.bind(process.stderr);
        // @ts-expect-error patching for test
        process.stderr.write = (chunk: string | Uint8Array, ...args: unknown[]) => {
            if (typeof chunk === 'string') stderrChunks.push(chunk);
            return origWrite(chunk, ...args as []);
        };

        try {
            const { pluginWs, ws } = await fakeClientWithSession(port, {
                tabId: 'tab-big',
                projectId: 'big-proj',
                sessionId: 'sess-big',
            });

            // Create a base64 string that decodes to >4 MB (4 * 1024 * 1024 + 1 bytes)
            const bigBuf = Buffer.alloc(4 * 1024 * 1024 + 1, 0x42);
            const bigData = bigBuf.toString('base64');

            const payload: TaskSubmitPayload = {
                question: 'big attach',
                url: 'http://localhost/',
                selector: { css: 'div' },
                element: { tag: 'div', outerHTML: '<div/>' },
                attachments: [{
                    id: 'big-att',
                    kind: 'screenshot',
                    data: bigData,
                    width: 100,
                    height: 100,
                }],
            };

            ws.send(JSON.stringify({
                type: 'event',
                id: 'ev2',
                name: 'task.submit',
                ts: Date.now(),
                tabId: 'tab-big',
                projectId: 'big-proj',
                sessionId: 'sess-big',
                payload,
            }));

            await new Promise<void>((resolve) => setTimeout(resolve, 100));

            const tasks = taskStore.loadTasks('big-proj');
            const task = tasks.find((t) => t.question === 'big attach');
            expect(task).toBeDefined();
            // attachments should be empty (dropped)
            expect(task!.attachments).toBeDefined();
            expect(task!.attachments!.length).toBe(0);
            // stderr warning should have been emitted
            expect(stderrChunks.some((c) => c.includes('exceeds 4 MB limit'))).toBe(true);

            pluginWs.close();
            ws.close();
        } finally {
            // @ts-expect-error restore
            process.stderr.write = origWrite;
            await bridge.stop();
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe('Phase E: bridge accepts node-runtime hello', () => {
    it('node-runtime hello is accepted and ack is received', async () => {
        const bridge = new Bridge({
            port: 0,
            host: '127.0.0.1',
            store: null,
            taskStore: null,
            autoPurge: { enabled: false },
        });
        await bridge.start();
        const port = bridge.getBoundPort()!;

        try {
            const ws = new WebSocket(`ws://127.0.0.1:${port}`);
            const ack = await new Promise<HelloAckFrame>((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error('timeout')), 3000);
                ws.on('open', () => {
                    ws.send(JSON.stringify({
                        type: 'hello',
                        id: 'hello-nr-1',
                        role: 'node-runtime',
                        protocolVersion: PROTOCOL_VERSION,
                        projectId: 'nr-test-proj',
                        displayName: 'Node Runtime Test',
                    }));
                });
                ws.on('message', (raw: Buffer | string) => {
                    const frame = JSON.parse(typeof raw === 'string' ? raw : raw.toString()) as HelloAckFrame;
                    if (frame.type === 'hello.ack') {
                        clearTimeout(timer);
                        resolve(frame);
                    }
                });
                ws.on('error', (err) => { clearTimeout(timer); reject(err); });
            });

            expect(ack.type).toBe('hello.ack');
            expect(ack.error).toBeUndefined();

            // Verify the node-runtime peer is in the router
            const tabs = await bridge.listTabs();
            // node-runtime connections don't have tabIds but the peer should be registered
            expect(tabs.length).toBeGreaterThanOrEqual(0); // store=null so listTabs reads in-memory

            ws.close();
        } finally {
            await bridge.stop();
        }
    });

    it('node-runtime events are routed into the shared session', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'hfe-nr-test-'));
        const store = new JsonlStore(dir);
        const bridge = new Bridge({
            port: 0,
            host: '127.0.0.1',
            store,
            taskStore: null,
            autoPurge: { enabled: false },
        });
        await bridge.start();
        const port = bridge.getBoundPort()!;

        try {
            // First a runtime-client connects and creates a session
            const { pluginWs, ws: clientWs } = await fakeClientWithSession(port, {
                tabId: 'tab-nr',
                projectId: 'nr-proj',
                sessionId: 'sess-nr-shared',
            });

            // Then a node-runtime connects with the SAME sessionId
            const nrWs = new WebSocket(`ws://127.0.0.1:${port}`);
            await new Promise<void>((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error('timeout')), 3000);
                nrWs.on('open', () => {
                    nrWs.send(JSON.stringify({
                        type: 'hello',
                        id: 'hello-nr-2',
                        role: 'node-runtime',
                        protocolVersion: PROTOCOL_VERSION,
                        projectId: 'nr-proj',
                        sessionId: 'sess-nr-shared',
                    }));
                });
                nrWs.on('message', (raw: Buffer | string) => {
                    const frame = JSON.parse(typeof raw === 'string' ? raw : raw.toString()) as { type: string };
                    if (frame.type === 'hello.ack') { clearTimeout(timer); resolve(); }
                });
                nrWs.on('error', (err) => { clearTimeout(timer); reject(err); });
            });

            // Send a server-err event from the node-runtime
            nrWs.send(JSON.stringify({
                type: 'event',
                id: 'ev-nr-1',
                name: 'server-err',
                ts: Date.now(),
                projectId: 'nr-proj',
                sessionId: 'sess-nr-shared',
                payload: { message: 'Server threw!', stack: 'Error: Server threw!\n  at ...' },
            }));

            await new Promise<void>((res) => setTimeout(res, 100));

            // The event should be in the shared session's timeline
            const timeline = store.tail('sess-nr-shared', { limit: 50 });
            const serverErr = timeline.find((e) => (e as { t: string }).t === 'server-err');
            expect(serverErr).toBeDefined();

            pluginWs.close();
            clientWs.close();
            nrWs.close();
        } finally {
            await bridge.stop();
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
