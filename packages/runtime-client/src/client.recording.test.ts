// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';

// rrweb mock exposing a record() spy (mirrors client.ackSnapshot.test.ts).
const { recordSpy } = vi.hoisted(() => {
    const recordSpy = vi.fn(() => () => {});
    return { recordSpy };
});
vi.mock('rrweb', () => {
    const record = Object.assign(recordSpy, { takeFullSnapshot: vi.fn() });
    return { record, EventType: { Custom: 5 } };
});
vi.mock('./commands.js', () => ({ commandHandlers: {}, dialogPresets: {} }));

import { RuntimeClient } from './client.js';

afterEach(() => {
    recordSpy.mockClear();
});

describe('recording option', () => {
    it('starts the rrweb recorder by default', () => {
        const client = new RuntimeClient({ projectId: 'x', mcpUrl: 'ws://127.0.0.1:1/ws' });
        client.start();
        expect(recordSpy).toHaveBeenCalledTimes(1);
        client.stop();
    });

    it('does not start the rrweb recorder when recording:false', () => {
        const client = new RuntimeClient({ projectId: 'x', mcpUrl: 'ws://127.0.0.1:1/ws', recording: false });
        client.start();
        expect(recordSpy).not.toHaveBeenCalled();
        client.stop();
    });
});
