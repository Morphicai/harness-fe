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
    errors?: ErrorEntry[];
    ws?: WsEntry[];
}): CaptureStore {
    function ring<T>(items: T[]): { tail: (n: number) => T[] } {
        return { tail: (n) => items.slice(-n) };
    }
    return {
        console: ring(seed.console ?? []),
        network: ring(seed.network ?? []),
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
