import { describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Bridge } from './bridge.js';
import {
    EVENT_NAME,
    PROTOCOL_VERSION,
    type EventFrame,
    type Frame,
    type HelloAckFrame,
    type ResponseFrame,
    type TaskSubmitPayload,
} from '@morphixai/harnessa-fe.protocol';

async function spawnBridge(): Promise<Bridge> {
    const bridge = new Bridge({ port: 0, host: '127.0.0.1', tasksFile: '' }); // random port; no persistence in tests
    // ws library: port=0 → ephemeral assigned port; we read address() after listening.
    await bridge.start();
    return bridge;
}

function getPort(bridge: Bridge): number {
    // @ts-expect-error access private for test
    const addr = bridge.wss?.address();
    if (!addr || typeof addr === 'string') throw new Error('no address');
    return addr.port;
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
            const { ack } = await fakeClient(port, 'runtime-client', {
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
            const { ws } = await fakeClient(port, 'runtime-client', {
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
            const { ws } = await fakeClient(port, 'runtime-client', { tabId: 't-1' });
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
            const { ws } = await fakeClient(port, 'runtime-client', {
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
            const { ws } = await fakeClient(port, 'runtime-client', { tabId: 't-1' });
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
            const { ws } = await fakeClient(port, 'runtime-client', {
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

    it('persists tasks across bridge restarts via tasksFile', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'morphix-bridge-test-'));
        const tasksFile = join(dir, 'tasks.json');
        try {
            const b1 = new Bridge({ port: 0, host: '127.0.0.1', tasksFile });
            await b1.start();
            const port = getPort(b1);
            const { ws } = await fakeClient(port, 'runtime-client', {
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
            expect(existsSync(tasksFile)).toBe(true);

            const b2 = new Bridge({ port: 0, host: '127.0.0.1', tasksFile });
            await b2.start();
            try {
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

    it('fans out event frames to listeners', async () => {
        const bridge = await spawnBridge();
        const received: EventFrame[] = [];
        bridge.onEvent((e) => received.push(e));
        try {
            const port = getPort(bridge);
            const { ws } = await fakeClient(port, 'runtime-client', { tabId: 't-1' });
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
});
