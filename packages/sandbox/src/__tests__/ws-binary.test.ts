/**
 * Regression for #180 — the WS sandbox must NOT corrupt outgoing frames.
 *
 * `serializeFrame` turns binary payloads into a lossy marker string (e.g.
 * "[binary ArrayBuffer 3B]") for the timeline. The bug: that marker was being
 * sent on the wire instead of the original binary, which broke every binary
 * WebSocket protocol (Agora RTM, LiveKit, protobuf-over-ws, …). The wire data
 * must always be the original `data` unless an interceptor explicitly returns
 * a replacement string.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installSandbox } from '../index.js';
import { _resetForTesting } from '../chain.js';
import type { SandboxHandle } from '../types.js';

let handle: SandboxHandle | undefined;
let originalWs: typeof WebSocket;

class FakeWS extends EventTarget {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;
    url: string;
    readyState = FakeWS.OPEN;
    sent: unknown[] = [];
    constructor(url: string | URL, _protocols?: string | string[]) {
        super();
        this.url = typeof url === 'string' ? url : url.toString();
    }
    send(data: unknown): void { this.sent.push(data); }
    close(): void { this.readyState = FakeWS.CLOSED; }
}

beforeEach(() => {
    originalWs = window.WebSocket;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).WebSocket = FakeWS as unknown as typeof WebSocket;
});

afterEach(() => {
    handle?.dispose();
    handle = undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).WebSocket = originalWs;
    _resetForTesting();
});

describe('ws binary passthrough (#180)', () => {
    it('sends the original TypedArray untouched (no marker string on the wire)', () => {
        handle = installSandbox({});
        const ws = new window.WebSocket('wss://x/') as unknown as FakeWS;
        const frame = new Uint8Array([1, 2, 3]);
        (ws as unknown as WebSocket).send(frame);
        expect(ws.sent).toHaveLength(1);
        expect(ws.sent[0]).toBe(frame);               // same reference, not "[binary ...]"
        expect(typeof ws.sent[0]).not.toBe('string');
    });

    it('sends the original ArrayBuffer untouched', () => {
        handle = installSandbox({});
        const ws = new window.WebSocket('wss://x/') as unknown as FakeWS;
        const buf = new Uint8Array([4, 5, 6]).buffer;
        (ws as unknown as WebSocket).send(buf);
        expect(ws.sent[0]).toBe(buf);
    });

    it('passes string frames through verbatim', () => {
        handle = installSandbox({});
        const ws = new window.WebSocket('wss://x/') as unknown as FakeWS;
        (ws as unknown as WebSocket).send('{"a":1}');
        expect(ws.sent[0]).toBe('{"a":1}');
    });

    it('still lets an onSend hook override the wire payload with a string', () => {
        handle = installSandbox({ ws: { onSend: () => 'rewritten' } });
        const ws = new window.WebSocket('wss://x/') as unknown as FakeWS;
        (ws as unknown as WebSocket).send('orig');
        expect(ws.sent).toContain('rewritten');
    });

    it('does NOT let a binary frame be replaced by its own observation marker', () => {
        // No hook → rewritten stays false → original binary must go out.
        handle = installSandbox({});
        const ws = new window.WebSocket('wss://x/') as unknown as FakeWS;
        const frame = new Uint8Array([7, 8, 9]);
        (ws as unknown as WebSocket).send(frame);
        expect(ws.sent[0]).toBeInstanceOf(Uint8Array);
        expect(ws.sent[0]).toBe(frame);
    });
});
