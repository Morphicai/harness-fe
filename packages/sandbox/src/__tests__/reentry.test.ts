/**
 * Reentry guard — protect against infinite loops when an interceptor or
 * observer triggers a patched API recursively.
 *
 *   onSet: (k, v) => { localStorage.setItem(`echo:${k}`, v); return undefined; }
 *
 * Without the guard this loops forever. With it, the inner setItem skips the
 * interceptor (and emit) and proceeds straight to the native write — the
 * recursive write SUCCEEDS, just isn't observed.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installSandbox } from '../index.js';
import { _resetForTesting } from '../chain.js';
import type { SandboxHandle } from '../types.js';

let handle: SandboxHandle | undefined;

beforeEach(() => {
    try { window.localStorage.clear(); } catch { /* noop */ }
});

afterEach(() => {
    handle?.dispose();
    handle = undefined;
    _resetForTesting();
});

describe('reentry guard', () => {
    it('storage onSet that writes to storage does NOT loop', () => {
        let outerCalls = 0;
        handle = installSandbox({
            storage: {
                onSet: (k, v, _which, _ctx) => {
                    outerCalls++;
                    // Recurse: write a derived key. WITHOUT guard this loops infinitely
                    // because the inner setItem re-fires onSet which writes again.
                    if (!k.startsWith('echo:')) {
                        window.localStorage.setItem(`echo:${k}`, String(v));
                    }
                    return undefined;
                },
            },
        });

        window.localStorage.setItem('root', 'V');

        // Only the OUTER setItem should trip the interceptor; the inner one is guarded.
        expect(outerCalls).toBe(1);
        // Both writes still landed (guard suppresses observation, not the side effect).
        expect(window.localStorage.getItem('root')).toBe('V');
        expect(window.localStorage.getItem('echo:root')).toBe('V');
    });

    it('storage onEvent that writes to storage does NOT loop', () => {
        let eventCount = 0;
        handle = installSandbox({
            onEvent: (e) => {
                if (e.source !== 'storage') return;
                eventCount++;
                // Recurse via observer.
                if (e.data.key === 'orig') {
                    window.localStorage.setItem('observer-echo', 'x');
                }
            },
        });

        window.localStorage.setItem('orig', '1');

        // Outer + (inner, but suppressed) = exactly 1 storage event.
        expect(eventCount).toBe(1);
        // Both writes landed.
        expect(window.localStorage.getItem('orig')).toBe('1');
        expect(window.localStorage.getItem('observer-echo')).toBe('x');
    });

    it('console onEvent that calls console does NOT loop', () => {
        let count = 0;
        const origLog = console.log;
        // Silence real console output during this test.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        console.log = (() => {}) as any;
        try {
            handle = installSandbox({
                onEvent: (e) => {
                    if (e.source !== 'console') return;
                    count++;
                    // Recurse.
                    console.log('echo');
                },
            });
            console.log('outer');
        } finally {
            console.log = origLog;
        }
        expect(count).toBe(1);
    });

    it('after the outer guard exits, the next top-level call observes normally', () => {
        let count = 0;
        handle = installSandbox({
            storage: { onSet: () => { count++; window.localStorage.setItem('echo', 'x'); return undefined; } },
        });
        window.localStorage.setItem('a', '1');  // count=1; inner echo suppressed
        window.localStorage.setItem('b', '2');  // count=2; inner echo suppressed
        expect(count).toBe(2);
    });

    it('navigation onPush that calls pushState does NOT loop', () => {
        let count = 0;
        handle = installSandbox({
            navigation: {
                onPush: (url) => {
                    count++;
                    // Inner pushState — guard suppresses recursion.
                    if (url !== '/recursed') {
                        window.history.pushState({}, '', '/recursed');
                    }
                    return undefined;
                },
            },
        });
        window.history.pushState({}, '', '/outer');
        expect(count).toBe(1);
    });
});
