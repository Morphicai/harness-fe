// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installWsPatch } from './wsPatch.js';
import type { WsEntry } from '@harness-fe/protocol';

let entries: WsEntry[];
let dispose: () => void;

/**
 * happy-dom's WebSocket attempts real network on construction. We replace it
 * with a controllable fake so the patch can be exercised in isolation.
 */
class FakeWebSocket extends EventTarget {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;
    readonly url: string;
    readonly protocols?: string | string[];
    readyState = FakeWebSocket.CONNECTING;
    sent: Array<unknown> = [];

    constructor(url: string | URL, protocols?: string | string[]) {
        super();
        this.url = typeof url === 'string' ? url : url.toString();
        this.protocols = protocols;
    }

    send(data: unknown): void {
        this.sent.push(data);
    }

    close(_code?: number, _reason?: string): void {
        this.readyState = FakeWebSocket.CLOSED;
    }

    // Test helpers — dispatch synthetic events.
    fireMessage(data: unknown): void {
        // happy-dom MessageEvent ctor accepts a `data` init.
        this.dispatchEvent(new MessageEvent('message', { data: data as string }));
    }

    fireClose(code = 1000, reason = '', wasClean = true): void {
        this.dispatchEvent(new CloseEvent('close', { code, reason, wasClean }));
    }
}

let originalWs: typeof WebSocket;

beforeEach(() => {
    entries = [];
    originalWs = window.WebSocket;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).WebSocket = FakeWebSocket as unknown as typeof WebSocket;
});

afterEach(() => {
    dispose?.();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).WebSocket = originalWs;
});

describe('installWsPatch', () => {
    it('emits open on construction with url + protocols', () => {
        dispose = installWsPatch({ onEntry: (e) => entries.push(e) });
        new window.WebSocket('wss://example.test/ws', ['v1', 'v2']);
        const open = entries.find((e) => e.phase === 'open')!;
        expect(open).toBeDefined();
        expect(open.url).toBe('wss://example.test/ws');
        expect(open.protocols).toEqual(['v1', 'v2']);
        expect(open.initiator).toBeDefined();
    });

    it('captures send with parsed JSON and initiator stack', () => {
        dispose = installWsPatch({ onEntry: (e) => entries.push(e) });
        const ws = new window.WebSocket('wss://x/');
        ws.send(JSON.stringify({ kind: 'ping', n: 1 }));
        const send = entries.find((e) => e.phase === 'send')!;
        expect(send).toBeDefined();
        expect(send.payload).toEqual({ kind: 'ping', n: 1 });
        expect(send.initiator).toBeDefined();
    });

    it('captures recv frames, parses JSON, keeps raw text otherwise', () => {
        dispose = installWsPatch({ onEntry: (e) => entries.push(e) });
        const ws = new window.WebSocket('wss://x/') as unknown as FakeWebSocket;
        ws.fireMessage(JSON.stringify({ notifyType: 'kick' }));
        ws.fireMessage('hello');
        const recvs = entries.filter((e) => e.phase === 'recv');
        expect(recvs).toHaveLength(2);
        expect(recvs[0].payload).toEqual({ notifyType: 'kick' });
        expect(recvs[1].payload).toBe('hello');
    });

    it('captures close with code + reason', () => {
        dispose = installWsPatch({ onEntry: (e) => entries.push(e) });
        const ws = new window.WebSocket('wss://x/') as unknown as FakeWebSocket;
        ws.fireClose(4001, 'kicked', false);
        const close = entries.find((e) => e.phase === 'close')!;
        expect(close.code).toBe(4001);
        expect(close.reason).toBe('kicked');
        expect(close.wasClean).toBe(false);
    });

    it('open / send / recv / close share the same id', () => {
        dispose = installWsPatch({ onEntry: (e) => entries.push(e) });
        const ws = new window.WebSocket('wss://x/') as unknown as FakeWebSocket;
        ws.send('hi');
        ws.fireMessage('there');
        ws.fireClose();
        const ids = new Set(entries.map((e) => e.id));
        expect(ids.size).toBe(1);
    });

    it('truncates text payload above bodyCap', () => {
        dispose = installWsPatch({ onEntry: (e) => entries.push(e), bodyCap: 10 });
        const ws = new window.WebSocket('wss://x/');
        ws.send('x'.repeat(50));
        const send = entries.find((e) => e.phase === 'send')!;
        expect(send.payloadTruncated).toBe(true);
        expect((send.payload as string).length).toBeLessThanOrEqual(10);
    });

    it('skips denylisted URLs (no entries emitted)', () => {
        dispose = installWsPatch({
            onEntry: (e) => entries.push(e),
            denylist: [/test\.skip/],
        });
        new window.WebSocket('ws://test.skip/x');
        expect(entries).toHaveLength(0);
    });

    it('records binary payloads as size markers', () => {
        dispose = installWsPatch({ onEntry: (e) => entries.push(e) });
        const ws = new window.WebSocket('wss://x/');
        ws.send(new Uint8Array(32));
        const send = entries.find((e) => e.phase === 'send')!;
        expect(typeof send.payload).toBe('string');
        expect(send.payload as string).toContain('[binary');
        expect(send.payload as string).toContain('32');
    });

    it('dispose restores window.WebSocket', () => {
        const before = window.WebSocket;
        dispose = installWsPatch({ onEntry: (e) => entries.push(e) });
        expect(window.WebSocket).not.toBe(before);
        dispose();
        expect(window.WebSocket).toBe(before);
    });
});
