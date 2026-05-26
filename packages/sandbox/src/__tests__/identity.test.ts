/**
 * Identity tests — the 22 cases from Phase 0, now running against the
 * @harness-fe/sandbox implementation. Every previously-red case must turn green.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installSandbox } from '../index.js';
import { _resetForTesting } from '../chain.js';
import type { SandboxEvent, SandboxHandle } from '../types.js';

let handle: SandboxHandle | undefined;
let originalWs: typeof WebSocket;
let events: SandboxEvent[];

// A controllable fake WebSocket for tests that touch instance behavior.
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
    events = [];
    originalWs = window.WebSocket;
    try { window.localStorage.clear(); } catch { /* noop */ }
    try { window.sessionStorage.clear(); } catch { /* noop */ }
});

afterEach(() => {
    handle?.dispose();
    handle = undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).WebSocket = originalWs;
    _resetForTesting();
});

function install(): void {
    handle = installSandbox({ onEvent: (e) => events.push(e) });
}

describe('Identity — sandbox refactor target', () => {
    // ────────────── typeof ──────────────
    it('#1 typeof window.fetch === "function"', () => {
        install();
        expect(typeof window.fetch).toBe('function');
    });

    it('#2 typeof window.WebSocket === "function"', () => {
        install();
        expect(typeof window.WebSocket).toBe('function');
    });

    it('#3 typeof localStorage === "object"', () => {
        install();
        expect(typeof window.localStorage).toBe('object');
    });

    it('#4 typeof localStorage.setItem === "function"', () => {
        install();
        expect(typeof window.localStorage.setItem).toBe('function');
    });

    // ────────────── instanceof ──────────────
    it('#5 new WebSocket(...) instanceof WebSocket', () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).WebSocket = FakeWS as unknown as typeof WebSocket;
        install();
        const ws = new window.WebSocket('wss://test.example/');
        expect(ws instanceof window.WebSocket).toBe(true);
    });

    it('#6 localStorage instanceof Storage', () => {
        install();
        expect(window.localStorage instanceof Storage).toBe(true);
    });

    it('#7 localStorage identity memoized', () => {
        install();
        const a = window.localStorage;
        const b = window.localStorage;
        expect(a).toBe(b);
    });

    it.skip('#8 toString.call(localStorage) === "[object Storage]" — happy-dom env diff', () => {
        // happy-dom returns "[object Object]" — real browsers return "[object Storage]".
        // Skip in CI but verify in real-browser smoke.
        install();
        expect(Object.prototype.toString.call(window.localStorage)).toBe('[object Storage]');
    });

    it('#9 localStorage.constructor === Storage', () => {
        install();
        expect(window.localStorage.constructor).toBe(Storage);
    });

    it('#10 Object.getPrototypeOf(localStorage) === Storage.prototype', () => {
        install();
        expect(Object.getPrototypeOf(window.localStorage)).toBe(Storage.prototype);
    });

    // ────────────── The .call() bypass (red list) — must now turn GREEN ──────────────
    it('#11 Storage.prototype.setItem.call(localStorage, k, v) triggers interceptor', () => {
        const seen: string[] = [];
        handle = installSandbox({
            storage: { onSet: (k, v) => { seen.push(`${k}=${v}`); return undefined; } },
        });
        Storage.prototype.setItem.call(window.localStorage, 'proto-call-key', 'V');
        expect(seen).toContain('proto-call-key=V');
        // Underlying storage actually updated.
        expect(window.localStorage.getItem('proto-call-key')).toBe('V');
    });

    it('#12 WebSocket.prototype.send.call(ws, data) triggers interceptor', () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).WebSocket = FakeWS as unknown as typeof WebSocket;
        const seen: unknown[] = [];
        handle = installSandbox({
            ws: { onSend: (payload) => { seen.push(payload); return undefined; } },
        });
        const ws = new window.WebSocket('wss://x/');
        WebSocket.prototype.send.call(ws, 'proto-send');
        expect(seen).toContain('proto-send');
    });

    it('#13 WebSocket("wss://x") without new throws TypeError', () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).WebSocket = FakeWS as unknown as typeof WebSocket;
        install();
        expect(() => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (window.WebSocket as any)('wss://test.example/');
        }).toThrow(TypeError);
    });

    // ────────────── Enumeration / serialization preserved ──────────────
    it('#14 for...in localStorage yields only stored keys', () => {
        install();
        window.localStorage.setItem('a', '1');
        window.localStorage.setItem('b', '2');
        const keys: string[] = [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const k in window.localStorage as any) keys.push(k);
        expect(keys.sort()).toEqual(['a', 'b']);
    });

    it('#15 Reflect.ownKeys(localStorage) excludes patched methods', () => {
        install();
        window.localStorage.setItem('x', '1');
        const ownKeys = Reflect.ownKeys(window.localStorage);
        expect(ownKeys.includes('setItem')).toBe(false);
        expect(ownKeys.includes('removeItem')).toBe(false);
        expect(ownKeys.includes('clear')).toBe(false);
    });

    it('#16 JSON.stringify(localStorage) === "{}" when empty', () => {
        install();
        expect(JSON.stringify(window.localStorage)).toBe('{}');
    });

    it.skip('#17 destructured setItem with detached this throws — happy-dom env diff', () => {
        // happy-dom doesn't enforce `this` checks on Storage methods. Real browsers do.
        install();
        const { setItem } = window.localStorage;
        expect(() => (setItem as (k: string, v: string) => void)('k', 'v')).toThrow();
    });

    it('#18 localStorage.setItem.bind(localStorage)(k, v) triggers interceptor', () => {
        const seen: string[] = [];
        handle = installSandbox({
            storage: { onSet: (k) => { seen.push(k); return undefined; } },
        });
        const bound = window.localStorage.setItem.bind(window.localStorage);
        bound('bound-key', 'v');
        expect(seen).toContain('bound-key');
    });

    // ────────────── Navigation (red list) — must now turn GREEN ──────────────
    it('#19 location.href setter triggers navigation observer (or interceptor)', () => {
        const navObserver = vi.fn();
        handle = installSandbox({
            navigation: {
                onAssign: (url) => {
                    navObserver(url);
                    return false; // block to avoid actual navigation in happy-dom
                },
            },
        });
        try { window.location.href = '/foo'; } catch { /* env may throw */ }
        expect(navObserver).toHaveBeenCalled();
    });

    it('#20 history.pushState triggers navigation observer', () => {
        const navObserver = vi.fn();
        handle = installSandbox({
            navigation: { onPush: (url) => { navObserver(url); return undefined; } },
        });
        window.history.pushState({}, '', '/x');
        expect(navObserver).toHaveBeenCalled();
    });

    // ────────────── Subclassing ──────────────
    it('#21 class X extends WebSocket works', () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).WebSocket = FakeWS as unknown as typeof WebSocket;
        install();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const dynExtend = new Function('WS', `
            class X extends WS {}
            return X;
        `);
        const X = dynExtend(window.WebSocket);
        expect(typeof X).toBe('function');
        expect(X.prototype).toBeDefined();
        expect(Object.getPrototypeOf(X.prototype)).toBe(window.WebSocket.prototype);
    });

    // ────────────── Dispose restoration ──────────────
    it('#22 dispose restores globals', () => {
        const beforeFetch = window.fetch;
        handle = installSandbox({ onEvent: (e) => events.push(e) });
        expect(window.fetch).not.toBe(beforeFetch);
        handle.dispose();
        handle = undefined;
        expect(window.fetch).toBe(beforeFetch);
        // After dispose, no new events.
        const before = events.length;
        try { console.log('post-dispose'); } catch { /* skip */ }
        expect(events.length).toBe(before);
    });
});
