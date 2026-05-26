/**
 * Smoke test for the top-level installSandbox surface — just enough to
 * confirm the module loads, handle has expected shape, and dispose works.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { installSandbox } from '../index.js';
import { _resetForTesting } from '../chain.js';

afterEach(() => {
    _resetForTesting();
});

describe('installSandbox smoke', () => {
    it('returns a handle with expected API surface', () => {
        const handle = installSandbox({});
        expect(typeof handle.dispose).toBe('function');
        expect(typeof handle.pause).toBe('function');
        expect(typeof handle.resume).toBe('function');
        expect(handle.enabled).toBeDefined();
    });

    it('enabled flags reflect channel patch success', () => {
        const handle = installSandbox({});
        // In happy-dom env, fetch / xhr / ws / storage / console / errors should patch successfully;
        // navigation may partially fail on location setters but ought to be enabled at least via history.
        expect(handle.enabled.fetch).toBe(true);
        expect(handle.enabled.xhr).toBe(true);
        expect(handle.enabled.ws).toBe(true);
        expect(handle.enabled.storage).toBe(true);
        expect(handle.enabled.console).toBe(true);
        expect(handle.enabled.errors).toBe(true);
        handle.dispose();
    });

    it('dispose is idempotent', () => {
        const handle = installSandbox({});
        handle.dispose();
        expect(() => handle.dispose()).not.toThrow();
    });

    it('multi-install: two handles can coexist; each disposes independently', () => {
        const a = installSandbox({});
        const b = installSandbox({});
        expect(a.enabled.fetch).toBe(true);
        expect(b.enabled.fetch).toBe(true);
        a.dispose();
        // After a.dispose, b should still see channels as enabled.
        expect(b.enabled.fetch).toBe(true);
        b.dispose();
    });

    it('pause / resume toggles event delivery without unpatching', () => {
        const events: unknown[] = [];
        const handle = installSandbox({ onEvent: (e) => events.push(e) });
        // Trigger a console.log
        console.log('seen');
        const seenBefore = events.length;
        expect(seenBefore).toBeGreaterThan(0);

        handle.pause();
        console.log('paused');
        const seenDuringPause = events.length;
        expect(seenDuringPause).toBe(seenBefore);

        handle.resume();
        console.log('resumed');
        expect(events.length).toBeGreaterThan(seenDuringPause);

        handle.dispose();
    });
});
