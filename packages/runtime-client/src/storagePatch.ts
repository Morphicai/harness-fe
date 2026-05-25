/**
 * Storage monkey-patch — captures localStorage / sessionStorage / cookie
 * mutations so agents can answer "who deleted my token?".
 *
 * Safety contract (mirrors fetchPatch / wsPatch):
 *  1. Identity-preserving: replacements use Object.defineProperty so
 *     `localStorage.setItem` keeps its prototype membership. Cookie wrapping
 *     uses a `document` getter/setter pair on the prototype.
 *  2. Error-isolated: capture failures swallowed; never propagate to callers.
 *  3. No timing or value change: every wrapper calls the original synchronously
 *     and returns its result.
 *  4. crossTab events captured via the native `storage` event (no initiator —
 *     the mutation happened in another tab so the stack is meaningless here).
 *
 * Idempotent. Returns a dispose function.
 */

import type { StorageEntry } from '@harness-fe/protocol';
import { captureInitiator } from './initiator.js';

const PATCHED_FLAG = '__hfeStoragePatched';

export interface StoragePatchOptions {
    onEntry: (entry: StorageEntry) => void;
    /** Per-value byte cap. Default 4 KB — captures small tokens, drops giant blobs. */
    valueCap?: number;
}

const DEFAULT_VALUE_CAP = 4 * 1024;

export function installStoragePatch(opts: StoragePatchOptions): () => void {
    if (typeof window === 'undefined') return () => {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((window as any)[PATCHED_FLAG]) return () => {};

    const valueCap = opts.valueCap ?? DEFAULT_VALUE_CAP;
    const emit = (entry: StorageEntry): void => {
        try {
            opts.onEntry(entry);
        } catch {
            /* swallow */
        }
    };

    const disposers: Array<() => void> = [];

    // Patch each storage instance directly — own properties shadow the
    // prototype regardless of how the engine implements them. This works
    // uniformly across real browsers, happy-dom, jsdom, and Electron.
    try {
        disposers.push(patchStorageInstance(window.localStorage, 'local', valueCap, emit));
    } catch { /* localStorage may be inaccessible (private mode, etc.) */ }
    try {
        disposers.push(patchStorageInstance(window.sessionStorage, 'session', valueCap, emit));
    } catch { /* ignore */ }

    if (typeof document !== 'undefined') {
        const cookieDispose = patchCookie(valueCap, emit);
        if (cookieDispose) disposers.push(cookieDispose);
    }

    // Cross-tab storage events.
    const onStorageEvent = (ev: StorageEvent): void => {
        const which: StorageEntry['which'] = ev.storageArea === window.sessionStorage ? 'session' : 'local';
        const op: StorageEntry['op'] = ev.key === null ? 'clear' : ev.newValue === null ? 'remove' : 'set';
        emit({
            ts: Date.now(),
            op,
            which,
            key: ev.key ?? undefined,
            value: ev.newValue !== null ? clip(ev.newValue, valueCap) : undefined,
            crossTab: true,
        });
    };
    window.addEventListener('storage', onStorageEvent);
    disposers.push(() => window.removeEventListener('storage', onStorageEvent));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any)[PATCHED_FLAG] = true;

    return () => {
        for (const d of disposers) {
            try {
                d();
            } catch {
                /* ignore */
            }
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        delete (window as any)[PATCHED_FLAG];
    };
}

/**
 * Patch Storage.prototype.setItem / removeItem / clear. Both localStorage and
 * sessionStorage share the same prototype, so one patch covers both — we
 * disambiguate at call time via `this === window.sessionStorage`.
 */
function patchStorageInstance(
    storage: Storage,
    kind: StorageEntry['which'],
    valueCap: number,
    emit: (entry: StorageEntry) => void,
): () => void {
    const origSet = storage.setItem.bind(storage);
    const origRemove = storage.removeItem.bind(storage);
    const origClear = storage.clear.bind(storage);

    Object.defineProperty(storage, 'setItem', {
        configurable: true, writable: true,
        value: (key: string, value: string) => {
            emit({ ts: Date.now(), op: 'set', which: kind, key, value: clip(value, valueCap), initiator: captureInitiator() });
            origSet(key, value);
        },
    });
    Object.defineProperty(storage, 'removeItem', {
        configurable: true, writable: true,
        value: (key: string) => {
            emit({ ts: Date.now(), op: 'remove', which: kind, key, initiator: captureInitiator() });
            origRemove(key);
        },
    });
    Object.defineProperty(storage, 'clear', {
        configurable: true, writable: true,
        value: () => {
            emit({ ts: Date.now(), op: 'clear', which: kind, initiator: captureInitiator() });
            origClear();
        },
    });
    return () => {
        // Restore by replacing the own properties with thin shims that
        // forward to the captured originals. `delete` doesn't reliably
        // expose the prototype method in every engine (happy-dom in
        // particular), so this is the safer reset.
        try {
            Object.defineProperty(storage, 'setItem', {
                configurable: true, writable: true,
                value: (k: string, v: string) => origSet(k, v),
            });
            Object.defineProperty(storage, 'removeItem', {
                configurable: true, writable: true,
                value: (k: string) => origRemove(k),
            });
            Object.defineProperty(storage, 'clear', {
                configurable: true, writable: true,
                value: () => origClear(),
            });
        } catch { /* ignore */ }
    };
}

function patchCookie(
    valueCap: number,
    emit: (entry: StorageEntry) => void,
): (() => void) | undefined {
    const descriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
    if (!descriptor || !descriptor.set || !descriptor.get) return undefined;
    const origSet = descriptor.set;
    const origGet = descriptor.get;

    Object.defineProperty(Document.prototype, 'cookie', {
        configurable: true,
        get(this: Document) {
            return origGet.call(this);
        },
        set(this: Document, val: string) {
            const initiator = captureInitiator();
            const { key, value, removed } = parseCookieAssignment(val);
            emit({
                ts: Date.now(),
                op: removed ? 'remove' : 'set',
                which: 'cookie',
                key,
                value: removed ? undefined : value !== undefined ? clip(value, valueCap) : undefined,
                initiator,
            });
            return origSet.call(this, val);
        },
    });

    return () => {
        Object.defineProperty(Document.prototype, 'cookie', descriptor);
    };
}

/**
 * Cookie writes look like "key=value; Path=/; Expires=...; Max-Age=0".
 * Treat Max-Age=0 or any past Expires as removal. Anything else is set.
 */
function parseCookieAssignment(raw: string): { key?: string; value?: string; removed: boolean } {
    const parts = raw.split(';');
    const head = (parts[0] ?? '').trim();
    const eq = head.indexOf('=');
    const key = eq >= 0 ? head.slice(0, eq) : head;
    const value = eq >= 0 ? head.slice(eq + 1) : undefined;
    let removed = false;
    for (let i = 1; i < parts.length; i++) {
        const seg = parts[i].trim();
        const lower = seg.toLowerCase();
        if (lower === 'max-age=0' || lower === 'max-age=-1') removed = true;
        if (lower.startsWith('expires=')) {
            const date = new Date(seg.slice('expires='.length).trim());
            if (!Number.isNaN(date.getTime()) && date.getTime() <= Date.now()) {
                removed = true;
            }
        }
    }
    return { key: key || undefined, value, removed };
}

function clip(s: string, cap: number): string {
    return s.length <= cap ? s : `${s.slice(0, cap)}…[+${s.length - cap}B]`;
}
