// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';

// rrweb mock exposing a takeFullSnapshot spy (mirrors recording.test.ts).
const { takeFullSnapshotSpy } = vi.hoisted(() => {
    const takeFullSnapshotSpy = vi.fn();
    return { takeFullSnapshotSpy };
});
vi.mock('rrweb', () => {
    const record = Object.assign(() => () => {}, { takeFullSnapshot: takeFullSnapshotSpy });
    return { record, EventType: { Custom: 5 } };
});
vi.mock('./commands.js', () => ({ commandHandlers: {}, dialogPresets: {} }));

import { RuntimeClient } from './client.js';

afterEach(() => {
    takeFullSnapshotSpy.mockClear();
});

describe('hello.ack FullSnapshot dedup (harness-fe#158)', () => {
    it('skips the redundant snapshot on the first ack, refreshes on reconnect acks', () => {
        const client = new RuntimeClient({ projectId: 'x', mcpUrl: 'ws://127.0.0.1:1/ws' });
        client.start(); // recorder.start() emits the start() baseline (not via takeFullSnapshot)

        const ack = { type: 'hello.ack', id: 'a' } as any;

        // First ack of the page-load: start() already produced a sticky baseline,
        // so no extra full-DOM serialization here.
        (client as any).onHelloAck(ack);
        expect(takeFullSnapshotSpy).not.toHaveBeenCalled();

        // Reconnect acks DO refresh the baseline.
        (client as any).onHelloAck(ack);
        expect(takeFullSnapshotSpy).toHaveBeenCalledTimes(1);
        (client as any).onHelloAck(ack);
        expect(takeFullSnapshotSpy).toHaveBeenCalledTimes(2);

        client.stop();
    });
});
