/**
 * Tests for the adapter-supplied sessionId provider path.
 *
 * Architecture: framework adapters (e.g. @harness-fe/next) push a request-
 * scoped sessionId resolver into node-runtime via `setSessionIdProvider()`.
 * For Next this is a React `cache()`-backed getter. node-runtime stays
 * React-agnostic; dependency direction is L2 → L1 (correct).
 *
 * Verifies that:
 *   1. getRequestSessionId() returns the provider's value when ALS is empty.
 *   2. ALS wins over provider when both are populated.
 *   3. Auto-captured console.* events inherit sessionId from the provider,
 *      so Server Component `console.log(...)` lands on the right session.
 *   4. When the provider returns undefined and ALS is empty, the event is
 *      emitted as orphan (sessionId undefined) — not misattributed.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { AsyncLocalStorage } from 'node:async_hooks';
import { WebSocketServer } from 'ws';

import {
    register,
    getRequestSessionId,
    setSessionIdProvider,
    withHarnessTracing,
    _resetForTest,
} from './index.js';

// Stand-in for `@harness-fe/next/sessionId.getSessionId` — tests inject
// it via setSessionIdProvider, exactly the way the real Next adapter does
// on module load.
const mockGetSessionId = vi.fn<() => string | undefined>(() => undefined);

interface Frame {
    type: string;
    name?: string;
    sessionId?: string;
    payload?: { level?: string; args?: string[] };
}

let wss: WebSocketServer;
let port: number;
let received: Frame[];

async function spawnTestServer(): Promise<void> {
    received = [];
    wss = new WebSocketServer({ port: 0 });
    await new Promise<void>((res) => wss.once('listening', res));
    wss.on('connection', (socket) => {
        socket.on('message', (raw: Buffer | string) => {
            try {
                received.push(JSON.parse(typeof raw === 'string' ? raw : raw.toString()) as Frame);
            } catch { /* ignore */ }
        });
        socket.send(JSON.stringify({ type: 'hello.ack', id: 'ack', protocolVersion: '1' }));
    });
    port = (wss.address() as { port: number }).port;
}

async function closeServer(): Promise<void> {
    for (const client of wss.clients) client.terminate();
    await new Promise<void>((res) => wss.close(() => res()));
}

beforeAll(async () => {
    await spawnTestServer();
    register({ projectId: 'cache-test', mcpUrl: `ws://127.0.0.1:${port}` });
    // Mimic what @harness-fe/next's sessionId.ts side-effect does on
    // module load — plug the mock getter in via the public DI API.
    setSessionIdProvider(() => mockGetSessionId());
    // Let WS handshake complete.
    await new Promise<void>((r) => setTimeout(r, 200));
});

afterAll(async () => {
    _resetForTest();
    await closeServer();
});

beforeEach(() => {
    mockGetSessionId.mockReset();
    mockGetSessionId.mockReturnValue(undefined);
    received.length = 0;
});

describe('getRequestSessionId() adapter provider fallback', () => {
    it('returns sessionId from adapter provider when ALS is empty', () => {
        mockGetSessionId.mockReturnValue('cache-sid-1');
        expect(getRequestSessionId()).toBe('cache-sid-1');
    });

    it('returns undefined when provider returns undefined and ALS is empty', () => {
        mockGetSessionId.mockReturnValue(undefined);
        expect(getRequestSessionId()).toBeUndefined();
    });

    it('swallows exceptions thrown by provider (out-of-render-scope)', () => {
        mockGetSessionId.mockImplementation(() => {
            throw new Error('not in a React render scope');
        });
        expect(getRequestSessionId()).toBeUndefined();
    });

    it('ALS sessionId wins over adapter provider when both are populated', async () => {
        mockGetSessionId.mockReturnValue('cache-sid');
        const handler = withHarnessTracing(async () => getRequestSessionId());
        const req = {
            headers: {
                get: (k: string) => (k === 'x-hfe-session-id' ? 'als-sid' : null),
            },
        } as unknown as Request;
        const sid = await handler(req);
        expect(sid).toBe('als-sid');
    });
});

describe('console capture inherits sessionId from adapter provider', () => {
    it('console.log inside provider scope emits server-log with that sessionId', async () => {
        mockGetSessionId.mockReturnValue('render-sid-A');
        console.log('payload-A');
        await new Promise<void>((r) => setTimeout(r, 80));

        const evt = received.find(
            (f) =>
                f.name === 'server-log' &&
                (f.payload?.args ?? []).includes('payload-A'),
        );
        expect(evt).toBeDefined();
        expect(evt!.sessionId).toBe('render-sid-A');
    });

    it('orphan console.log (no ALS, provider returns undefined) has sessionId undefined', async () => {
        mockGetSessionId.mockReturnValue(undefined);
        console.log('payload-orphan');
        await new Promise<void>((r) => setTimeout(r, 80));

        const evt = received.find(
            (f) =>
                f.name === 'server-log' &&
                (f.payload?.args ?? []).includes('payload-orphan'),
        );
        expect(evt).toBeDefined();
        expect(evt!.sessionId).toBeUndefined();
    });

    it('two concurrent renders with different provider values do not cross-contaminate', async () => {
        // Simulate two interleaved Server Component renders by swapping
        // mock return between calls. Each console.log reads the getter
        // FRESH at emit-time — no closure over stale identity.
        mockGetSessionId.mockReturnValue('sid-req-1');
        console.log('marker-req-1');

        mockGetSessionId.mockReturnValue('sid-req-2');
        console.log('marker-req-2');

        mockGetSessionId.mockReturnValue('sid-req-1');
        console.log('marker-req-1-second');

        await new Promise<void>((r) => setTimeout(r, 80));

        const evt1 = received.find(
            (f) => f.name === 'server-log' && (f.payload?.args ?? []).includes('marker-req-1'),
        );
        const evt2 = received.find(
            (f) => f.name === 'server-log' && (f.payload?.args ?? []).includes('marker-req-2'),
        );
        const evt3 = received.find(
            (f) =>
                f.name === 'server-log' &&
                (f.payload?.args ?? []).includes('marker-req-1-second'),
        );

        expect(evt1?.sessionId).toBe('sid-req-1');
        expect(evt2?.sessionId).toBe('sid-req-2');
        expect(evt3?.sessionId).toBe('sid-req-1');
    });

    it('two browser tabs hitting server concurrently keep their own sessionId', async () => {
        // Simulates two tabs each making a Server Component request at the
        // same time. React's cache() sits on top of AsyncLocalStorage —
        // each request lives inside its own ALS scope, so even though they
        // run interleaved in the same Node process, the cache() getter
        // returns a different sessionId per scope.
        //
        // We model that here: our mock getter reads from a test-local ALS,
        // then we run two async functions in parallel via Promise.all,
        // each inside its own .run(sid, fn) frame. If the fix is correct,
        // every console.log inside tab-A's scope must carry tab-A's sid,
        // and same for tab-B — no matter how they interleave.
        const tabAls = new AsyncLocalStorage<string>();
        mockGetSessionId.mockImplementation(() => tabAls.getStore());

        const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

        const runTab = (sid: string, label: string) =>
            tabAls.run(sid, async () => {
                console.log(`${label}-start`);
                await delay(5);
                console.log(`${label}-mid`);
                await delay(10);
                console.log(`${label}-end`);
            });

        await Promise.all([
            runTab('tab-A-sid', 'tabA'),
            runTab('tab-B-sid', 'tabB'),
        ]);
        await delay(120);

        const byMarker = (marker: string) =>
            received.find(
                (f) =>
                    f.name === 'server-log' &&
                    (f.payload?.args ?? []).includes(marker),
            );

        for (const phase of ['start', 'mid', 'end']) {
            const a = byMarker(`tabA-${phase}`);
            const b = byMarker(`tabB-${phase}`);
            expect(a, `tabA-${phase} should have been emitted`).toBeDefined();
            expect(b, `tabB-${phase} should have been emitted`).toBeDefined();
            expect(a!.sessionId).toBe('tab-A-sid');
            expect(b!.sessionId).toBe('tab-B-sid');
        }

        // Sanity: NO frame from tab A carries B's sid and vice versa.
        const tabAFrames = received.filter((f) =>
            (f.payload?.args ?? []).some((s) => typeof s === 'string' && s.startsWith('tabA-')),
        );
        const tabBFrames = received.filter((f) =>
            (f.payload?.args ?? []).some((s) => typeof s === 'string' && s.startsWith('tabB-')),
        );
        for (const f of tabAFrames) expect(f.sessionId).toBe('tab-A-sid');
        for (const f of tabBFrames) expect(f.sessionId).toBe('tab-B-sid');
    });
});
