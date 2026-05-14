import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as fc from 'fast-check';
import { JsonMemoryStore } from './JsonMemoryStore.js';

function makeStore() {
    const dir = mkdtempSync(join(tmpdir(), 'harnessa-memory-test-'));
    const store = new JsonMemoryStore(dir);
    return { store, dir };
}

function cleanup(dir: string) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

// ── Unit Tests ───────────────────────────────────────────────────────────────

describe('JsonMemoryStore — unit tests', () => {
    let dir: string;
    let store: JsonMemoryStore;

    beforeEach(() => {
        ({ store, dir } = makeStore());
    });

    afterEach(() => {
        cleanup(dir);
    });

    it('get returns undefined for a missing key', () => {
        const result = store.get('proj', 'nonexistent-key');
        expect(result).toBeUndefined();
    });

    it('list returns empty array when no entries exist', () => {
        const result = store.list('proj');
        expect(result).toEqual([]);
    });

    it('set stores a value and get retrieves it', () => {
        store.set('proj', 'my-key', 'my-value');
        const entry = store.get('proj', 'my-key');
        expect(entry).toBeDefined();
        expect(entry!.key).toBe('my-key');
        expect(entry!.value).toBe('my-value');
        expect(typeof entry!.updatedAt).toBe('number');
        expect(entry!.updatedAt).toBeGreaterThan(0);
    });

    it('delete existing key returns { deleted: true }', () => {
        store.set('proj', 'to-delete', 'some-value');
        const deleted = store.delete('proj', 'to-delete');
        expect(deleted).toBe(true);
        expect(store.get('proj', 'to-delete')).toBeUndefined();
    });

    it('delete missing key returns { deleted: false }', () => {
        const deleted = store.delete('proj', 'does-not-exist');
        expect(deleted).toBe(false);
    });

    it('list returns all entries after multiple sets', () => {
        store.set('proj', 'key-a', 'val-a');
        store.set('proj', 'key-b', 'val-b');
        store.set('proj', 'key-c', 'val-c');
        const entries = store.list('proj');
        expect(entries).toHaveLength(3);
        const keys = entries.map((e) => e.key);
        expect(keys).toContain('key-a');
        expect(keys).toContain('key-b');
        expect(keys).toContain('key-c');
    });

    it('set overwrites an existing key', () => {
        store.set('proj', 'key', 'original');
        store.set('proj', 'key', 'updated');
        const entry = store.get('proj', 'key');
        expect(entry!.value).toBe('updated');
        const entries = store.list('proj');
        expect(entries).toHaveLength(1);
    });

    it('entries are isolated per projectId', () => {
        store.set('proj-a', 'key', 'value-a');
        store.set('proj-b', 'key', 'value-b');
        expect(store.get('proj-a', 'key')!.value).toBe('value-a');
        expect(store.get('proj-b', 'key')!.value).toBe('value-b');
    });
});

// ── Property-Based Tests ─────────────────────────────────────────────────────

// Feature: persistence, Property 15: Memory set/get round-trip
describe('Property 15: Memory set/get round-trip', () => {
    it('for any key-value pair, get after set returns the written value with a valid updatedAt timestamp', () => {
        // Validates: Requirements 7.1, 7.2, 9.1, 9.2
        fc.assert(
            fc.property(
                fc.tuple(fc.string({ minLength: 1 }), fc.string()),
                ([key, value]) => {
                    const dir = mkdtempSync(join(tmpdir(), 'pbt-p15-'));
                    try {
                        const store = new JsonMemoryStore(dir);
                        const before = Date.now();
                        store.set('proj', key, value);
                        const entry = store.get('proj', key);

                        expect(entry).toBeDefined();
                        expect(entry!.key).toBe(key);
                        expect(entry!.value).toBe(value);
                        expect(typeof entry!.updatedAt).toBe('number');
                        expect(entry!.updatedAt).toBeGreaterThanOrEqual(before);
                    } finally {
                        cleanup(dir);
                    }
                },
            ),
            { numRuns: 100 },
        );
    });
});

// Feature: persistence, Property 14: Memory list sort order
describe('Property 14: Memory list sort order', () => {
    it('list returns entries sorted by updatedAt in strictly descending order', async () => {
        // Validates: Requirements 7.4, 9.3
        await fc.assert(
            fc.asyncProperty(
                fc.array(
                    fc.tuple(fc.string({ minLength: 1 }), fc.string()),
                    { minLength: 2 },
                ),
                async (pairs) => {
                    const dir = mkdtempSync(join(tmpdir(), 'pbt-p14-'));
                    try {
                        const store = new JsonMemoryStore(dir);

                        // Deduplicate keys to ensure distinct entries
                        const seen = new Set<string>();
                        const uniquePairs: Array<[string, string]> = [];
                        for (const [k, v] of pairs) {
                            if (!seen.has(k)) {
                                seen.add(k);
                                uniquePairs.push([k, v]);
                            }
                        }

                        // Need at least 2 distinct keys to test sort order
                        if (uniquePairs.length < 2) return;

                        // Write entries with small delays to ensure distinct updatedAt values
                        for (const [key, value] of uniquePairs) {
                            store.set('proj', key, value);
                            // Introduce a tiny delay to ensure distinct timestamps
                            await new Promise((r) => setTimeout(r, 1));
                        }

                        const entries = store.list('proj');
                        expect(entries.length).toBe(uniquePairs.length);

                        // Verify strictly descending order
                        for (let i = 1; i < entries.length; i++) {
                            expect(entries[i - 1].updatedAt).toBeGreaterThanOrEqual(entries[i].updatedAt);
                        }
                    } finally {
                        cleanup(dir);
                    }
                },
            ),
            { numRuns: 50 },
        );
    });
});
