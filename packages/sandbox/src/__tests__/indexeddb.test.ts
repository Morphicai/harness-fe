/**
 * IndexedDB channel tests.
 *
 * happy-dom 20 ships an IndexedDB polyfill backed by an in-memory store.
 * Tests below build a tiny test DB and exercise put/get/delete/clear hooks.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// happy-dom doesn't ship IndexedDB; polyfill before sandbox loads so that
// IDBFactory / IDBObjectStore prototypes are patchable.
// eslint-disable-next-line import/no-unresolved
import 'fake-indexeddb/auto';
import { installSandbox } from '../index.js';
import { _resetForTesting } from '../chain.js';
import type { SandboxHandle } from '../types.js';

let handle: SandboxHandle | undefined;

async function openTestDb(name: string, storeName = 'kv'): Promise<IDBDatabase> {
    return new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(name, 1);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(storeName)) {
                db.createObjectStore(storeName);
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

function dbOp<T>(req: IDBRequest<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

beforeEach(() => {
    // Delete any leftover DBs from previous runs.
});

afterEach(() => {
    handle?.dispose();
    handle = undefined;
    _resetForTesting();
});

describe('indexeddb channel', () => {
    it('onOpen observes db.open()', async () => {
        const dbNames: string[] = [];
        handle = installSandbox({
            indexeddb: { onOpen: (name) => { dbNames.push(name); return undefined; } },
        });
        const db = await openTestDb('test-open-db');
        expect(dbNames).toContain('test-open-db');
        db.close();
    });

    it('observer fires for put / get', async () => {
        const events: Array<{ kind: string; key?: unknown; value?: unknown }> = [];
        handle = installSandbox({
            onEvent: (e) => {
                if (e.source === 'indexeddb') {
                    events.push({ kind: e.kind, key: e.data.key, value: e.data.value });
                }
            },
        });
        const db = await openTestDb('test-put-db');
        const tx = db.transaction('kv', 'readwrite');
        await dbOp(tx.objectStore('kv').put('hello', 'greeting'));
        const tx2 = db.transaction('kv', 'readonly');
        const result = await dbOp(tx2.objectStore('kv').get('greeting'));
        expect(result).toBe('hello');
        expect(events.some((e) => e.kind === 'put' && e.key === 'greeting' && e.value === 'hello')).toBe(true);
        expect(events.some((e) => e.kind === 'get' && e.key === 'greeting')).toBe(true);
        db.close();
    });

    it('onPut can rewrite value', async () => {
        handle = installSandbox({
            indexeddb: {
                onPut: (_store, k, _v) => ({ key: k, value: 'rewritten' }),
            },
        });
        const db = await openTestDb('test-rewrite-db');
        const tx = db.transaction('kv', 'readwrite');
        await dbOp(tx.objectStore('kv').put('original', 'k'));
        const tx2 = db.transaction('kv', 'readonly');
        const result = await dbOp(tx2.objectStore('kv').get('k'));
        expect(result).toBe('rewritten');
        db.close();
    });

    it('onGet can short-circuit with override', async () => {
        const db = await openTestDb('test-shortcircuit-db');
        const tx = db.transaction('kv', 'readwrite');
        await dbOp(tx.objectStore('kv').put('real', 'k'));

        handle = installSandbox({
            indexeddb: {
                onGet: (_s, key) => key === 'k' ? 'override' : undefined,
            },
        });
        const tx2 = db.transaction('kv', 'readonly');
        const result = await dbOp(tx2.objectStore('kv').get('k'));
        expect(result).toBe('override');
        db.close();
    });

    it('onDelete returning false blocks delete', async () => {
        const db = await openTestDb('test-delete-block-db');
        const tx = db.transaction('kv', 'readwrite');
        await dbOp(tx.objectStore('kv').put('keep', 'k'));

        handle = installSandbox({
            indexeddb: { onDelete: () => false },
        });
        const tx2 = db.transaction('kv', 'readwrite');
        await dbOp(tx2.objectStore('kv').delete('k'));
        // delete blocked → value still there
        const tx3 = db.transaction('kv', 'readonly');
        const result = await dbOp(tx3.objectStore('kv').get('k'));
        expect(result).toBe('keep');
        db.close();
    });

    it('onClear returning false blocks clear', async () => {
        const db = await openTestDb('test-clear-block-db');
        const tx = db.transaction('kv', 'readwrite');
        await dbOp(tx.objectStore('kv').put('val', 'k'));

        handle = installSandbox({
            indexeddb: { onClear: () => false },
        });
        const tx2 = db.transaction('kv', 'readwrite');
        await dbOp(tx2.objectStore('kv').clear());
        const tx3 = db.transaction('kv', 'readonly');
        const result = await dbOp(tx3.objectStore('kv').get('k'));
        expect(result).toBe('val');
        db.close();
    });
});
