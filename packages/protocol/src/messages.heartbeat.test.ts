import { describe, expect, it } from 'vitest';
import { frameSchema, helloAckFrameSchema } from './messages.js';

describe('heartbeat frames', () => {
    it('frameSchema accepts ping and pong frames', () => {
        expect(frameSchema.safeParse({ type: 'ping', id: 'p1' }).success).toBe(true);
        expect(frameSchema.safeParse({ type: 'ping', id: 'p1', ts: 123 }).success).toBe(true);
        expect(frameSchema.safeParse({ type: 'pong', id: 'p1' }).success).toBe(true);
    });

    it('frameSchema rejects unknown types (old clients drop ping/pong gracefully)', () => {
        expect(frameSchema.safeParse({ type: 'heartbeat', id: 'p1' }).success).toBe(false);
    });

    it('hello.ack carries optional heartbeatMs', () => {
        expect(
            helloAckFrameSchema.safeParse({
                type: 'hello.ack',
                id: 'a',
                serverVersion: '0.0.1',
                heartbeatMs: 25_000,
            }).success,
        ).toBe(true);
        expect(
            helloAckFrameSchema.safeParse({ type: 'hello.ack', id: 'a', serverVersion: '0.0.1' }).success,
        ).toBe(true);
    });
});
