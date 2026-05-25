// @vitest-environment happy-dom
/**
 * Phase 0 — chain / composition contract spec for @harness-fe/sandbox.
 *
 * Mix of real tests on current implementation (idempotency, etc.) and
 * `it.todo()` for capabilities the future `installSandbox` must provide.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installStoragePatch } from './storagePatch.js';

let disposers: Array<() => void> = [];
let storageEvents: Array<{ key?: string }> = [];

beforeEach(() => {
    disposers = [];
    storageEvents = [];
    try { window.localStorage.clear(); } catch { /* noop */ }
});

afterEach(() => {
    while (disposers.length) {
        try { disposers.pop()!(); } catch { /* noop */ }
    }
});

describe('Chain / composition contract — Phase 0 spec', () => {

    // ──────────────────────────────────────────────────────────────
    // Idempotency on current API (real tests against current code)
    // ──────────────────────────────────────────────────────────────

    it('installStoragePatch is idempotent — second install is a no-op (current impl behavior)', () => {
        disposers.push(installStoragePatch({ onEntry: (e) => storageEvents.push(e) }));
        // Current impl uses a PATCHED_FLAG sentinel; second call returns a noop dispose.
        const secondDispose = installStoragePatch({ onEntry: () => { /* swallowed */ } });
        disposers.push(secondDispose);

        const beforeCount = storageEvents.length;
        window.localStorage.setItem('idempo', '1');
        const newOnes = storageEvents.length - beforeCount;
        // Current observation: only the FIRST onEntry fires; second install was no-op.
        expect(newOnes).toBe(1);
    });

    // ──────────────────────────────────────────────────────────────
    // Multi-install composition (NEW behavior — refactor required)
    // ──────────────────────────────────────────────────────────────

    it.todo('installSandbox twice — both interceptors fire (onion order, outer wraps inner)');
    it.todo('dispose order is strictly LIFO — last installed must be disposed first');
    it.todo('disposing in non-LIFO order warns but does not throw');
    it.todo('after all dispose, window.localStorage / fetch / WebSocket are bit-identical to pre-install');
    it.todo('outer interceptor sees value AFTER inner interceptor has transformed it');
    it.todo('returning false in any chain layer short-circuits remaining layers + native action');

    // ──────────────────────────────────────────────────────────────
    // Per-channel install vs unified install
    // ──────────────────────────────────────────────────────────────

    it.todo('selectively enable channels via observe: { fetch: true, storage: false, ... }');
    it.todo('each channel can be independently disposed via SandboxHandle');
    it.todo('SandboxHandle.pause() suspends events without uninstalling patches');
    it.todo('SandboxHandle.resume() resumes after pause');

    // ──────────────────────────────────────────────────────────────
    // self URL denylist (harness-fe-specific use case, generalized)
    // ──────────────────────────────────────────────────────────────

    it.todo('selfUrls option excludes daemon WS connection from ws channel (prevents self-loop)');
});
