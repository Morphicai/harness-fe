/**
 * IndexedDB channel — observe + intercept core IDB operations.
 *
 * Patches:
 *   - IDBFactory.prototype.open                  (database open/version-upgrade)
 *   - IDBObjectStore.prototype.{put, add, get, getAll, delete, clear, openCursor}
 *
 * Limitations (documented, not surprises):
 *   - Short-circuit on get returns a synthetic IDBRequest with the override value.
 *     The request fires onsuccess immediately; onerror is never used.
 *   - put/add/delete/clear can be blocked or rewritten before native; the request
 *     itself proceeds to the real store (so onsuccess fires normally for blocked
 *     ops too — emitted observation marks `success: false`).
 *   - Cursor / index ops only observe (no interception of iteration).
 *   - Transactions are not wrapped — interceptors run inline within whatever tx
 *     the caller built.
 *
 * Graceful: every patch step in try/catch. If IDB is unavailable in the env,
 * channel silently no-ops.
 */

import type { IndexedDbObservation, SandboxCtx } from '../types.js';
import { captureInitiator } from '../initiator.js';
import { emit, getChain, registerPatch } from '../chain.js';

const PATCHED_FLAG = '__hfeSandboxIdbPatched__';

function emitIdb(op: IndexedDbObservation['op'], info: Partial<IndexedDbObservation>, initiator?: SandboxCtx['initiator']): void {
    const data: IndexedDbObservation = { op, ...info } as IndexedDbObservation;
    emit('indexeddb', { ts: Date.now(), source: 'indexeddb', kind: op, data, initiator });
}

function makeCtx(kind: IndexedDbObservation['op']): SandboxCtx {
    return { channel: 'indexeddb', kind, initiator: captureInitiator(), ts: Date.now() };
}

function runOnOpen(name: string, version: number | undefined): { blocked: boolean; name: string; version: number | undefined } {
    const ctx = makeCtx('open');
    let n = name, v = version, blocked = false;
    for (const entry of getChain('indexeddb')) {
        const hook = entry.opts.indexeddb?.onOpen;
        if (!hook) continue;
        try {
            const r = hook(n, v, ctx);
            if (r === false) { blocked = true; break; }
            if (r && typeof r === 'object') {
                if (typeof r.name === 'string') n = r.name;
                if (typeof r.version === 'number') v = r.version;
            }
        } catch { /* skip */ }
    }
    return { blocked, name: n, version: v };
}

function runOnPut(store: string, key: unknown, value: unknown): { blocked: boolean; key: unknown; value: unknown } {
    const ctx = makeCtx('put');
    let fk = key, fv = value, blocked = false;
    for (const entry of getChain('indexeddb')) {
        const hook = entry.opts.indexeddb?.onPut;
        if (!hook) continue;
        try {
            const r = hook(store, fk, fv, ctx);
            if (r === false) { blocked = true; break; }
            if (r && typeof r === 'object') {
                if ('key' in r) fk = r.key;
                if ('value' in r) fv = r.value;
            }
        } catch { /* skip */ }
    }
    return { blocked, key: fk, value: fv };
}

function runOnGet(store: string, key: unknown): unknown | undefined {
    const ctx = makeCtx('get');
    for (const entry of getChain('indexeddb')) {
        const hook = entry.opts.indexeddb?.onGet;
        if (!hook) continue;
        try {
            const r = hook(store, key, ctx);
            if (r !== undefined) return r;
        } catch { /* skip */ }
    }
    return undefined;
}

function runOnDelete(store: string, key: unknown): { blocked: boolean } {
    const ctx = makeCtx('delete');
    for (const entry of getChain('indexeddb')) {
        const hook = entry.opts.indexeddb?.onDelete;
        if (!hook) continue;
        try { if (hook(store, key, ctx) === false) return { blocked: true }; }
        catch { /* skip */ }
    }
    return { blocked: false };
}

function runOnClear(store: string): { blocked: boolean } {
    const ctx = makeCtx('clear');
    for (const entry of getChain('indexeddb')) {
        const hook = entry.opts.indexeddb?.onClear;
        if (!hook) continue;
        try { if (hook(store, ctx) === false) return { blocked: true }; }
        catch { /* skip */ }
    }
    return { blocked: false };
}

/**
 * Construct a synthetic IDBRequest-like object that resolves with a value
 * asynchronously (microtask), used to short-circuit get/put operations.
 */
function syntheticRequest(result: unknown): IDBRequest {
    type RequestLike = {
        result: unknown;
        error: DOMException | null;
        source: null;
        transaction: null;
        readyState: 'pending' | 'done';
        onsuccess: ((this: IDBRequest, ev: Event) => unknown) | null;
        onerror: ((this: IDBRequest, ev: Event) => unknown) | null;
    };
    const req: RequestLike = {
        result,
        error: null,
        source: null,
        transaction: null,
        readyState: 'pending',
        onsuccess: null,
        onerror: null,
    };
    Promise.resolve().then(() => {
        req.readyState = 'done';
        try { req.onsuccess?.call(req as unknown as IDBRequest, new Event('success')); }
        catch { /* ignore */ }
    });
    return req as unknown as IDBRequest;
}

function installIdbPatch(): () => void {
    if (typeof indexedDB === 'undefined' || typeof IDBFactory === 'undefined' || typeof IDBObjectStore === 'undefined') {
        return () => {};
    }
    const factory = IDBFactory.prototype;
    const store = IDBObjectStore.prototype;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((factory as any)[PATCHED_FLAG]) return () => {};

    const origOpen = factory.open;
    const origPut = store.put;
    const origAdd = store.add;
    const origGet = store.get;
    const origGetAll = store.getAll;
    const origDelete = store.delete;
    const origClear = store.clear;
    const origCursor = store.openCursor;

    try {
        factory.open = function patchedOpen(this: IDBFactory, name: string, version?: number): IDBOpenDBRequest {
            try {
                const initiator = captureInitiator();
                const r = runOnOpen(name, version);
                emitIdb('open', { db: r.name, version: r.version }, initiator);
                if (r.blocked) {
                    return syntheticRequest(null) as IDBOpenDBRequest;
                }
                return r.version !== undefined
                    ? origOpen.call(this, r.name, r.version)
                    : origOpen.call(this, r.name);
            } catch {
                return version !== undefined ? origOpen.call(this, name, version) : origOpen.call(this, name);
            }
        };

        store.put = function patchedPut(this: IDBObjectStore, value: unknown, key?: IDBValidKey): IDBRequest {
            try {
                const initiator = captureInitiator();
                const r = runOnPut(this.name, key, value);
                emitIdb('put', { store: this.name, key: r.key, value: r.value, success: !r.blocked }, initiator);
                if (r.blocked) return syntheticRequest(undefined);
                return r.key !== undefined
                    ? origPut.call(this, r.value, r.key as IDBValidKey)
                    : origPut.call(this, r.value);
            } catch {
                return key !== undefined ? origPut.call(this, value, key) : origPut.call(this, value);
            }
        };

        store.add = function patchedAdd(this: IDBObjectStore, value: unknown, key?: IDBValidKey): IDBRequest {
            try {
                const initiator = captureInitiator();
                const r = runOnPut(this.name, key, value);  // reuse onPut for add semantics
                emitIdb('add', { store: this.name, key: r.key, value: r.value, success: !r.blocked }, initiator);
                if (r.blocked) return syntheticRequest(undefined);
                return r.key !== undefined
                    ? origAdd.call(this, r.value, r.key as IDBValidKey)
                    : origAdd.call(this, r.value);
            } catch {
                return key !== undefined ? origAdd.call(this, value, key) : origAdd.call(this, value);
            }
        };

        store.get = function patchedGet(this: IDBObjectStore, key: IDBValidKey | IDBKeyRange): IDBRequest {
            try {
                const initiator = captureInitiator();
                const override = runOnGet(this.name, key);
                if (override !== undefined) {
                    emitIdb('get', { store: this.name, key, value: override, success: true }, initiator);
                    return syntheticRequest(override);
                }
                emitIdb('get', { store: this.name, key }, initiator);
                return origGet.call(this, key);
            } catch {
                return origGet.call(this, key);
            }
        };

        store.getAll = function patchedGetAll(this: IDBObjectStore, ...args: unknown[]): IDBRequest {
            try {
                const initiator = captureInitiator();
                emitIdb('getAll', { store: this.name }, initiator);
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                return (origGetAll as any).apply(this, args);
            } catch {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                return (origGetAll as any).apply(this, args);
            }
        };

        store.delete = function patchedDelete(this: IDBObjectStore, key: IDBValidKey | IDBKeyRange): IDBRequest {
            try {
                const initiator = captureInitiator();
                const r = runOnDelete(this.name, key);
                emitIdb('delete', { store: this.name, key, success: !r.blocked }, initiator);
                if (r.blocked) return syntheticRequest(undefined);
                return origDelete.call(this, key);
            } catch {
                return origDelete.call(this, key);
            }
        };

        store.clear = function patchedClear(this: IDBObjectStore): IDBRequest {
            try {
                const initiator = captureInitiator();
                const r = runOnClear(this.name);
                emitIdb('clear', { store: this.name, success: !r.blocked }, initiator);
                if (r.blocked) return syntheticRequest(undefined);
                return origClear.call(this);
            } catch {
                return origClear.call(this);
            }
        };

        store.openCursor = function patchedCursor(this: IDBObjectStore, ...args: unknown[]): IDBRequest {
            try {
                emitIdb('cursor', { store: this.name }, captureInitiator());
            } catch { /* skip emit */ }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return (origCursor as any).apply(this, args);
        };

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (factory as any)[PATCHED_FLAG] = true;
    } catch {
        // Couldn't patch — try to restore anything we did.
        try { factory.open = origOpen; } catch { /* ignore */ }
        try { store.put = origPut; store.add = origAdd; store.get = origGet; } catch { /* ignore */ }
        try { store.getAll = origGetAll; store.delete = origDelete; store.clear = origClear; } catch { /* ignore */ }
        try { store.openCursor = origCursor; } catch { /* ignore */ }
        return () => {};
    }

    return () => {
        try {
            factory.open = origOpen;
            store.put = origPut;
            store.add = origAdd;
            store.get = origGet;
            store.getAll = origGetAll;
            store.delete = origDelete;
            store.clear = origClear;
            store.openCursor = origCursor;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            delete (factory as any)[PATCHED_FLAG];
        } catch { /* ignore */ }
    };
}

registerPatch('indexeddb', installIdbPatch);
