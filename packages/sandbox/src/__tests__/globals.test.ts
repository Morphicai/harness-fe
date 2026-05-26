/**
 * Globals channel tests — per-key window.X watch with observe + intercept.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installSandbox } from '../index.js';
import { _resetForTesting } from '../chain.js';
import type { SandboxHandle } from '../types.js';

let handle: SandboxHandle | undefined;
const cleanupKeys = ['MY_GLOBAL', 'OTHER_GLOBAL', 'BLOCKED'];

beforeEach(() => {
    for (const k of cleanupKeys) {
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            delete (window as any)[k];
        } catch { /* ignore */ }
    }
});

afterEach(() => {
    handle?.dispose();
    handle = undefined;
    _resetForTesting();
    for (const k of cleanupKeys) {
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            delete (window as any)[k];
        } catch { /* ignore */ }
    }
});

describe('globals channel', () => {
    it('onSet observes writes to watched keys', () => {
        const seen: Array<{ k: string; v: unknown }> = [];
        handle = installSandbox({
            globals: {
                watch: ['MY_GLOBAL'],
                onSet: (k, v) => { seen.push({ k, v }); return undefined; },
            },
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).MY_GLOBAL = 42;
        expect(seen).toEqual([{ k: 'MY_GLOBAL', v: 42 }]);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((window as any).MY_GLOBAL).toBe(42);
    });

    it('onSet returning false blocks the write', () => {
        handle = installSandbox({
            globals: {
                watch: ['BLOCKED'],
                onSet: () => false,
            },
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).BLOCKED = 'nope';
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((window as any).BLOCKED).toBeUndefined();
    });

    it('onSet can rewrite the value', () => {
        handle = installSandbox({
            globals: {
                watch: ['MY_GLOBAL'],
                onSet: (_k, v) => `rewritten:${v}`,
            },
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).MY_GLOBAL = 'orig';
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((window as any).MY_GLOBAL).toBe('rewritten:orig');
    });

    it('onGet can override read', () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).MY_GLOBAL = 'real';
        handle = installSandbox({
            globals: {
                watch: ['MY_GLOBAL'],
                onGet: (k) => k === 'MY_GLOBAL' ? 'fake' : undefined,
            },
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((window as any).MY_GLOBAL).toBe('fake');
    });

    it('un-watched keys are not intercepted', () => {
        const seen: string[] = [];
        handle = installSandbox({
            globals: {
                watch: ['MY_GLOBAL'],
                onSet: (k) => { seen.push(k); return undefined; },
            },
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).OTHER_GLOBAL = 'noise';
        expect(seen).toEqual([]);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((window as any).OTHER_GLOBAL).toBe('noise');
    });

    it('observer onEvent fires for watched gets and sets', () => {
        const events: Array<{ source: string; kind: string; key?: string; value?: unknown }> = [];
        handle = installSandbox({
            globals: { watch: ['MY_GLOBAL'] },
            onEvent: (e) => {
                if (e.source === 'globals') {
                    events.push({
                        source: e.source,
                        kind: e.kind,
                        key: e.data.key,
                        value: e.data.value,
                    });
                }
            },
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).MY_GLOBAL = 'V';
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const v = (window as any).MY_GLOBAL;
        expect(v).toBe('V');
        expect(events.some((e) => e.kind === 'set' && e.value === 'V')).toBe(true);
        expect(events.some((e) => e.kind === 'get' && e.value === 'V')).toBe(true);
    });

    it('dispose restores the original (no-op) descriptor', () => {
        handle = installSandbox({
            globals: { watch: ['MY_GLOBAL'], onSet: () => false },
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).MY_GLOBAL = 'blocked';
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((window as any).MY_GLOBAL).toBeUndefined();

        handle.dispose();
        handle = undefined;
        // After dispose, writes should go through unchanged.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).MY_GLOBAL = 'after-dispose';
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((window as any).MY_GLOBAL).toBe('after-dispose');
    });

    it('non-configurable keys (e.g. location) silently skip', () => {
        // window.location is unforgeable in real browsers. happy-dom may permit
        // defineProperty though, so just confirm no error is thrown either way.
        expect(() => {
            handle = installSandbox({
                globals: { watch: ['location'], onSet: () => false },
            });
        }).not.toThrow();
    });
});
