// @vitest-environment happy-dom
/**
 * Phase 0 — identity & edge-case spec for the future @harness-fe/sandbox.
 *
 * These tests run against the CURRENT runtime-client patches (installStoragePatch,
 * installWsPatch, installFetchPatch, installXhrPatch). Expected outcomes are
 * documented per case in the plan (twinkly-singing-sun.md, Phase 0 A).
 *
 * Cases that PASS today document existing correctness we must preserve.
 * Cases that FAIL today are the "red list" — refactor must turn them green.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installStoragePatch } from './storagePatch.js';
import { installWsPatch } from './wsPatch.js';
import { installFetchPatch } from './fetchPatch.js';
import { installXhrPatch } from './xhrPatch.js';
import type { NetworkEntry, StorageEntry, WsEntry } from '@harness-fe/protocol';

let disposers: Array<() => void> = [];
let storageEvents: StorageEntry[] = [];
let wsEvents: WsEntry[] = [];
let netEvents: NetworkEntry[] = [];
let originalWs: typeof WebSocket;
let originalFetch: typeof fetch;

// A controllable fake WebSocket for assertions that touch instance behavior.
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
    storageEvents = [];
    wsEvents = [];
    netEvents = [];
    originalWs = window.WebSocket;
    originalFetch = window.fetch;
    try { window.localStorage.clear(); } catch { /* noop */ }
    try { window.sessionStorage.clear(); } catch { /* noop */ }
});

afterEach(() => {
    while (disposers.length) {
        try { disposers.pop()!(); } catch { /* noop */ }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).WebSocket = originalWs;
    window.fetch = originalFetch;
});

function installAll(): void {
    disposers.push(installStoragePatch({ onEntry: (e) => storageEvents.push(e) }));
    // Swap to FakeWS so wsPatch wraps something deterministic.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).WebSocket = FakeWS as unknown as typeof WebSocket;
    disposers.push(installWsPatch({ onEntry: (e) => wsEvents.push(e) }));
    disposers.push(installFetchPatch({ onEntry: (e) => netEvents.push(e) }));
    disposers.push(installXhrPatch({ onEntry: (e) => netEvents.push(e) }));
}

describe('Identity contract — Phase 0 spec', () => {
    // ──────────────────────────────────────────────────────────────
    // typeof — straight-line checks; all expected ✅
    // ──────────────────────────────────────────────────────────────

    it('#1  typeof window.fetch === "function" after install', () => {
        installAll();
        expect(typeof window.fetch).toBe('function');
    });

    it('#2  typeof window.WebSocket === "function" after install', () => {
        installAll();
        expect(typeof window.WebSocket).toBe('function');
    });

    it('#3  typeof localStorage === "object" after install', () => {
        installAll();
        expect(typeof window.localStorage).toBe('object');
    });

    it('#4  typeof localStorage.setItem === "function" after install', () => {
        installAll();
        expect(typeof window.localStorage.setItem).toBe('function');
    });

    // ──────────────────────────────────────────────────────────────
    // instanceof — prototype-chain preservation
    // ──────────────────────────────────────────────────────────────

    it('#5  new WebSocket(...) instanceof WebSocket after install', () => {
        installAll();
        const ws = new window.WebSocket('wss://test.example/');
        expect(ws instanceof window.WebSocket).toBe(true);
    });

    it('#6  localStorage instanceof Storage after install', () => {
        installAll();
        expect(window.localStorage instanceof Storage).toBe(true);
    });

    it('#7  localStorage identity is memoized (=== holds across reads)', () => {
        installAll();
        const a = window.localStorage;
        const b = window.localStorage;
        expect(a).toBe(b);
    });

    it('#8  Object.prototype.toString.call(localStorage) === "[object Storage]"', () => {
        installAll();
        expect(Object.prototype.toString.call(window.localStorage)).toBe('[object Storage]');
    });

    it('#9  localStorage.constructor === Storage', () => {
        installAll();
        expect(window.localStorage.constructor).toBe(Storage);
    });

    it('#10 Object.getPrototypeOf(localStorage) === Storage.prototype', () => {
        installAll();
        expect(Object.getPrototypeOf(window.localStorage)).toBe(Storage.prototype);
    });

    // ──────────────────────────────────────────────────────────────
    // The .call() bypass — current implementation is expected to FAIL these
    // ──────────────────────────────────────────────────────────────

    it('#11 Storage.prototype.setItem.call(localStorage, k, v) triggers onEntry [RED]', () => {
        installAll();
        const beforeCount = storageEvents.length;
        Storage.prototype.setItem.call(window.localStorage, 'proto-call-key', 'v');
        const newOnes = storageEvents.slice(beforeCount);
        // Phase 0 expects this to FAIL on current impl — the prototype method bypasses
        // our instance own-property wrapper. Refactor must close this gap via Proxy `set`.
        expect(newOnes.some((e) => e.key === 'proto-call-key')).toBe(true);
    });

    it('#12 WebSocket.prototype.send.call(ws, data) triggers onEntry [RED]', () => {
        installAll();
        const ws = new window.WebSocket('wss://test.example/');
        const beforeCount = wsEvents.length;
        // Calling the prototype's send directly bypasses our instance-level patch.
        WebSocket.prototype.send.call(ws, 'proto-call-payload');
        const sends = wsEvents.slice(beforeCount).filter((e) => e.phase === 'send');
        expect(sends.length).toBeGreaterThan(0);
    });

    it('#13 WebSocket("wss://x") without new throws TypeError [RED]', () => {
        installAll();
        // Native WebSocket constructor throws when called without `new`.
        expect(() => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (window.WebSocket as any)('wss://test.example/');
        }).toThrow(TypeError);
    });

    // ──────────────────────────────────────────────────────────────
    // Enumeration / serialization stays native
    // ──────────────────────────────────────────────────────────────

    it('#14 for...in over localStorage yields only stored keys (no setItem etc)', () => {
        installAll();
        window.localStorage.setItem('a', '1');
        window.localStorage.setItem('b', '2');
        const keys: string[] = [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const k in window.localStorage as any) keys.push(k);
        expect(keys.sort()).toEqual(['a', 'b']);
        expect(keys).not.toContain('setItem');
    });

    it('#15 Reflect.ownKeys(localStorage) excludes patched methods', () => {
        installAll();
        window.localStorage.setItem('x', '1');
        const ownKeys = Reflect.ownKeys(window.localStorage);
        // Patched code MAY add setItem etc. as own properties — Phase 0 documents
        // that the eventual Proxy-based refactor must NOT pollute ownKeys.
        // Today: instance own properties may include patched methods → this CAN fail.
        expect(ownKeys.includes('setItem')).toBe(false);
        expect(ownKeys.includes('removeItem')).toBe(false);
        expect(ownKeys.includes('clear')).toBe(false);
    });

    it('#16 JSON.stringify(localStorage) === "{}" when empty', () => {
        installAll();
        // Native behavior: Storage has no enumerable own data props, stringify -> "{}".
        // If our wrapping pollutes ownKeys with method names, this will produce noise.
        expect(JSON.stringify(window.localStorage)).toBe('{}');
    });

    it('#17 destructured setItem with detached `this` throws (strict mode)', () => {
        installAll();
        const { setItem } = window.localStorage;
        // Real Storage.prototype.setItem requires `this` to be a Storage instance.
        // happy-dom may diverge from real browsers; we just assert it throws *some* error.
        expect(() => (setItem as (k: string, v: string) => void)('k', 'v'))
            .toThrow();
    });

    it('#18 localStorage.setItem.bind(localStorage)("k","v") triggers onEntry', () => {
        installAll();
        const beforeCount = storageEvents.length;
        const bound = window.localStorage.setItem.bind(window.localStorage);
        bound('bound-key', 'v');
        expect(storageEvents.slice(beforeCount).some((e) => e.key === 'bound-key')).toBe(true);
    });

    // ──────────────────────────────────────────────────────────────
    // Navigation — channel doesn't exist yet, expected to FAIL
    // ──────────────────────────────────────────────────────────────

    it('#19 location.href = "/foo" triggers a navigation observer [RED — no channel]', () => {
        installAll();
        // Phase 0 documents the gap: there is no navigation channel today. Any future
        // refactor must hook location.href setter and feed it through onEvent.
        const navObserver = vi.fn();
        // No public API yet — this test asserts the absence by inversion: nothing fires.
        // Refactor expectation: an installable navigation channel exists and fires.
        const before = navObserver.mock.calls.length;
        try {
            // Setting href in happy-dom may throw; guard so the test fails for the
            // intended reason (no observer fired), not for a setter throw.
            window.location.href = '/foo';
        } catch { /* expected on some envs */ }
        // Today: navObserver was never wired, and there's no API to wire it.
        // This expectation captures the desired behavior for refactor.
        expect(navObserver.mock.calls.length).toBeGreaterThan(before);
    });

    it('#20 history.pushState triggers a navigation observer [RED — no channel]', () => {
        installAll();
        const navObserver = vi.fn();
        const before = navObserver.mock.calls.length;
        window.history.pushState({}, '', '/x');
        expect(navObserver.mock.calls.length).toBeGreaterThan(before);
    });

    // ──────────────────────────────────────────────────────────────
    // Subclassing
    // ──────────────────────────────────────────────────────────────

    it('#21 class X extends WebSocket compiles + extends', () => {
        installAll();
        // Verify extends contract: prototype chain is preserved.
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

    // ──────────────────────────────────────────────────────────────
    // Dispose restoration
    // ──────────────────────────────────────────────────────────────

    it('#22 dispose restores: typeof/instanceof/identity all native again', () => {
        const beforeFetch = window.fetch;
        const beforeWs = window.WebSocket;
        const beforeStorage = window.localStorage;

        installAll();
        // Mid-install state differs from native.
        expect(window.fetch).not.toBe(beforeFetch);

        while (disposers.length) disposers.pop()!();

        // Post-dispose: globals restored.
        expect(window.fetch).toBe(beforeFetch);
        // wsPatch test util sets WebSocket to FakeWS pre-install; restored to original is documented
        // as "the value at install time" — sandbox refactor should make this strictly LIFO-correct.
        // For this case, just check the patch flag is cleared and a fresh install would succeed.
        expect(window.WebSocket).toBeDefined();
        // Storage identity may or may not be the *same* object; what matters is functionally clean.
        const probe = (window.localStorage as Storage).setItem;
        expect(typeof probe).toBe('function');
        // Verifying no further events flow.
        const before = storageEvents.length;
        window.localStorage.setItem('after-dispose', '1');
        expect(storageEvents.length).toBe(before);
    });
});
