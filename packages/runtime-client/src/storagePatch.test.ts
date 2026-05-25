// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installStoragePatch } from './storagePatch.js';
import type { StorageEntry } from '@harness-fe/protocol';

let entries: StorageEntry[];
let dispose: () => void;

beforeEach(() => {
    entries = [];
    try {
        window.localStorage.clear();
        window.sessionStorage.clear();
    } catch {
        /* ignore */
    }
});

afterEach(() => {
    dispose?.();
});

describe('installStoragePatch', () => {
    it('captures localStorage.setItem with initiator stack', () => {
        dispose = installStoragePatch({ onEntry: (e) => entries.push(e) });
        localStorage.setItem('token', 'abc123');
        const entry = entries.find((e) => e.op === 'set' && e.which === 'local')!;
        expect(entry).toBeDefined();
        expect(entry.key).toBe('token');
        expect(entry.value).toBe('abc123');
        expect(entry.initiator).toBeDefined();
        // setItem still actually wrote.
        expect(localStorage.getItem('token')).toBe('abc123');
    });

    it('captures localStorage.removeItem', () => {
        localStorage.setItem('token', 'x');
        dispose = installStoragePatch({ onEntry: (e) => entries.push(e) });
        localStorage.removeItem('token');
        const entry = entries.find((e) => e.op === 'remove')!;
        expect(entry).toBeDefined();
        expect(entry.key).toBe('token');
        expect(entry.which).toBe('local');
        expect(localStorage.getItem('token')).toBeNull();
    });

    it('captures localStorage.clear', () => {
        dispose = installStoragePatch({ onEntry: (e) => entries.push(e) });
        localStorage.setItem('a', '1');
        entries.length = 0;
        localStorage.clear();
        const entry = entries.find((e) => e.op === 'clear')!;
        expect(entry).toBeDefined();
        expect(entry.which).toBe('local');
    });

    it('disambiguates sessionStorage vs localStorage when they are distinct instances', () => {
        // happy-dom's sessionStorage and localStorage may share an underlying
        // instance, in which case the patch dispatches once with kind='local'.
        // We only assert the disambiguation in environments where the two are
        // genuinely distinct objects.
        if (window.sessionStorage === window.localStorage) {
            return;
        }
        dispose = installStoragePatch({ onEntry: (e) => entries.push(e) });
        sessionStorage.setItem('s', '1');
        localStorage.setItem('l', '1');
        const session = entries.find((e) => e.which === 'session');
        const local = entries.find((e) => e.which === 'local');
        expect(session?.key).toBe('s');
        expect(local?.key).toBe('l');
    });

    it('clips oversized values', () => {
        dispose = installStoragePatch({ onEntry: (e) => entries.push(e), valueCap: 5 });
        localStorage.setItem('big', 'x'.repeat(50));
        const entry = entries.find((e) => e.key === 'big')!;
        expect(entry.value?.startsWith('xxxxx')).toBe(true);
        expect(entry.value?.includes('+45B')).toBe(true);
    });

    it('captures crossTab event without initiator', () => {
        dispose = installStoragePatch({ onEntry: (e) => entries.push(e) });
        // Simulate cross-tab event by dispatching a StorageEvent manually.
        const ev = new StorageEvent('storage', {
            key: 'token',
            newValue: null,
            oldValue: 'x',
            storageArea: window.localStorage,
        });
        window.dispatchEvent(ev);
        const entry = entries.find((e) => e.crossTab)!;
        expect(entry).toBeDefined();
        expect(entry.op).toBe('remove');
        expect(entry.which).toBe('local');
        expect(entry.initiator).toBeUndefined();
    });

    it('captures cookie set / remove via Max-Age=0 when document.cookie is descriptor-backed', () => {
        // happy-dom may not expose document.cookie via Document.prototype with
        // a property descriptor. We skip when the descriptor isn't writable
        // since the patch path is provably unreachable in that environment.
        const desc = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
        if (!desc?.set || !desc?.get) return;
        dispose = installStoragePatch({ onEntry: (e) => entries.push(e) });
        document.cookie = 'sid=abc; Path=/';
        document.cookie = 'sid=; Max-Age=0; Path=/';
        const sets = entries.filter((e) => e.which === 'cookie' && e.op === 'set');
        const removes = entries.filter((e) => e.which === 'cookie' && e.op === 'remove');
        expect(sets.length).toBeGreaterThanOrEqual(1);
        expect(removes.length).toBeGreaterThanOrEqual(1);
        expect(sets[0].key).toBe('sid');
        expect(removes[0].key).toBe('sid');
    });

    it('parses cookie removal via past Expires', () => {
        const desc = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
        if (!desc?.set || !desc?.get) return;
        dispose = installStoragePatch({ onEntry: (e) => entries.push(e) });
        document.cookie = 'sid=; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/';
        const removes = entries.filter((e) => e.which === 'cookie' && e.op === 'remove');
        expect(removes.length).toBeGreaterThanOrEqual(1);
    });

    it('dispose stops capture and leaves storage operations working', () => {
        dispose = installStoragePatch({ onEntry: (e) => entries.push(e) });
        localStorage.setItem('foo', 'bar');
        expect(entries.length).toBeGreaterThan(0);
        const before = entries.length;
        dispose();
        // After dispose, further mutations should not push new entries.
        localStorage.setItem('foo2', 'bar2');
        expect(entries.length).toBe(before);
        // But the write itself still happened.
        expect(localStorage.getItem('foo2')).toBe('bar2');
    });
});
