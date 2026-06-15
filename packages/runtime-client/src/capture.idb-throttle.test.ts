// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Capture the onEvent callback installSandbox is given so the test can push
// synthetic 'indexeddb' SandboxEvents straight through the real adapt() +
// forwardIdb() path without patching the global indexedDB.
const { installSandboxSpy, captured } = vi.hoisted(() => {
    const captured: { onEvent?: (e: unknown) => void } = {};
    const installSandboxSpy = vi.fn((opts: { onEvent: (e: unknown) => void }) => {
        captured.onEvent = opts.onEvent;
        return { dispose: () => {} };
    });
    return { installSandboxSpy, captured };
});

vi.mock('@harness-fe/sandbox', () => ({ installSandbox: installSandboxSpy }));

import { CaptureStore } from './capture.js';

function idbEvent(key: string) {
    return {
        ts: 1,
        source: 'indexeddb' as const,
        kind: 'put' as const,
        data: { op: 'put', store: 'notes', key, success: true },
    };
}

describe('CaptureStore idb throttle (harness-fe#158)', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        installSandboxSpy.mockClear();
        captured.onEvent = undefined;
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('forwards every idb op when throttling is off (default)', () => {
        const store = new CaptureStore();
        const forwarded: string[] = [];
        store.install((name) => { if (name === 'indexeddb') forwarded.push(name); });
        for (let i = 0; i < 5; i++) captured.onEvent!(idbEvent(`k${i}`));
        expect(forwarded).toHaveLength(5);
    });

    it('leading-edge + trailing: at most one forward per window, latest wins', () => {
        const store = new CaptureStore();
        const keys: string[] = [];
        store.install(
            (name, payload) => {
                if (name === 'indexeddb') keys.push((payload as { key: string }).key);
            },
            { idbThrottleMs: 100 },
        );

        // Burst of 4 within one window: first emits immediately (leading),
        // the rest only update the pending "latest".
        captured.onEvent!(idbEvent('a'));
        captured.onEvent!(idbEvent('b'));
        captured.onEvent!(idbEvent('c'));
        captured.onEvent!(idbEvent('d'));
        expect(keys).toEqual(['a']);

        // Window closes → trailing flush emits the latest pending ('d').
        vi.advanceTimersByTime(100);
        expect(keys).toEqual(['a', 'd']);

        // Quiet window then another op → no stale double-emit, then leads again.
        vi.advanceTimersByTime(100);
        captured.onEvent!(idbEvent('e'));
        expect(keys).toEqual(['a', 'd', 'e']);
    });

    it('always records every op into the local RingBuffer regardless of throttle', () => {
        const store = new CaptureStore();
        store.install(() => {}, { idbThrottleMs: 1000 });
        for (let i = 0; i < 5; i++) captured.onEvent!(idbEvent(`k${i}`));
        expect(store.indexeddb.size()).toBe(5);
    });
});
