/**
 * Unit tests for createEventsHandler — POST /events, GET /events/ping, CORS.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { PROTOCOL_VERSION } from '@harness-fe/protocol';
import { createEventsHandler } from './eventsHandler.js';

// ─── Minimal IncomingMessage / ServerResponse mocks ──────────────────────────

function makeReq(opts: {
    url: string;
    method: string;
    host?: string;
    body?: string;
}): IncomingMessage {
    const { Readable } = require('node:stream') as typeof import('node:stream');
    const stream = new Readable({ read() {} });
    const req = stream as unknown as IncomingMessage;
    req.url = opts.url;
    req.method = opts.method;
    req.headers = opts.host ? { host: opts.host } : {};
    if (opts.body !== undefined) {
        process.nextTick(() => {
            stream.push(Buffer.from(opts.body!));
            stream.push(null);
        });
    } else {
        process.nextTick(() => stream.push(null));
    }
    return req;
}

interface MockRes {
    statusCode: number;
    headers: Record<string, string>;
    body: string;
    setHeader(name: string, value: string): void;
    end(data?: string): void;
}

function makeRes(): MockRes {
    const res: MockRes = {
        statusCode: 200,
        headers: {},
        body: '',
        setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
        end(data) { if (data) this.body = data; },
    };
    return res;
}

// ─── Bridge stub ─────────────────────────────────────────────────────────────

function makeBridge(onBatch?: (hello: unknown, events: unknown[]) => void) {
    return {
        handleHttpBatch: vi.fn((hello: unknown, events: unknown[]) => {
            onBatch?.(hello, events);
        }),
    };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('eventsHandler', () => {
    describe('GET /events/ping', () => {
        it('returns 200 with ok + version', async () => {
            const bridge = makeBridge();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const handler = createEventsHandler(bridge as any);
            const req = makeReq({ url: '/events/ping', method: 'GET' });
            const res = makeRes();
            const handled = await handler(req, res as unknown as ServerResponse);
            expect(handled).toBe(true);
            expect(res.statusCode).toBe(200);
            const payload = JSON.parse(res.body) as { ok: boolean; version: string };
            expect(payload.ok).toBe(true);
            expect(payload.version).toBe(PROTOCOL_VERSION);
        });

        it('does not set CORS when host is not loopback', async () => {
            const bridge = makeBridge();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const handler = createEventsHandler(bridge as any);
            const req = makeReq({ url: '/events/ping', method: 'GET', host: 'example.com' });
            const res = makeRes();
            await handler(req, res as unknown as ServerResponse);
            expect(res.headers['access-control-allow-origin']).toBeUndefined();
        });

        it('sets CORS when host is localhost', async () => {
            const bridge = makeBridge();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const handler = createEventsHandler(bridge as any);
            const req = makeReq({ url: '/events/ping', method: 'GET', host: 'localhost:47729' });
            const res = makeRes();
            await handler(req, res as unknown as ServerResponse);
            expect(res.headers['access-control-allow-origin']).toBe('*');
        });

        it('sets CORS when host is 127.0.0.1', async () => {
            const bridge = makeBridge();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const handler = createEventsHandler(bridge as any);
            const req = makeReq({ url: '/events/ping', method: 'GET', host: '127.0.0.1:47729' });
            const res = makeRes();
            await handler(req, res as unknown as ServerResponse);
            expect(res.headers['access-control-allow-origin']).toBe('*');
        });
    });

    describe('OPTIONS preflight', () => {
        it('returns 204 for /events', async () => {
            const bridge = makeBridge();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const handler = createEventsHandler(bridge as any);
            const req = makeReq({ url: '/events', method: 'OPTIONS', host: 'localhost:47729' });
            const res = makeRes();
            const handled = await handler(req, res as unknown as ServerResponse);
            expect(handled).toBe(true);
            expect(res.statusCode).toBe(204);
        });

        it('returns 204 for /events/ping', async () => {
            const bridge = makeBridge();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const handler = createEventsHandler(bridge as any);
            const req = makeReq({ url: '/events/ping', method: 'OPTIONS', host: 'localhost:47729' });
            const res = makeRes();
            const handled = await handler(req, res as unknown as ServerResponse);
            expect(handled).toBe(true);
            expect(res.statusCode).toBe(204);
        });
    });

    describe('POST /events', () => {
        it('returns 204 and calls handleHttpBatch with valid body', async () => {
            const bridge = makeBridge();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const handler = createEventsHandler(bridge as any);
            const body = JSON.stringify({
                hello: {
                    role: 'node-runtime',
                    projectId: 'test-proj',
                    sessionId: 'sess-abc',
                    buildId: 'build-1',
                },
                events: [
                    { id: 'e1', name: 'server-err', ts: 1000, payload: { message: 'boom' } },
                    { id: 'e2', name: 'server-log', ts: 1001, payload: { level: 'info' } },
                ],
            });
            const req = makeReq({ url: '/events', method: 'POST', host: 'localhost:47729', body });
            const res = makeRes();
            const handled = await handler(req, res as unknown as ServerResponse);
            expect(handled).toBe(true);
            expect(res.statusCode).toBe(204);
            expect(bridge.handleHttpBatch).toHaveBeenCalledOnce();
            const [hello, events] = bridge.handleHttpBatch.mock.calls[0] as [unknown, unknown[]];
            expect((hello as { projectId: string }).projectId).toBe('test-proj');
            expect(events).toHaveLength(2);
        });

        it('returns 400 for invalid JSON', async () => {
            const bridge = makeBridge();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const handler = createEventsHandler(bridge as any);
            const req = makeReq({ url: '/events', method: 'POST', host: 'localhost:47729', body: '{bad json' });
            const res = makeRes();
            const handled = await handler(req, res as unknown as ServerResponse);
            expect(handled).toBe(true);
            expect(res.statusCode).toBe(400);
            expect(bridge.handleHttpBatch).not.toHaveBeenCalled();
        });

        it('returns 400 when body fails schema validation (bad role)', async () => {
            const bridge = makeBridge();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const handler = createEventsHandler(bridge as any);
            const body = JSON.stringify({
                hello: {
                    role: 'runtime-client', // wrong role
                    projectId: 'test',
                },
                events: [],
            });
            const req = makeReq({ url: '/events', method: 'POST', host: 'localhost:47729', body });
            const res = makeRes();
            await handler(req, res as unknown as ServerResponse);
            expect(res.statusCode).toBe(400);
        });

        it('returns 400 when hello.projectId is missing', async () => {
            const bridge = makeBridge();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const handler = createEventsHandler(bridge as any);
            const body = JSON.stringify({
                hello: { role: 'node-runtime' },
                events: [],
            });
            const req = makeReq({ url: '/events', method: 'POST', host: 'localhost:47729', body });
            const res = makeRes();
            await handler(req, res as unknown as ServerResponse);
            expect(res.statusCode).toBe(400);
        });

        it('returns 500 when handleHttpBatch throws', async () => {
            const bridge = {
                handleHttpBatch: vi.fn(() => { throw new Error('store error'); }),
            };
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const handler = createEventsHandler(bridge as any);
            const body = JSON.stringify({
                hello: { role: 'node-runtime', projectId: 'test', sessionId: 's1' },
                events: [],
            });
            const req = makeReq({ url: '/events', method: 'POST', host: 'localhost:47729', body });
            const res = makeRes();
            const handled = await handler(req, res as unknown as ServerResponse);
            expect(handled).toBe(true);
            expect(res.statusCode).toBe(500);
        });
    });

    describe('fall-through for unmatched routes', () => {
        it('returns false for /other', async () => {
            const bridge = makeBridge();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const handler = createEventsHandler(bridge as any);
            const req = makeReq({ url: '/other', method: 'GET' });
            const res = makeRes();
            const handled = await handler(req, res as unknown as ServerResponse);
            expect(handled).toBe(false);
        });

        it('returns false for /events/unknown-sub-path', async () => {
            const bridge = makeBridge();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const handler = createEventsHandler(bridge as any);
            const req = makeReq({ url: '/events/unknown', method: 'GET' });
            const res = makeRes();
            const handled = await handler(req, res as unknown as ServerResponse);
            expect(handled).toBe(false);
        });
    });
});
