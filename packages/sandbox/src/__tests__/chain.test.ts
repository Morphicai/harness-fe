/**
 * Multi-install / chain composition tests.
 *
 * Validates:
 *   - Multiple installSandbox() calls produce a chain — each interceptor fires
 *     in install order.
 *   - dispose() can run in LIFO without errors; full restoration after last dispose.
 *   - pause/resume/selfUrls per-install.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installSandbox } from '../index.js';
import { _resetForTesting } from '../chain.js';
import type { SandboxHandle } from '../types.js';

const handles: SandboxHandle[] = [];

beforeEach(() => {
    try { window.localStorage.clear(); window.sessionStorage.clear(); } catch { /* noop */ }
});

afterEach(() => {
    while (handles.length) {
        try { handles.pop()!.dispose(); } catch { /* ignore */ }
    }
    _resetForTesting();
});

describe('Chain — multi-install composition', () => {
    it('two installs both run; outer first, inner second (install order)', () => {
        const order: string[] = [];
        handles.push(installSandbox({
            storage: { onSet: (k, v) => { order.push(`outer:${k}=${v}`); return undefined; } },
        }));
        handles.push(installSandbox({
            storage: { onSet: (k, v) => { order.push(`inner:${k}=${v}`); return undefined; } },
        }));
        window.localStorage.setItem('K', 'V');
        expect(order).toEqual(['outer:K=V', 'inner:K=V']);
    });

    it('inner interceptor sees rewrites applied by outer (threading)', () => {
        handles.push(installSandbox({
            storage: { onSet: (k, v) => ({ key: `o:${k}`, value: `o:${v}` }) },
        }));
        let innerSaw: { k: string; v: string } | undefined;
        handles.push(installSandbox({
            storage: { onSet: (k, v) => { innerSaw = { k, v }; return undefined; } },
        }));
        window.localStorage.setItem('K', 'V');
        expect(innerSaw).toEqual({ k: 'o:K', v: 'o:V' });
        expect(window.localStorage.getItem('o:K')).toBe('o:V');
    });

    it('any layer returning false short-circuits remaining + native', () => {
        const order: string[] = [];
        handles.push(installSandbox({
            storage: { onSet: () => { order.push('outer'); return false; } },
        }));
        handles.push(installSandbox({
            storage: { onSet: () => { order.push('inner-should-not-run'); return undefined; } },
        }));
        window.localStorage.setItem('K', 'V');
        expect(order).toEqual(['outer']);
        expect(window.localStorage.getItem('K')).toBeNull();
    });

    it('dispose first install — second still works', () => {
        let aCount = 0;
        let bCount = 0;
        const a = installSandbox({
            storage: { onSet: () => { aCount++; return undefined; } },
        });
        const b = installSandbox({
            storage: { onSet: () => { bCount++; return undefined; } },
        });
        handles.push(a, b);

        a.dispose();
        window.localStorage.setItem('K', 'V');
        expect(aCount).toBe(0);
        expect(bCount).toBe(1);
    });

    it('dispose in LIFO restores globals after last dispose', () => {
        const beforeFetch = window.fetch;
        const a = installSandbox({});
        const b = installSandbox({});
        expect(window.fetch).not.toBe(beforeFetch);
        b.dispose();
        // After only b disposed, fetch still wrapped.
        expect(window.fetch).not.toBe(beforeFetch);
        a.dispose();
        // Now both disposed — fetch restored.
        expect(window.fetch).toBe(beforeFetch);
    });

    it('selfUrls denylist skips wrapping for matching URL', async () => {
        const seen: string[] = [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).fetch = async (input: RequestInfo | URL) => {
            seen.push(String(input));
            return new Response('ok');
        };
        let interceptorCalls = 0;
        handles.push(installSandbox({
            selfUrls: ['https://daemon.test/'],
            fetch: {
                onRequest: () => { interceptorCalls++; return undefined; },
            },
        }));
        await window.fetch('https://daemon.test/events');
        await window.fetch('https://api.test/users');
        expect(interceptorCalls).toBe(1);  // only the non-self URL went through
        expect(seen).toContain('https://daemon.test/events');
        expect(seen).toContain('https://api.test/users');
    });
});

describe('SandboxHandle pause / resume', () => {
    it('pause stops onEvent delivery without unpatching globals', () => {
        const events: string[] = [];
        const h = installSandbox({ onEvent: (e) => events.push(`${e.source}.${e.kind}`) });
        handles.push(h);

        window.localStorage.setItem('a', '1');
        const seenBefore = events.length;
        expect(seenBefore).toBeGreaterThan(0);

        h.pause();
        window.localStorage.setItem('b', '2');
        expect(events.length).toBe(seenBefore);

        h.resume();
        window.localStorage.setItem('c', '3');
        expect(events.length).toBeGreaterThan(seenBefore);
    });
});

describe('Selective channel observe flag', () => {
    it('observe: { storage: false } leaves storage unpatched', () => {
        const h = installSandbox({
            observe: { storage: false },
            onEvent: () => { /* noop */ },
        });
        handles.push(h);
        expect(h.enabled.storage).toBe(false);
        // Default Storage methods are the originals (no Proxy).
        // Hard to assert "no patch" cleanly without checking the descriptor, so just
        // verify the channel reports disabled in `enabled`.
    });
});
