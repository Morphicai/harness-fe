import { describe, it, expect, afterEach } from 'vitest';
import { WebSocketServer } from 'ws';
import {
    register,
    reportError,
    withHarnessTracing,
    getRequestSessionId,
    _resetForTest,
} from './index.js';

interface Frame {
    type: string;
    name?: string;
    role?: string;
    projectId?: string;
    sessionId?: string;
    payload?: unknown;
}

async function spawnTestServer(): Promise<{ wss: WebSocketServer; port: number; received: Frame[] }> {
    const received: Frame[] = [];
    const wss = new WebSocketServer({ port: 0 });
    await new Promise<void>((res) => wss.once('listening', res));
    wss.on('connection', (socket) => {
        socket.on('message', (raw: Buffer | string) => {
            try {
                received.push(JSON.parse(typeof raw === 'string' ? raw : raw.toString()) as Frame);
            } catch { /* ignore */ }
        });
        // Acknowledge so SDK considers itself live
        socket.send(JSON.stringify({ type: 'hello.ack', id: 'ack', protocolVersion: '1' }));
    });
    const addr = wss.address() as { port: number };
    return { wss, port: addr.port, received };
}

function closeServer(wss: WebSocketServer): Promise<void> {
    // Terminate all active connections so wss.close() resolves immediately.
    for (const client of wss.clients) {
        client.terminate();
    }
    return new Promise((res) => wss.close(() => res()));
}

afterEach(() => {
    _resetForTest();
});

describe('@harness-fe/node-runtime', () => {
    it('sends hello with role=node-runtime on connect', async () => {
        const { wss, port, received } = await spawnTestServer();
        try {
            register({ projectId: 'test-proj', mcpUrl: `ws://127.0.0.1:${port}` });
            await new Promise<void>((res) => setTimeout(res, 150));
            const hello = received.find((f) => f.type === 'hello');
            expect(hello).toBeDefined();
            expect(hello!.role).toBe('node-runtime');
            expect(hello!.projectId).toBe('test-proj');
        } finally {
            await closeServer(wss);
        }
    });

    it('reportError sends server-err event', async () => {
        const { wss, port, received } = await spawnTestServer();
        try {
            register({ projectId: 'err-proj', mcpUrl: `ws://127.0.0.1:${port}` });
            await new Promise<void>((res) => setTimeout(res, 150));
            reportError(new Error('boom'), { sessionId: 'sess-abc' });
            await new Promise<void>((res) => setTimeout(res, 50));
            const errEvent = received.find((f) => f.name === 'server-err');
            expect(errEvent).toBeDefined();
            expect(errEvent!.sessionId).toBe('sess-abc');
            const payload = errEvent!.payload as { message: string; stack?: string };
            expect(payload.message).toBe('boom');
        } finally {
            await closeServer(wss);
        }
    });

    it('withHarnessTracing propagates sessionId via ALS and sends server-action', async () => {
        const { wss, port, received } = await spawnTestServer();
        try {
            register({ projectId: 'trace-proj', mcpUrl: `ws://127.0.0.1:${port}` });
            await new Promise<void>((res) => setTimeout(res, 150));

            const handler = withHarnessTracing(async (_req: Request) => {
                return { sid: getRequestSessionId() };
            });

            const fakeReq = {
                headers: { get: (k: string) => k === 'x-hfe-session-id' ? 'sess-xyz' : null },
            } as unknown as Request;

            const result = await handler(fakeReq);
            await new Promise<void>((res) => setTimeout(res, 50));

            expect(result).toEqual({ sid: 'sess-xyz' });

            const actionEvent = received.find((f) => f.name === 'server-action');
            expect(actionEvent).toBeDefined();
            expect(actionEvent!.sessionId).toBe('sess-xyz');
            const payload = actionEvent!.payload as { status: string; durationMs: number };
            expect(payload.status).toBe('ok');
            expect(typeof payload.durationMs).toBe('number');
        } finally {
            await closeServer(wss);
        }
    });

    it('withHarnessTracing reports errors and rethrows', async () => {
        const { wss, port, received } = await spawnTestServer();
        try {
            register({ projectId: 'rethrow-proj', mcpUrl: `ws://127.0.0.1:${port}` });
            await new Promise<void>((res) => setTimeout(res, 150));

            const handler = withHarnessTracing(async () => {
                throw new Error('handler failed');
            });

            await expect(handler()).rejects.toThrow('handler failed');
            await new Promise<void>((res) => setTimeout(res, 50));

            const errEvent = received.find((f) => f.name === 'server-err');
            expect(errEvent).toBeDefined();
            const payload = errEvent!.payload as { message: string };
            expect(payload.message).toBe('handler failed');
        } finally {
            await closeServer(wss);
        }
    });

    it('is idempotent — calling register() twice connects only once', async () => {
        const { wss, port, received } = await spawnTestServer();
        try {
            register({ projectId: 'idempotent', mcpUrl: `ws://127.0.0.1:${port}` });
            register({ projectId: 'idempotent', mcpUrl: `ws://127.0.0.1:${port}` });
            register({ projectId: 'idempotent', mcpUrl: `ws://127.0.0.1:${port}` });
            await new Promise<void>((res) => setTimeout(res, 150));
            const hellos = received.filter((f) => f.type === 'hello');
            expect(hellos.length).toBe(1);
        } finally {
            await closeServer(wss);
        }
    });
});
