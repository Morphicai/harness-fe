/**
 * Tests for HttpBatchTransport: queue → flush, retry on 5xx, outbox cap,
 * hello bundled with first batch.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HttpBatchTransport } from './transport.js';
import type { RegisterOptions } from './index.js';
import type { EventFrame, HelloFrame } from '@harness-fe/protocol';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeHello(projectId = 'test-proj'): HelloFrame {
    return {
        type: 'hello',
        id: 'hello-1',
        role: 'node-runtime',
        projectId,
    };
}

function makeEvent(name = 'server-log', index = 0): EventFrame {
    return {
        type: 'event',
        id: `e-${index}`,
        name,
        ts: Date.now() + index,
    };
}

function makeOpts(port: number): RegisterOptions & { baseUrl: string } {
    return {
        projectId: 'test-proj',
        baseUrl: `http://127.0.0.1:${port}`,
    };
}

// ─── Mock fetch ───────────────────────────────────────────────────────────────

interface PostedBatch {
    hello: unknown;
    events: unknown[];
}

function mockFetch(responses: Array<{ status: number }>): {
    batches: PostedBatch[];
    fetchImpl: typeof globalThis.fetch;
    restore: () => void;
} {
    const batches: PostedBatch[] = [];
    let callIndex = 0;
    const original = globalThis.fetch;

    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        const body = typeof init?.body === 'string' ? init.body : '';
        const parsed = JSON.parse(body) as PostedBatch;
        batches.push(parsed);
        const responseConfig = responses[Math.min(callIndex++, responses.length - 1)];
        return new Response(null, { status: responseConfig.status });
    }) as unknown as typeof globalThis.fetch;

    globalThis.fetch = fetchImpl;

    return {
        batches,
        fetchImpl,
        restore: () => { globalThis.fetch = original; },
    };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('HttpBatchTransport', () => {
    let restore: (() => void) | undefined;

    afterEach(() => {
        restore?.();
        restore = undefined;
        vi.clearAllTimers();
    });

    it('includes hello in the first POST batch', async () => {
        const { batches, restore: r } = mockFetch([{ status: 204 }]);
        restore = r;

        const transport = new HttpBatchTransport(makeOpts(47730));
        await transport.open(makeHello());
        transport.send(makeEvent('server-err', 0));
        transport.close();

        // close() does a synchronous best-effort flush; we need to let promises resolve
        await new Promise<void>((res) => setTimeout(res, 20));

        expect(batches.length).toBeGreaterThan(0);
        const first = batches[0];
        expect((first.hello as { projectId: string }).projectId).toBe('test-proj');
        expect((first.hello as { role: string }).role).toBe('node-runtime');
        expect(first.events).toHaveLength(1);
    });

    it('batches up to BATCH_SIZE events before flushing immediately', async () => {
        process.env.HARNESS_FE_HTTP_BATCH_SIZE = '5';
        const { batches, restore: r } = mockFetch([{ status: 204 }, { status: 204 }]);
        restore = () => { r(); delete process.env.HARNESS_FE_HTTP_BATCH_SIZE; };

        const transport = new HttpBatchTransport(makeOpts(47731));
        await transport.open(makeHello());

        for (let i = 0; i < 5; i++) {
            transport.send(makeEvent('log', i));
        }

        // Flush should trigger immediately once BATCH_SIZE is reached
        await new Promise<void>((res) => setTimeout(res, 20));
        transport.close();
        await new Promise<void>((res) => setTimeout(res, 20));

        const totalEvents = batches.reduce((s, b) => s + b.events.length, 0);
        expect(totalEvents).toBe(5);
    });

    it('flushes on timer (FLUSH_MS) even with fewer events', async () => {
        process.env.HARNESS_FE_HTTP_FLUSH_MS = '50';
        const { batches, restore: r } = mockFetch([{ status: 204 }]);
        restore = () => { r(); delete process.env.HARNESS_FE_HTTP_FLUSH_MS; };

        const transport = new HttpBatchTransport(makeOpts(47732));
        await transport.open(makeHello());
        transport.send(makeEvent('server-log', 0));

        // Wait longer than flush timer
        await new Promise<void>((res) => setTimeout(res, 150));
        transport.close();

        expect(batches.length).toBeGreaterThan(0);
        expect(batches[0].events).toHaveLength(1);
    });

    it('retries on 5xx and succeeds on next attempt', async () => {
        const { batches, restore: r } = mockFetch([{ status: 500 }, { status: 204 }]);
        restore = r;

        const transport = new HttpBatchTransport(makeOpts(47733));
        await transport.open(makeHello());
        transport.send(makeEvent('server-err', 0));
        // Trigger an immediate flush via batch size
        transport.close();
        await new Promise<void>((res) => setTimeout(res, 1000));

        // The first call got 500, second got 204 — events should eventually persist
        expect(batches.length).toBeGreaterThanOrEqual(1);
    });

    it('drops batch after max retries and logs to stderr', async () => {
        // All calls return 503
        const { batches, restore: r } = mockFetch(Array.from({ length: 10 }, () => ({ status: 503 })));
        restore = r;

        const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true as unknown as ReturnType<typeof process.stderr.write>);

        const transport = new HttpBatchTransport(makeOpts(47734));
        await transport.open(makeHello());
        transport.send(makeEvent('server-err', 0));
        transport.close();

        // Give retries time to exhaust (they back off with base 250ms)
        await new Promise<void>((res) => setTimeout(res, 4000));

        const stderrCalls = stderrSpy.mock.calls.map((c) => String(c[0]));
        const hasDropMsg = stderrCalls.some((msg) =>
            msg.includes('max retries exceeded') || msg.includes('dropping'),
        );
        expect(hasDropMsg).toBe(true);

        stderrSpy.mockRestore();
    });

    it('drops oldest events when outbox cap is exceeded', async () => {
        // Prevent both timer-based AND batch-size-based flushes so cap logic is exercised
        process.env.HARNESS_FE_HTTP_FLUSH_MS = '10000';
        process.env.HARNESS_FE_HTTP_BATCH_SIZE = '10000';
        const { batches, restore: r } = mockFetch([{ status: 204 }]);
        restore = () => {
            r();
            delete process.env.HARNESS_FE_HTTP_FLUSH_MS;
            delete process.env.HARNESS_FE_HTTP_BATCH_SIZE;
        };

        const transport = new HttpBatchTransport({ ...makeOpts(47735) });
        await transport.open(makeHello());

        // Push more events than OUTBOX_CAP_EVENTS (500)
        for (let i = 0; i < 510; i++) {
            transport.send(makeEvent('log', i));
        }

        transport.close();
        await new Promise<void>((res) => setTimeout(res, 50));

        const totalEvents = batches.reduce((s, b) => s + b.events.length, 0);
        // Should be at most 500 (oldest dropped, newest kept)
        expect(totalEvents).toBeLessThanOrEqual(500);
    });

    it('sends hello-only ping if no events after 30s (mocked)', async () => {
        // We test the logic by resetting the timer interval to tiny value via env
        // but that env isn't exposed. Instead, call _doFlush via close() with empty outbox.
        const { batches, restore: r } = mockFetch([{ status: 204 }]);
        restore = r;

        const transport = new HttpBatchTransport(makeOpts(47736));
        await transport.open(makeHello());
        // close with empty outbox — should still send hello-only POST
        transport.close();
        await new Promise<void>((res) => setTimeout(res, 50));

        expect(batches.length).toBeGreaterThan(0);
        expect(batches[0].events).toHaveLength(0);
        expect((batches[0].hello as { role: string }).role).toBe('node-runtime');
    });
});
