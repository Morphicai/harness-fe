// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { COMMAND, type ConsoleEntry, type NetworkEntry, type WsEntry, type ErrorEntry } from '@harness-fe/protocol';
import { commandHandlers } from './commands.js';
import type { CaptureStore } from './capture.js';

/**
 * Construct a fake CaptureStore wide enough to drive the *_TAIL handlers.
 * We seed the RingBuffers directly so we don't have to actually patch fetch /
 * console / WebSocket in this test.
 */
function makeCapture(seed: {
    console?: ConsoleEntry[];
    network?: NetworkEntry[];
    networkFrames?: NetworkEntry[];
    errors?: ErrorEntry[];
    ws?: WsEntry[];
    dropped?: number;
}): CaptureStore {
    function ring<T>(items: T[], dropped = 0) {
        return {
            tail: (n: number) => items.slice(-n),
            all: () => items.slice(),
            size: () => items.length,
            cap: () => 200,
            dropped: () => dropped,
        };
    }
    const network = ring(seed.network ?? [], seed.dropped ?? 0);
    const networkFrames = ring(seed.networkFrames ?? []);
    return {
        console: ring(seed.console ?? []),
        network,
        networkFrames,
        networkAll: (includeFrames = true) =>
            [...network.all(), ...(includeFrames ? networkFrames.all() : [])]
                .sort((a, b) => a.ts - b.ts),
        errors: ring(seed.errors ?? []),
        ws: ring(seed.ws ?? []),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
}

describe('console.tail filtering', () => {
    const seed: ConsoleEntry[] = [
        { ts: 1, level: 'log', args: ['boot complete'] },
        { ts: 2, level: 'warn', args: ['cache miss'] },
        { ts: 3, level: 'error', args: ['logout failed', { reason: 'token expired' }] },
        { ts: 4, level: 'log', args: ['heartbeat'] },
    ];

    it('filter substring (case-insensitive)', async () => {
        const out = await commandHandlers[COMMAND.CONSOLE_TAIL](
            { n: 10, filter: 'LOGOUT' },
            { capture: makeCapture({ console: seed }) },
        ) as { entries: ConsoleEntry[] };
        expect(out.entries.map((e) => e.level)).toEqual(['error']);
    });

    it('filter regex', async () => {
        const out = await commandHandlers[COMMAND.CONSOLE_TAIL](
            { n: 10, filter: 'boot|heart', match: 'regex' },
            { capture: makeCapture({ console: seed }) },
        ) as { entries: ConsoleEntry[] };
        expect(out.entries).toHaveLength(2);
    });

    it('level narrow', async () => {
        const out = await commandHandlers[COMMAND.CONSOLE_TAIL](
            { n: 10, level: 'error' },
            { capture: makeCapture({ console: seed }) },
        ) as { entries: ConsoleEntry[] };
        expect(out.entries).toHaveLength(1);
        expect(out.entries[0].args[0]).toBe('logout failed');
    });

    it('invalid regex falls back to substring', async () => {
        const out = await commandHandlers[COMMAND.CONSOLE_TAIL](
            { n: 10, filter: '[bad', match: 'regex' },
            { capture: makeCapture({ console: seed }) },
        ) as { entries: ConsoleEntry[] };
        // No entry literally contains "[bad" — fallback returns 0 matches.
        expect(out.entries).toHaveLength(0);
    });
});

describe('network.tail filtering', () => {
    const seed: NetworkEntry[] = [
        { ts: 1, id: 'r1', phase: 'req', method: 'GET', url: 'https://api.test/users' },
        { ts: 2, id: 'r1', phase: 'res', method: 'GET', url: 'https://api.test/users', status: 200 },
        { ts: 3, id: 'r2', phase: 'req', method: 'POST', url: 'https://api.test/logout' },
        { ts: 4, id: 'r2', phase: 'res', method: 'POST', url: 'https://api.test/logout', status: 401 },
        { ts: 5, id: 'r3', phase: 'req', method: 'GET', url: 'https://cdn.test/assets/app.js' },
    ];

    it('urlContains narrow', async () => {
        const out = await commandHandlers[COMMAND.NETWORK_TAIL](
            { n: 10, urlContains: 'logout' },
            { capture: makeCapture({ network: seed }) },
        ) as { entries: NetworkEntry[] };
        expect(out.entries.every((e) => e.url.includes('logout'))).toBe(true);
        expect(out.entries).toHaveLength(2);
    });

    it('method narrow (case-insensitive)', async () => {
        const out = await commandHandlers[COMMAND.NETWORK_TAIL](
            { n: 10, method: 'post' },
            { capture: makeCapture({ network: seed }) },
        ) as { entries: NetworkEntry[] };
        expect(out.entries.every((e) => e.method === 'POST')).toBe(true);
    });

    it('statusCode narrow (drops req entries without status)', async () => {
        const out = await commandHandlers[COMMAND.NETWORK_TAIL](
            { n: 10, statusCode: 401 },
            { capture: makeCapture({ network: seed }) },
        ) as { entries: NetworkEntry[] };
        expect(out.entries).toHaveLength(1);
        expect(out.entries[0].status).toBe(401);
    });

    it('filter combined with narrow', async () => {
        const out = await commandHandlers[COMMAND.NETWORK_TAIL](
            { n: 10, urlContains: 'api.test', filter: 'logout' },
            { capture: makeCapture({ network: seed }) },
        ) as { entries: NetworkEntry[] };
        expect(out.entries.every((e) => e.url.includes('logout'))).toBe(true);
    });
});

describe('ws.tail filtering', () => {
    const seed: WsEntry[] = [
        { ts: 1, id: 'w1', phase: 'open', url: 'wss://chat.test/' },
        { ts: 2, id: 'w1', phase: 'send', url: 'wss://chat.test/', payload: { type: 'ping' } },
        { ts: 3, id: 'w1', phase: 'recv', url: 'wss://chat.test/', payload: { type: 'kick', reason: 'duplicate-login' } },
        { ts: 4, id: 'w1', phase: 'close', url: 'wss://chat.test/', code: 4001, reason: 'duplicate-login' },
    ];

    it('phase narrow', async () => {
        const out = await commandHandlers[COMMAND.WS_TAIL](
            { n: 10, phase: 'recv' },
            { capture: makeCapture({ ws: seed }) },
        ) as { entries: WsEntry[] };
        expect(out.entries).toHaveLength(1);
        expect(out.entries[0].phase).toBe('recv');
    });

    it('filter against payload', async () => {
        const out = await commandHandlers[COMMAND.WS_TAIL](
            { n: 10, filter: 'kick' },
            { capture: makeCapture({ ws: seed }) },
        ) as { entries: WsEntry[] };
        expect(out.entries).toHaveLength(1);
        expect(out.entries[0].phase).toBe('recv');
    });

    it('filter against close reason', async () => {
        const out = await commandHandlers[COMMAND.WS_TAIL](
            { n: 10, filter: 'duplicate-login', phase: 'close' },
            { capture: makeCapture({ ws: seed }) },
        ) as { entries: WsEntry[] };
        expect(out.entries).toHaveLength(1);
        expect(out.entries[0].code).toBe(4001);
    });
});

describe('errors.tail filtering', () => {
    const seed: ErrorEntry[] = [
        { ts: 1, message: 'Cannot read property foo of undefined', stack: 'at A.run', source: 'a.js:1:1' },
        { ts: 2, message: 'NetworkError', stack: 'at fetchX', source: 'net.js:9:9' },
    ];

    it('filter by message substring', async () => {
        const out = await commandHandlers[COMMAND.ERRORS_TAIL](
            { n: 10, filter: 'network' },
            { capture: makeCapture({ errors: seed }) },
        ) as { entries: ErrorEntry[] };
        expect(out.entries).toHaveLength(1);
        expect(out.entries[0].message).toBe('NetworkError');
    });
});

/**
 * harness-fe#204 follow-up: SSE frames used to share the 200-slot network ring
 * (a chatty stream evicted every req/res entry and its own lifecycle frames),
 * filtering ran only over the newest `n` entries, and nothing reported that the
 * caller was looking at a window rather than the whole stream.
 */
describe('network.tail — SSE frames', () => {
    const reqres: NetworkEntry[] = [
        { ts: 1, id: 's1', phase: 'req', method: 'POST', url: 'https://api.test/chat' },
        { ts: 500, id: 's1', phase: 'res', method: 'POST', url: 'https://api.test/chat', status: 200 },
    ];
    // 300 token frames with a sparse lifecycle frame at the very start.
    const frames: NetworkEntry[] = [
        { ts: 2, id: 's1', phase: 'frame', method: 'POST', url: 'https://api.test/chat', sseEvent: 'sub_agent_start', sseData: '{}' },
        ...Array.from({ length: 300 }, (_, i): NetworkEntry => ({
            ts: 3 + i, id: 's1', phase: 'frame', method: 'POST', url: 'https://api.test/chat',
            sseEvent: 'message.upsert', sseData: `{"i":${i}}`,
        })),
        { ts: 400, id: 's1', phase: 'frame', method: 'POST', url: 'https://api.test/chat', sseEvent: 'sub_agent_end', sseData: '{}' },
    ];
    const capture = () => makeCapture({ network: reqres, networkFrames: frames });

    it('phase narrow returns only frames, honoring n', async () => {
        const out = await commandHandlers[COMMAND.NETWORK_TAIL](
            { n: 250, phase: 'frame' },
            { capture: capture() },
        ) as { entries: NetworkEntry[]; matched: number; truncated?: boolean };
        expect(out.entries).toHaveLength(250);
        expect(out.entries.every((e) => e.phase === 'frame')).toBe(true);
        expect(out.matched).toBe(302);
        expect(out.truncated).toBe(true);
    });

    it('a sparse lifecycle frame is findable no matter how deep it is buried', async () => {
        const out = await commandHandlers[COMMAND.NETWORK_TAIL](
            { n: 20, filter: 'sub_agent', phase: 'frame' },
            { capture: capture() },
        ) as { entries: NetworkEntry[]; matched: number; truncated?: boolean };
        expect(out.entries.map((e) => e.sseEvent)).toEqual(['sub_agent_start', 'sub_agent_end']);
        expect(out.matched).toBe(2);
        expect(out.truncated).toBeUndefined();
    });

    it('unfiltered tail merges frames and req/res chronologically', async () => {
        const out = await commandHandlers[COMMAND.NETWORK_TAIL](
            { n: 5 },
            { capture: capture() },
        ) as { entries: NetworkEntry[]; matched: number };
        expect(out.matched).toBe(304);
        expect(out.entries.at(-1)!.phase).toBe('res');
        expect(out.entries.map((e) => e.ts)).toEqual([...out.entries.map((e) => e.ts)].sort((a, b) => a - b));
    });

    it('req/res narrow never has to page past the frames', async () => {
        const out = await commandHandlers[COMMAND.NETWORK_TAIL](
            { n: 20, phase: 'res' },
            { capture: capture() },
        ) as { entries: NetworkEntry[] };
        expect(out.entries).toHaveLength(1);
        expect(out.entries[0].status).toBe(200);
    });

    it('reports the eviction window when the ring has dropped entries', async () => {
        const out = await commandHandlers[COMMAND.NETWORK_TAIL](
            { n: 5 },
            { capture: makeCapture({ network: reqres, dropped: 42 }) },
        ) as { dropped?: number; bufferCap?: number };
        expect(out.dropped).toBe(42);
        expect(out.bufferCap).toBeGreaterThan(0);
    });
});

describe('network.get — full stream for one request', () => {
    const frames: NetworkEntry[] = Array.from({ length: 50 }, (_, i): NetworkEntry => ({
        ts: 2 + i, id: 's1', phase: 'frame', method: 'POST', url: '/chat', sseEvent: 'tick', sseData: `${i}`,
    }));
    const network: NetworkEntry[] = [
        { ts: 1, id: 's1', phase: 'req', method: 'POST', url: '/chat' },
        { ts: 99, id: 'other', phase: 'req', method: 'GET', url: '/ping' },
    ];

    it('returns req + every retained frame for the id', async () => {
        const out = await commandHandlers[COMMAND.NETWORK_GET](
            { reqId: 's1' },
            { capture: makeCapture({ network, networkFrames: frames }) },
        ) as { entries: NetworkEntry[]; found: boolean; total: number };
        expect(out.found).toBe(true);
        expect(out.total).toBe(51);
        expect(out.entries.filter((e) => e.phase === 'frame')).toHaveLength(50);
    });

    it('maxFrames keeps the newest frames and flags truncation', async () => {
        const out = await commandHandlers[COMMAND.NETWORK_GET](
            { reqId: 's1', maxFrames: 10 },
            { capture: makeCapture({ network, networkFrames: frames }) },
        ) as { entries: NetworkEntry[]; total: number; truncated?: boolean };
        expect(out.total).toBe(51);
        expect(out.truncated).toBe(true);
        const kept = out.entries.filter((e) => e.phase === 'frame');
        expect(kept).toHaveLength(10);
        expect(kept.at(-1)!.sseData).toBe('49');
        // req entry survives the frame cap
        expect(out.entries.some((e) => e.phase === 'req')).toBe(true);
    });
});
