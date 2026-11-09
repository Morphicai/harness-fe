// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('rrweb', () => ({ record: () => () => {}, EventType: { Custom: 5 } }));
vi.mock('./commands.js', () => ({ commandHandlers: {}, dialogPresets: {} }));

import { RuntimeClient } from './client.js';

/**
 * Heartbeat (ping/pong) death-detection:
 *  - hello.ack with heartbeatMs arms the ping cadence
 *  - hello.ack without heartbeatMs (older daemon) leaves it unarmed —
 *    missing pongs must never kill the connection there
 *  - two consecutive unanswered pings force-close the socket so the regular
 *    reconnect path takes over (half-open recovery)
 *  - a pong resets the miss counter
 */

function fakeWs() {
    return {
        readyState: 1, // WebSocket.OPEN
        send: vi.fn(),
        close: vi.fn(),
    };
}

let client: RuntimeClient;

beforeEach(() => {
    vi.useFakeTimers();
    client = new RuntimeClient({ projectId: 'x', mcpUrl: 'ws://127.0.0.1:1/ws' });
    client.start();
});

afterEach(() => {
    client.stop();
    vi.useRealTimers();
});

const INTERVAL = 25_000;

/** Arm the client's heartbeat against a fake socket; drops any buffered
 * startup traffic (page.load etc.) so assertions only see heartbeat frames. */
function arm(heartbeatMs?: number) {
    const ws = fakeWs();
    (client as any).ws = ws;
    (client as any).onHelloAck({ type: 'hello.ack', id: 'a', ...(heartbeatMs ? { heartbeatMs } : {}) });
    ws.send.mockClear();
    return ws;
}

describe('runtime-client — heartbeat', () => {
    it('pings at the advertised cadence and survives with pongs', () => {
        const ws = arm(INTERVAL);

        vi.advanceTimersByTime(INTERVAL);
        expect(ws.send).toHaveBeenCalledTimes(1);
        expect(ws.send.mock.calls[0][0]).toContain('"ping"');

        // pong arrives → next ping goes out too, no close
        (client as any).onMessage({ data: JSON.stringify({ type: 'pong', id: 'x' }) });
        vi.advanceTimersByTime(INTERVAL);
        expect(ws.send).toHaveBeenCalledTimes(2);
        expect(ws.close).not.toHaveBeenCalled();
    });

    it('force-closes after two consecutive unanswered pings', () => {
        const ws = arm(INTERVAL);

        vi.advanceTimersByTime(INTERVAL); // ping #1 sent, awaiting
        vi.advanceTimersByTime(INTERVAL); // miss #1 (no pong for #1)
        expect(ws.close).not.toHaveBeenCalled();
        vi.advanceTimersByTime(INTERVAL); // miss #2 → close
        expect(ws.close).toHaveBeenCalledTimes(1);
    });

    it('stays unarmed without heartbeatMs (older daemon never pongs)', () => {
        const ws = arm(undefined);

        vi.advanceTimersByTime(10 * INTERVAL);
        expect(ws.send).not.toHaveBeenCalled();
        expect(ws.close).not.toHaveBeenCalled();
    });

    it('stops pinging after stop()', () => {
        const ws = arm(INTERVAL);
        client.stop();
        vi.advanceTimersByTime(5 * INTERVAL);
        expect(ws.send).not.toHaveBeenCalled();
    });
});
