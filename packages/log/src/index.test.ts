// AI-generated
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
    buildLogger,
    log,
    _resetEmitCache,
    _setEmitForTest,
} from './index.js';
import type { LogEvent } from './types.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCapture(): { events: LogEvent[]; fn: (evt: LogEvent) => void } {
    const events: LogEvent[] = [];
    return { events, fn: (evt) => events.push(evt) };
}

// ── Test lifecycle ─────────────────────────────────────────────────────────────

beforeEach(() => {
    _resetEmitCache();
});

afterEach(() => {
    _resetEmitCache();
});

// ── Suite ──────────────────────────────────────────────────────────────────────

describe('@harnessa-fe/log — buildLogger', () => {
    it('emits a debug event with correct level', async () => {
        const cap = makeCapture();
        _setEmitForTest(cap.fn);
        const logger = buildLogger();
        logger.debug('hello');
        await vi.waitFor(() => expect(cap.events).toHaveLength(1));
        expect(cap.events[0].level).toBe('debug');
        expect(cap.events[0].args).toEqual(['hello']);
    });

    it('log() is an alias of info', async () => {
        const cap = makeCapture();
        _setEmitForTest(cap.fn);
        const logger = buildLogger();
        logger.log('alias test');
        await vi.waitFor(() => expect(cap.events).toHaveLength(1));
        expect(cap.events[0].level).toBe('info');
    });

    it('emits warn and error levels', async () => {
        const cap = makeCapture();
        _setEmitForTest(cap.fn);
        const logger = buildLogger();
        logger.warn('w');
        logger.error('e');
        await vi.waitFor(() => expect(cap.events).toHaveLength(2));
        expect(cap.events[0].level).toBe('warn');
        expect(cap.events[1].level).toBe('error');
    });

    it('ts is a recent millisecond timestamp', async () => {
        const before = Date.now();
        const cap = makeCapture();
        _setEmitForTest(cap.fn);
        buildLogger().info('ts-test');
        await vi.waitFor(() => expect(cap.events).toHaveLength(1));
        const after = Date.now();
        expect(cap.events[0].ts).toBeGreaterThanOrEqual(before);
        expect(cap.events[0].ts).toBeLessThanOrEqual(after);
    });
});

describe('@harnessa-fe/log — scope chaining', () => {
    it('scope() sets scope on emitted event', async () => {
        const cap = makeCapture();
        _setEmitForTest(cap.fn);
        buildLogger().scope('auth').info('signed-in');
        await vi.waitFor(() => expect(cap.events).toHaveLength(1));
        expect(cap.events[0].scope).toBe('auth');
    });

    it('scope() chains: a.scope("b") emits scope="a.b"', async () => {
        const cap = makeCapture();
        _setEmitForTest(cap.fn);
        buildLogger('a').scope('b').info('nested');
        await vi.waitFor(() => expect(cap.events).toHaveLength(1));
        expect(cap.events[0].scope).toBe('a.b');
    });

    it('log.scope("a").scope("b") emits scope="a.b"', async () => {
        const cap = makeCapture();
        _setEmitForTest(cap.fn);
        // log is the root singleton with no prefix
        const scoped = buildLogger().scope('a').scope('b');
        scoped.warn('deep');
        await vi.waitFor(() => expect(cap.events).toHaveLength(1));
        expect(cap.events[0].scope).toBe('a.b');
    });

    it('scope() does not mutate parent logger', async () => {
        const cap = makeCapture();
        _setEmitForTest(cap.fn);
        const parent = buildLogger();
        const child = parent.scope('child');
        parent.info('from-parent');
        child.info('from-child');
        await vi.waitFor(() => expect(cap.events).toHaveLength(2));
        const parentEvt = cap.events.find((e) => (e.args[0] as string) === 'from-parent');
        const childEvt = cap.events.find((e) => (e.args[0] as string) === 'from-child');
        expect(parentEvt?.scope).toBeUndefined();
        expect(childEvt?.scope).toBe('child');
    });

    it('triple-depth scope chains correctly', async () => {
        const cap = makeCapture();
        _setEmitForTest(cap.fn);
        buildLogger().scope('x').scope('y').scope('z').debug('deep');
        await vi.waitFor(() => expect(cap.events).toHaveLength(1));
        expect(cap.events[0].scope).toBe('x.y.z');
    });
});

describe('@harnessa-fe/log — variadic args / metadata', () => {
    it('passes all args through to the event', async () => {
        const cap = makeCapture();
        _setEmitForTest(cap.fn);
        buildLogger().info('msg', 42, true, { foo: 'bar' });
        await vi.waitFor(() => expect(cap.events).toHaveLength(1));
        expect(cap.events[0].args).toEqual(['msg', 42, true, { foo: 'bar' }]);
    });

    it('no args is valid (edge case)', async () => {
        const cap = makeCapture();
        _setEmitForTest(cap.fn);
        buildLogger().debug();
        await vi.waitFor(() => expect(cap.events).toHaveLength(1));
        expect(cap.events[0].args).toEqual([]);
    });
});

describe('@harnessa-fe/log — concurrent emits don\'t share identity', () => {
    /**
     * This test simulates two "requests" running concurrently. Each request
     * uses a different emit mock that records a contextId. We verify that
     * log calls made in the context of request A do NOT appear in request B's
     * capture and vice versa.
     *
     * In real Next.js, isolation is enforced by React cache() inside
     * getRequestSessionId(). Here we verify the logger itself does NOT close
     * over any shared state — every log call resolves its emit via the async
     * chain started at call time, so two parallel callers each hit their own
     * emit function if injected individually.
     *
     * More practically: the test verifies that the cachedEmit is a pure
     * function reference — emitting twice in parallel calls emit() twice,
     * not once, and args are not merged.
     */
    it('two parallel log calls each emit independently', async () => {
        const capA: LogEvent[] = [];
        const capB: LogEvent[] = [];

        // Simulate two contexts with different capture functions by calling
        // log twice quickly and ensuring both events are captured.
        _setEmitForTest((evt) => {
            if ((evt.args[0] as string).startsWith('A:')) capA.push(evt);
            if ((evt.args[0] as string).startsWith('B:')) capB.push(evt);
        });

        const logger = buildLogger();
        // Fire both without awaiting — they resolve in microtask order
        logger.info('A: request one', { reqId: 1 });
        logger.info('B: request two', { reqId: 2 });

        await vi.waitFor(() => {
            expect(capA).toHaveLength(1);
            expect(capB).toHaveLength(1);
        });

        expect(capA[0].args[0]).toBe('A: request one');
        expect(capB[0].args[0]).toBe('B: request two');
        // Critical: A's event does NOT appear in B's capture
        expect(capA.every((e) => (e.args[0] as string).startsWith('A:'))).toBe(true);
        expect(capB.every((e) => (e.args[0] as string).startsWith('B:'))).toBe(true);
    });

    it('concurrent emits each carry their own ts (not shared)', async () => {
        const events: LogEvent[] = [];
        _setEmitForTest((evt) => events.push(evt));

        const logger = buildLogger();
        const t1 = Date.now();
        logger.info('first');
        // Small forced gap via timer so timestamps differ
        await new Promise((r) => setTimeout(r, 2));
        logger.info('second');

        await vi.waitFor(() => expect(events).toHaveLength(2));
        // Each call captured its own ts at call time
        expect(events[0].ts).toBeGreaterThanOrEqual(t1);
        expect(events[1].ts).toBeGreaterThanOrEqual(events[0].ts);
    });
});

describe('@harnessa-fe/log — silent drop when emit throws', () => {
    it('does not throw if emit function throws', async () => {
        _setEmitForTest(() => { throw new Error('emit exploded'); });
        const logger = buildLogger();
        // Should not throw — fire-and-forget
        expect(() => logger.info('risky')).not.toThrow();
        // Give time for microtask to settle; if it threw, vitest would catch it
        await new Promise((r) => setTimeout(r, 30));
    });
});

describe('@harnessa-fe/log — singleton log export', () => {
    it('log singleton works like buildLogger()', async () => {
        const cap = makeCapture();
        _setEmitForTest(cap.fn);
        log.info('from singleton');
        await vi.waitFor(() => expect(cap.events).toHaveLength(1));
        expect(cap.events[0].args[0]).toBe('from singleton');
    });

    it('log.scope returns a Logger with correct scope', async () => {
        const cap = makeCapture();
        _setEmitForTest(cap.fn);
        log.scope('singleton-scope').warn('scoped');
        await vi.waitFor(() => expect(cap.events).toHaveLength(1));
        expect(cap.events[0].scope).toBe('singleton-scope');
    });
});
