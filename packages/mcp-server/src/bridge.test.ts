import { describe, expect, it, vi, afterEach } from 'vitest';
import { WebSocket } from 'ws';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Bridge } from './bridge.js';
import { JsonlStore, JsonTaskStore } from './store/index.js';
import {
    EVENT_NAME,
    PROTOCOL_VERSION,
    type RrwebChunkPayload,
    type EventFrame,
    type Frame,
    type HelloAckFrame,
    type ResponseFrame,
    type TaskSubmitPayload,
} from '@morphixai/harnessa-fe.protocol';

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
    opts: { tabId?: string; projectId?: string } = {},
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
    opts: { tabId?: string; projectId?: string } = {},
): Promise<{ ws: WebSocket; ack: HelloAckFrame }> {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise<void>((resolve, reject) => {
        ws.once('open', () => resolve());
        ws.once('error', reject);
    });
    ws.send(
        JSON.stringify({
            type: 'hello',
            id: 'h1',
            role,
            projectId: opts.projectId ?? 'demo',
            tabId: opts.tabId,
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
        const bridge = new Bridge({ port: 0, host: '127.0.0.1', store, taskStore: null });
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

            const sessionId = store.listSessions(projectId, 1)[0]?.id;
            expect(sessionId).toBeTruthy();

            const rrwebLine = store.tail(sessionId!, { n: 20 }).find((line) => line.t === 'rrweb');
            expect(rrwebLine).toBeTruthy();
            expect(rrwebLine?.d).toMatchObject({
                chunkId: payload.chunkId,
                eventCount: payload.eventCount,
            });
            expect((rrwebLine?.d as { events?: unknown[] } | undefined)?.events).toBeUndefined();

            const recordingPath = join(dir, projectId, 'sessions', sessionId!, 'tabs', tabId, 'recording.jsonl');
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
        const bridge = new Bridge({ port: 0, host: '127.0.0.1', store, taskStore: null });
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

            const sessionId = store.listSessions(projectId, 1)[0]?.id;
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

    it('rejects runtime-client hello with error ack when no active session exists (Req 3.4)', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'morphix-bridge-req34-'));
        const store = new JsonlStore(dir);
        const bridge = new Bridge({ port: 0, host: '127.0.0.1', store, taskStore: null });
        await bridge.start();
        try {
            const port = getPort(bridge);
            // Connect runtime-client without any vite-plugin session active
            const { ack } = await fakeClient(port, 'runtime-client', {
                tabId: 't-orphan',
                projectId: 'no-session-project',
            });
            expect(ack.type).toBe('hello.ack');
            expect(ack.error).toBeDefined();
            expect(typeof ack.error).toBe('string');
            // Should NOT register the tab in the router
            expect(bridge.router.listTabs()).toHaveLength(0);
        } finally {
            await bridge.stop();
            store.close();
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('accepts runtime-client hello when an active vite-plugin session exists (Req 3.3)', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'morphix-bridge-req33-'));
        const store = new JsonlStore(dir);
        const bridge = new Bridge({ port: 0, host: '127.0.0.1', store, taskStore: null });
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
        const bridge = new Bridge({ port: 0, host: '127.0.0.1', store, taskStore: null });
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
            const sessions = store.listSessions(projectId);
            expect(sessions.length).toBeGreaterThanOrEqual(1);
            const sessionId = sessions[0].id;

            // Read the session-level timeline.jsonl directly from disk
            const timelinePath = join(dir, projectId, 'sessions', sessionId, 'timeline.jsonl');
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

            // Verify tab-level timeline also has the events
            const tabTimelinePath = join(
                dir, projectId, 'sessions', sessionId, 'tabs', 'tab-int-1', 'timeline.jsonl',
            );
            expect(existsSync(tabTimelinePath)).toBe(true);
            const tabLines = readFileSync(tabTimelinePath, 'utf-8')
                .split('\n')
                .filter((l) => l.trim());
            expect(tabLines.length).toBeGreaterThanOrEqual(3);

            // Tab timeline seq values should also be strictly increasing
            const tabEvents = tabLines.map((l) => JSON.parse(l) as { seq: number });
            for (let i = 1; i < tabEvents.length; i++) {
                expect(tabEvents[i].seq).toBeGreaterThan(tabEvents[i - 1].seq);
            }

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
        const bridge = new Bridge({ port: 0, host: '127.0.0.1', store, taskStore: null });
        await bridge.start();
        try {
            const port = getPort(bridge);
            const projectId = 'grace-project';

            // Connect vite-plugin — creates session
            const { ws: pluginWs1 } = await fakeClient(port, 'vite-plugin', { projectId });
            await vi.runAllTimersAsync();
            await new Promise((r) => setTimeout(r, 10));

            // Get the session ID created
            const sessions1 = store.listSessions(projectId);
            expect(sessions1.length).toBe(1);
            const originalSessionId = sessions1[0].id;

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

            // The session should be the same (reused)
            const sessions2 = store.listSessions(projectId);
            expect(sessions2.length).toBe(1);
            expect(sessions2[0].id).toBe(originalSessionId);
            // Session should NOT have endedAt set (still active)
            expect(sessions2[0].endedAt).toBeUndefined();

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
        const bridge = new Bridge({ port: 0, host: '127.0.0.1', store, taskStore: null });
        await bridge.start();
        try {
            const port = getPort(bridge);
            const projectId = 'grace-project-expired';

            // Connect vite-plugin — creates session
            const { ws: pluginWs1 } = await fakeClient(port, 'vite-plugin', { projectId });
            await vi.runAllTimersAsync();
            await new Promise((r) => setTimeout(r, 10));

            // Get the session ID created
            const sessions1 = store.listSessions(projectId);
            expect(sessions1.length).toBe(1);
            const originalSessionId = sessions1[0].id;

            // Disconnect the vite-plugin — starts 30s grace period
            pluginWs1.close();
            await new Promise((r) => setTimeout(r, 30));

            // Advance time by 31 seconds (past grace period) — timer fires, session is closed
            vi.advanceTimersByTime(31_000);
            await vi.runAllTimersAsync();
            await new Promise((r) => setTimeout(r, 30));

            // Reconnect vite-plugin after grace period expired
            const { ws: pluginWs2 } = await fakeClient(port, 'vite-plugin', { projectId });
            await new Promise((r) => setTimeout(r, 30));

            // A new session should have been created
            const sessions2 = store.listSessions(projectId);
            expect(sessions2.length).toBe(2);
            const newSessionId = sessions2[0].id; // sorted by startedAt desc
            expect(newSessionId).not.toBe(originalSessionId);

            // The original session should now have endedAt set
            const originalSession = sessions2.find((s) => s.id === originalSessionId);
            expect(originalSession?.endedAt).toBeDefined();

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

        const projectId = 'recovery-project';

        // Create session 1 and properly close it
        const closedSessionId = store1.openSession(projectId, { peerRole: 'vite-plugin' });
        store1.closeSession(closedSessionId);

        // Create session 2 and leave it open (orphaned — simulates a crash)
        const orphanedSessionId = store1.openSession(projectId, { peerRole: 'vite-plugin' });

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
            const recoveredSessions = store2.listSessions(projectId);
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
        let sessionId: string;

        try {
            const port1 = getPort(bridge1);
            // Connect vite-plugin to create a session
            const { ws: pluginWs } = await fakeClient(port1, 'vite-plugin', { projectId });
            await new Promise((r) => setTimeout(r, 20));

            const sessions = store1.listSessions(projectId);
            expect(sessions.length).toBe(1);
            sessionId = sessions[0].id;

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
            // Session from first run should be accessible
            const recoveredSession = store2.getSession(sessionId);
            expect(recoveredSession).toBeDefined();
            expect(recoveredSession!.id).toBe(sessionId);
            expect(recoveredSession!.projectId).toBe(projectId);

            // Orphaned session (grace period was active when bridge1 stopped)
            // should have endedAt set by startup recovery
            expect(recoveredSession!.endedAt).toBeDefined();
        } finally {
            await bridge2.stop();
            await store2.close();
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
