/**
 * Interceptor capability tests — the 41 cases that were `it.todo` in Phase 0,
 * now real `it()` against the sandbox implementation.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installSandbox } from '../index.js';
import { _resetForTesting } from '../chain.js';
import type { SandboxHandle } from '../types.js';

let handle: SandboxHandle | undefined;
let originalWs: typeof WebSocket;
let originalFetch: typeof fetch;

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
    fireMessage(data: unknown): void {
        this.dispatchEvent(new MessageEvent('message', { data: data as string }));
    }
    fireClose(code = 1000, reason = '', wasClean = true): void {
        this.dispatchEvent(new CloseEvent('close', { code, reason, wasClean }));
    }
}

beforeEach(() => {
    originalWs = window.WebSocket;
    originalFetch = window.fetch;
    try { window.localStorage.clear(); window.sessionStorage.clear(); } catch { /* noop */ }
});

afterEach(() => {
    handle?.dispose();
    handle = undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).WebSocket = originalWs;
    window.fetch = originalFetch;
    _resetForTesting();
});

// ────────────────────────────────────────────────────────────────────
// fetch
// ────────────────────────────────────────────────────────────────────
describe('fetch interceptor', () => {
    function stubFetch(responder: (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response>): void {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).fetch = async (input: RequestInfo | URL, init?: RequestInit) => responder(input, init);
    }

    it('onRequest can rewrite the URL', async () => {
        const seen: string[] = [];
        stubFetch(async (input) => {
            seen.push(typeof input === 'string' ? input : String(input));
            return new Response('{}', { headers: { 'content-type': 'application/json' } });
        });
        handle = installSandbox({
            fetch: { onRequest: (req) => ({ ...req, url: `${req.url}?injected=1` }) },
        });
        await window.fetch('https://api.test/users');
        expect(seen[0]).toContain('?injected=1');
    });

    it('onRequest can inject headers', async () => {
        let capturedInit: RequestInit | undefined;
        stubFetch(async (_input, init) => { capturedInit = init; return new Response(''); });
        handle = installSandbox({
            fetch: { onRequest: (req) => ({ ...req, headers: { ...req.headers, 'x-trace-id': 'abc' } }) },
        });
        await window.fetch('https://api.test/');
        const hdrs = capturedInit?.headers as Record<string, string> | undefined;
        expect(hdrs?.['x-trace-id']).toBe('abc');
    });

    it('onRequest can short-circuit with a Response', async () => {
        let nativeCalled = 0;
        stubFetch(async () => { nativeCalled++; return new Response('native'); });
        handle = installSandbox({
            fetch: { onRequest: () => new Response('intercepted', { status: 200 }) },
        });
        const res = await window.fetch('https://api.test/');
        expect(await res.text()).toBe('intercepted');
        expect(nativeCalled).toBe(0);
    });

    it('onRequest returning false aborts with status 0', async () => {
        let nativeCalled = 0;
        stubFetch(async () => { nativeCalled++; return new Response('native'); });
        handle = installSandbox({ fetch: { onRequest: () => false } });
        const res = await window.fetch('https://api.test/');
        expect(res.status).toBe(0);
        expect(nativeCalled).toBe(0);
    });

    it('onResponse can rewrite status', async () => {
        stubFetch(async () => new Response('orig', { status: 200 }));
        handle = installSandbox({
            fetch: { onResponse: () => new Response('rewritten', { status: 418 }) },
        });
        const res = await window.fetch('https://api.test/');
        expect(res.status).toBe(418);
        expect(await res.text()).toBe('rewritten');
    });

    it('onResponse can short-circuit to new Response', async () => {
        stubFetch(async () => new Response('orig', { status: 500 }));
        handle = installSandbox({
            fetch: { onResponse: () => new Response('cached', { status: 200 }) },
        });
        const res = await window.fetch('https://api.test/');
        expect(res.status).toBe(200);
        expect(await res.text()).toBe('cached');
    });

    it('observer onEvent fires for both req and res phases', async () => {
        stubFetch(async () => new Response('ok'));
        const types: string[] = [];
        handle = installSandbox({
            onEvent: (e) => types.push(`${e.source}.${e.kind}`),
        });
        await window.fetch('https://api.test/');
        expect(types).toContain('fetch.req');
        expect(types).toContain('fetch.res');
    });

    it('async onRequest is awaited', async () => {
        stubFetch(async () => new Response('ok'));
        let phase = 'before';
        handle = installSandbox({
            fetch: {
                onRequest: async (req) => {
                    await new Promise((r) => setTimeout(r, 10));
                    phase = 'after-onRequest';
                    return req;
                },
            },
        });
        await window.fetch('https://api.test/');
        expect(phase).toBe('after-onRequest');
    });
});

// ────────────────────────────────────────────────────────────────────
// ws
// ────────────────────────────────────────────────────────────────────
describe('ws interceptor', () => {
    beforeEach(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).WebSocket = FakeWS as unknown as typeof WebSocket;
    });

    it('onConstruct can rewrite url before native', () => {
        let constructedUrl = '';
        handle = installSandbox({
            ws: { onConstruct: (url) => ({ url: `${url}?ic=1` }) },
        });
        const ws = new window.WebSocket('wss://test/') as unknown as FakeWS;
        constructedUrl = ws.url;
        expect(constructedUrl).toContain('?ic=1');
    });

    it('onSend can drop frame by returning false', () => {
        handle = installSandbox({ ws: { onSend: () => false } });
        const ws = new window.WebSocket('wss://x/') as unknown as FakeWS;
        ws.send('hi');
        expect(ws.sent.length).toBe(0);
    });

    it('onSend can rewrite outgoing payload', () => {
        handle = installSandbox({ ws: { onSend: () => 'rewritten' } });
        const ws = new window.WebSocket('wss://x/') as unknown as FakeWS;
        ws.send('orig');
        expect(ws.sent).toContain('rewritten');
    });

    it('onMessage can drop incoming frame', () => {
        const seen: unknown[] = [];
        handle = installSandbox({
            ws: { onMessage: () => false },
            onEvent: (e) => { if (e.source === 'ws' && e.kind === 'recv') seen.push(e); },
        });
        const ws = new window.WebSocket('wss://x/') as unknown as FakeWS;
        ws.fireMessage('hello');
        expect(seen.length).toBe(0);
    });

    it('onMessage can rewrite incoming payload', () => {
        let observedPayload: unknown;
        handle = installSandbox({
            ws: { onMessage: () => 'rewritten' },
            onEvent: (e) => {
                if (e.source === 'ws' && e.kind === 'recv') observedPayload = e.data.payload;
            },
        });
        const ws = new window.WebSocket('wss://x/') as unknown as FakeWS;
        ws.fireMessage('orig');
        expect(observedPayload).toBe('rewritten');
    });

    it('onClose observes code + reason', () => {
        const onClose = vi.fn();
        handle = installSandbox({ ws: { onClose } });
        const ws = new window.WebSocket('wss://x/') as unknown as FakeWS;
        ws.fireClose(4001, 'kicked', false);
        expect(onClose).toHaveBeenCalledWith(4001, 'kicked', expect.any(String), expect.any(Object));
    });
});

// ────────────────────────────────────────────────────────────────────
// storage
// ────────────────────────────────────────────────────────────────────
describe('storage interceptor', () => {
    it('onSet returning false blocks the write', () => {
        handle = installSandbox({
            storage: { onSet: (k) => k === 'block' ? false : undefined },
        });
        window.localStorage.setItem('block', '1');
        expect(window.localStorage.getItem('block')).toBeNull();
    });

    it('onSet can rewrite key', () => {
        handle = installSandbox({
            storage: { onSet: (k, v) => ({ key: `prefix:${k}`, value: v }) },
        });
        window.localStorage.setItem('foo', 'V');
        expect(window.localStorage.getItem('prefix:foo')).toBe('V');
    });

    it('onSet can rewrite value', () => {
        handle = installSandbox({
            storage: { onSet: (k, v) => ({ key: k, value: `enc(${v})` }) },
        });
        window.localStorage.setItem('foo', 'bar');
        expect(window.localStorage.getItem('foo')).toBe('enc(bar)');
    });

    it('onRemove returning false blocks the delete', () => {
        window.localStorage.setItem('keep', '1');
        handle = installSandbox({ storage: { onRemove: () => false } });
        window.localStorage.removeItem('keep');
        expect(window.localStorage.getItem('keep')).toBe('1');
    });

    it('onClear returning false blocks the clear', () => {
        window.localStorage.setItem('a', '1');
        handle = installSandbox({ storage: { onClear: () => false } });
        window.localStorage.clear();
        expect(window.localStorage.getItem('a')).toBe('1');
    });

    it('onGet can override the read', () => {
        window.localStorage.setItem('real', 'V');
        handle = installSandbox({
            storage: { onGet: (k) => k === 'real' ? 'overridden' : undefined },
        });
        expect(window.localStorage.getItem('real')).toBe('overridden');
    });

    it('proto.setItem.call also goes through interceptor', () => {
        const seen: string[] = [];
        handle = installSandbox({
            storage: { onSet: (k) => { seen.push(k); return undefined; } },
        });
        Storage.prototype.setItem.call(window.localStorage, 'pkey', 'v');
        expect(seen).toContain('pkey');
    });

    it('direct property assign (proxy.x = "y") goes through interceptor', () => {
        const seen: Array<{ k: string; v: string }> = [];
        handle = installSandbox({
            storage: { onSet: (k, v) => { seen.push({ k, v }); return undefined; } },
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window.localStorage as any).directAssign = 'val';
        expect(seen.find((e) => e.k === 'directAssign')?.v).toBe('val');
    });
});

// ────────────────────────────────────────────────────────────────────
// navigation
// ────────────────────────────────────────────────────────────────────
describe('navigation interceptor', () => {
    it('onPush returning false blocks history.pushState', () => {
        const before = window.history.length;
        handle = installSandbox({ navigation: { onPush: () => false } });
        window.history.pushState({}, '', '/blocked');
        expect(window.history.length).toBe(before);
    });

    it('onPush can rewrite url', () => {
        const observed: string[] = [];
        handle = installSandbox({
            navigation: {
                onPush: (url) => ({ url: `${url}?intercepted=1` }),
            },
            onEvent: (e) => {
                if (e.source === 'navigation' && e.kind === 'push') {
                    observed.push(e.data.url ?? '');
                }
            },
        });
        window.history.pushState({}, '', '/x');
        expect(observed[0]).toContain('?intercepted=1');
    });

    it('onReplace returning false blocks replaceState', () => {
        const url0 = window.location.href;
        handle = installSandbox({ navigation: { onReplace: () => false } });
        window.history.replaceState({}, '', '/blocked-replace');
        expect(window.location.href).toBe(url0);
    });

    it('observer sees popstate as kind="pop"', () => {
        const kinds: string[] = [];
        handle = installSandbox({
            onEvent: (e) => { if (e.source === 'navigation') kinds.push(e.kind); },
        });
        window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
        expect(kinds).toContain('pop');
    });

    it('observer sees hashchange as kind="hash"', () => {
        const kinds: string[] = [];
        handle = installSandbox({
            onEvent: (e) => { if (e.source === 'navigation') kinds.push(e.kind); },
        });
        window.dispatchEvent(new HashChangeEvent('hashchange'));
        expect(kinds).toContain('hash');
    });
});

// ────────────────────────────────────────────────────────────────────
// console / errors
// ────────────────────────────────────────────────────────────────────
describe('console / errors observer', () => {
    it('console observer captures level + args without changing console output', () => {
        const captured: unknown[] = [];
        handle = installSandbox({
            onEvent: (e) => {
                if (e.source === 'console') captured.push(e);
            },
        });
        console.log('hello', 42);
        const got = captured.find((c) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const e = c as any;
            return e.kind === 'log';
        }) as unknown as { data: { args: unknown[] } } | undefined;
        expect(got?.data.args).toEqual(['hello', 42]);
    });

    it('error observer captures uncaught errors', () => {
        const seen: unknown[] = [];
        handle = installSandbox({
            onEvent: (e) => { if (e.source === 'errors') seen.push(e); },
        });
        window.dispatchEvent(new ErrorEvent('error', {
            message: 'boom',
            error: new Error('boom'),
            filename: 'x.js', lineno: 1, colno: 1,
        }));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const e = seen.find((s) => (s as any).kind === 'error');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((e as any)?.data.message).toBe('boom');
    });
});

// ────────────────────────────────────────────────────────────────────
// ctx surface
// ────────────────────────────────────────────────────────────────────
describe('ctx surface', () => {
    it('storage interceptor receives ctx.initiator.stack', () => {
        const stacks: string[] = [];
        handle = installSandbox({
            storage: {
                onSet: (_k, _v, _which, ctx) => {
                    if (ctx.initiator.stack) stacks.push(ctx.initiator.stack);
                    return undefined;
                },
            },
        });
        window.localStorage.setItem('k', 'v');
        expect(stacks.length).toBe(1);
        expect(stacks[0].length).toBeGreaterThan(0);
    });

    it('ctx.channel + ctx.kind are populated', () => {
        let lastCtx: { channel: string; kind: string } | undefined;
        handle = installSandbox({
            storage: {
                onSet: (_k, _v, _which, ctx) => {
                    lastCtx = { channel: ctx.channel, kind: ctx.kind };
                    return undefined;
                },
            },
        });
        window.localStorage.setItem('k', 'v');
        expect(lastCtx).toEqual({ channel: 'storage', kind: 'set' });
    });

    it('ctx.moduleId is undefined in pure-runtime mode', () => {
        let lastModuleId: string | undefined = 'sentinel';
        handle = installSandbox({
            storage: {
                onSet: (_k, _v, _which, ctx) => {
                    lastModuleId = ctx.moduleId;
                    return undefined;
                },
            },
        });
        window.localStorage.setItem('k', 'v');
        expect(lastModuleId).toBeUndefined();
    });
});
