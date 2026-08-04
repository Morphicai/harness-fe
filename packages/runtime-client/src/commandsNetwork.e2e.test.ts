// @vitest-environment happy-dom
/**
 * End-to-end tests for the runtime-side command handlers added by the new
 * tooling: `network.wait_for`, `network.wait_for_idle`, `network.get`, and
 * `ws.get`. These were previously untested at the handler level — the unit
 * test suite covered tail()-shaped commands but not the async ones.
 *
 * We exercise the handler directly with a real CaptureStore, pushing entries
 * on a real timer the same way the patched fetch / WebSocket would.
 */

import { describe, expect, it } from 'vitest';
import { COMMAND, type NetworkEntry, type WsEntry } from '@harness-fe/protocol';
import { commandHandlers } from './commands.js';
import { CaptureStore } from './capture.js';

function makeCapture(): CaptureStore {
    // We don't install patches — we drive the RingBuffer directly so the
    // tests don't fight happy-dom's fetch.
    return new CaptureStore();
}

describe('NETWORK_WAIT_FOR', () => {
    it('resolves when a matching request arrives after the call', async () => {
        const cap = makeCapture();
        const promise = commandHandlers[COMMAND.NETWORK_WAIT_FOR](
            { urlContains: '/logout', timeoutMs: 2000 },
            { capture: cap },
        );
        setTimeout(() => {
            cap.network.push({ ts: Date.now(), id: 'r1', phase: 'req', method: 'POST', url: 'https://api.test/logout' } satisfies NetworkEntry);
        }, 100);
        const result = (await promise) as { ok: boolean; entry: NetworkEntry };
        expect(result.ok).toBe(true);
        expect(result.entry.url).toContain('/logout');
    });

    it('rejects on timeout when no match arrives', async () => {
        const cap = makeCapture();
        const promise = commandHandlers[COMMAND.NETWORK_WAIT_FOR](
            { urlContains: '/never', timeoutMs: 200 },
            { capture: cap },
        );
        cap.network.push({ ts: Date.now(), id: 'x', phase: 'req', method: 'GET', url: 'https://api.test/users' });
        await expect(promise).rejects.toThrow(/no matching request/);
    });

    it('matches by method + statusCode and ignores pre-baseline matches', async () => {
        const cap = makeCapture();
        // Pre-existing entry — should NOT satisfy the wait (baseline anchored on call).
        cap.network.push({ ts: Date.now() - 1000, id: 'old', phase: 'res', method: 'POST', url: '/x', status: 401 });
        const promise = commandHandlers[COMMAND.NETWORK_WAIT_FOR](
            { method: 'POST', statusCode: 401, timeoutMs: 2000 },
            { capture: cap },
        );
        setTimeout(() => {
            cap.network.push({ ts: Date.now(), id: 'new', phase: 'res', method: 'POST', url: '/y', status: 401 });
        }, 80);
        const out = (await promise) as { entry: NetworkEntry };
        expect(out.entry.id).toBe('new');
    });

    it('matches by urlRegex (case-insensitive)', async () => {
        const cap = makeCapture();
        const promise = commandHandlers[COMMAND.NETWORK_WAIT_FOR](
            { urlRegex: 'api\\.test/(login|logout)', timeoutMs: 2000 },
            { capture: cap },
        );
        setTimeout(() => {
            cap.network.push({ ts: Date.now(), id: 'x', phase: 'req', method: 'POST', url: 'https://API.test/logout' });
        }, 60);
        const out = (await promise) as { entry: NetworkEntry };
        expect(out.entry.url).toContain('logout');
    });
});

describe('NETWORK_WAIT_FOR_IDLE', () => {
    it('resolves once in-flight requests complete and stay idle for idleMs', async () => {
        const cap = makeCapture();
        cap.network.push({ ts: Date.now(), id: 'a', phase: 'req', method: 'GET', url: '/a' });
        const promise = commandHandlers[COMMAND.NETWORK_WAIT_FOR_IDLE](
            { idleMs: 150, timeoutMs: 2000 },
            { capture: cap },
        );
        setTimeout(() => cap.network.push({ ts: Date.now(), id: 'a', phase: 'res', method: 'GET', url: '/a', status: 200 }), 30);
        setTimeout(() => cap.network.push({ ts: Date.now(), id: 'b', phase: 'req', method: 'GET', url: '/b' }), 50);
        setTimeout(() => cap.network.push({ ts: Date.now(), id: 'b', phase: 'res', method: 'GET', url: '/b', status: 200 }), 70);
        const out = (await promise) as { ok: boolean; idleFor: number };
        expect(out.ok).toBe(true);
        expect(out.idleFor).toBeGreaterThanOrEqual(150);
    });

    it('rejects when the network never quiets within timeoutMs', async () => {
        const cap = makeCapture();
        const promise = commandHandlers[COMMAND.NETWORK_WAIT_FOR_IDLE](
            { idleMs: 200, timeoutMs: 300 },
            { capture: cap },
        );
        const handle = setInterval(() => {
            cap.network.push({ ts: Date.now(), id: `n-${Math.random()}`, phase: 'req', method: 'GET', url: '/spam' });
        }, 50);
        await expect(promise).rejects.toThrow(/never quiet/);
        clearInterval(handle);
    });

    // Regression for harness-fe#206: the old heuristic ("no new entries pushed
    // for idleMs") falsely reported idle the moment a request's 'req' entry
    // stopped triggering new pushes — even though its 'res' never arrived,
    // i.e. the request was still genuinely in flight.
    it('does NOT report idle while a request has started but never completed', async () => {
        const cap = makeCapture();
        cap.network.push({ ts: Date.now(), id: 'stuck', phase: 'req', method: 'GET', url: '/never-resolves' });
        const promise = commandHandlers[COMMAND.NETWORK_WAIT_FOR_IDLE](
            { idleMs: 100, timeoutMs: 300 },
            { capture: cap },
        );
        await expect(promise).rejects.toThrow(/never quiet/);
    });
});

describe('PAGE_WAIT_FOR — predicate: "network.idle"', () => {
    it('resolves once in-flight requests complete and stay idle for idleMs', async () => {
        const cap = makeCapture();
        cap.network.push({ ts: Date.now(), id: 'a', phase: 'req', method: 'GET', url: '/a' });
        const promise = commandHandlers[COMMAND.PAGE_WAIT_FOR](
            { predicate: 'network.idle', idleMs: 100, timeoutMs: 2000 },
            { capture: cap },
        );
        setTimeout(() => cap.network.push({ ts: Date.now(), id: 'a', phase: 'res', method: 'GET', url: '/a', status: 200 }), 30);
        const out = (await promise) as { ok: boolean; idleFor: number };
        expect(out.ok).toBe(true);
        expect(out.idleFor).toBeGreaterThanOrEqual(100);
    });

    // Regression for harness-fe#206: previously a fixed ~200ms sleep that
    // resolved unconditionally, regardless of whether requests were still in flight.
    it('does not resolve while a request has started but never completed', async () => {
        const cap = makeCapture();
        cap.network.push({ ts: Date.now(), id: 'stuck', phase: 'req', method: 'GET', url: '/never-resolves' });
        const promise = commandHandlers[COMMAND.PAGE_WAIT_FOR](
            { predicate: 'network.idle', idleMs: 100, timeoutMs: 300 },
            { capture: cap },
        );
        await expect(promise).rejects.toThrow(/network never went idle/);
    });
});

describe('NETWORK_GET', () => {
    it('returns req + res entries for the given reqId', async () => {
        const cap = makeCapture();
        cap.network.push({ ts: 1, id: 'r1', phase: 'req', method: 'GET', url: '/x', requestBody: { q: 1 } });
        cap.network.push({ ts: 2, id: 'r1', phase: 'res', method: 'GET', url: '/x', status: 200, responseBody: { ok: true } });
        cap.network.push({ ts: 3, id: 'r2', phase: 'req', method: 'GET', url: '/y' });

        const out = await commandHandlers[COMMAND.NETWORK_GET]({ reqId: 'r1' }, { capture: cap }) as { entries: NetworkEntry[]; found: boolean };
        expect(out.found).toBe(true);
        expect(out.entries).toHaveLength(2);
        expect(out.entries.map((e) => e.phase)).toEqual(['req', 'res']);
        // Bodies survive untouched.
        expect((out.entries[0] as NetworkEntry).requestBody).toEqual({ q: 1 });
        expect((out.entries[1] as NetworkEntry).responseBody).toEqual({ ok: true });
    });

    it('returns found=false when id is unknown', async () => {
        const cap = makeCapture();
        cap.network.push({ ts: 1, id: 'r1', phase: 'req', method: 'GET', url: '/x' });
        const out = await commandHandlers[COMMAND.NETWORK_GET]({ reqId: 'nope' }, { capture: cap }) as { entries: NetworkEntry[]; found: boolean };
        expect(out.found).toBe(false);
        expect(out.entries).toHaveLength(0);
    });
});

describe('WS_GET', () => {
    it('returns all phases (open/send/recv/close) for a single ws id', async () => {
        const cap = makeCapture();
        const id = 'w1';
        cap.ws.push({ ts: 1, id, phase: 'open', url: 'wss://x/' });
        cap.ws.push({ ts: 2, id, phase: 'send', url: 'wss://x/', payload: { ping: 1 } });
        cap.ws.push({ ts: 3, id, phase: 'recv', url: 'wss://x/', payload: { pong: 1 } });
        cap.ws.push({ ts: 4, id, phase: 'close', url: 'wss://x/', code: 1000, wasClean: true });
        cap.ws.push({ ts: 5, id: 'w-other', phase: 'open', url: 'wss://y/' });

        const out = await commandHandlers[COMMAND.WS_GET]({ wsId: id }, { capture: cap }) as { entries: WsEntry[]; found: boolean };
        expect(out.found).toBe(true);
        expect(out.entries).toHaveLength(4);
        expect(out.entries.map((e) => e.phase)).toEqual(['open', 'send', 'recv', 'close']);
        expect(out.entries.every((e) => e.id === id)).toBe(true);
    });
});
