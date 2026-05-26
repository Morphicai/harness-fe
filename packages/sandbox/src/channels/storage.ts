/**
 * Storage channel — observe + intercept with TWO layers of protection:
 *
 *   1. **Proxy** wrapping localStorage / sessionStorage instances. Catches
 *      `proxy.setItem(k, v)`, `proxy.x = 'y'` (direct property assign), and
 *      preserves identity (proxy instanceof Storage, etc.).
 *
 *   2. **Storage.prototype.{setItem,removeItem,clear}** patched at the
 *      prototype level. Catches `Storage.prototype.setItem.call(anyone, ...)`
 *      style bypass that would otherwise skip the proxy entirely (red-list #11).
 *
 * Inside the wrappers, we always call the ORIGINAL prototype method bound to
 * the REAL storage instance (not the proxy) — this prevents the proxy set
 * trap from re-firing inside the native setItem implementation.
 *
 * Cookie: patched via Document.prototype.cookie descriptor when available.
 * Cross-tab: listened via window 'storage' event, observation-only.
 *
 * Graceful: every patch step in try/catch. If the engine refuses (e.g. some
 * embedded webviews lock Storage.prototype), the channel skips silently.
 */

import type { SandboxCtx, StorageObservation } from '../types.js';
import { captureInitiator } from '../initiator.js';
import { emit, getChain, registerPatch } from '../chain.js';

const VALUE_CAP = 4 * 1024;

function clip(s: string): string {
    return s.length <= VALUE_CAP ? s : `${s.slice(0, VALUE_CAP)}…[+${s.length - VALUE_CAP}B]`;
}

// Internal sentinel set on our installed objects so we can recognize them.
const PROXY_SENTINEL = '__hfeSandboxStorageProxy__';

function makeCtx(kind: StorageObservation['op']): SandboxCtx {
    return { channel: 'storage', kind, initiator: captureInitiator(), ts: Date.now() };
}

function runOnSet(
    key: string, value: string, which: StorageObservation['which'],
): { blocked: boolean; key: string; value: string; ctx: SandboxCtx } {
    const ctx = makeCtx('set');
    let finalKey = key, finalValue = value;
    let blocked = false;
    for (const entry of getChain('storage')) {
        const hook = entry.opts.storage?.onSet;
        if (!hook) continue;
        try {
            const r = hook(finalKey, finalValue, which, ctx);
            if (r === false) { blocked = true; break; }
            if (r && typeof r === 'object') {
                if (typeof r.key === 'string') finalKey = r.key;
                if (typeof r.value === 'string') finalValue = r.value;
            }
        } catch { /* skip */ }
    }
    return { blocked, key: finalKey, value: finalValue, ctx };
}

function runOnRemove(key: string, which: StorageObservation['which']): { blocked: boolean; ctx: SandboxCtx } {
    const ctx = makeCtx('remove');
    let blocked = false;
    for (const entry of getChain('storage')) {
        const hook = entry.opts.storage?.onRemove;
        if (!hook) continue;
        try { if (hook(key, which, ctx) === false) { blocked = true; break; } }
        catch { /* skip */ }
    }
    return { blocked, ctx };
}

function runOnClear(which: StorageObservation['which']): { blocked: boolean; ctx: SandboxCtx } {
    const ctx = makeCtx('clear');
    let blocked = false;
    for (const entry of getChain('storage')) {
        const hook = entry.opts.storage?.onClear;
        if (!hook) continue;
        try { if (hook(which, ctx) === false) { blocked = true; break; } }
        catch { /* skip */ }
    }
    return { blocked, ctx };
}

function runOnGet(key: string, which: StorageObservation['which']): string | null | undefined {
    const ctx = makeCtx('get');
    for (const entry of getChain('storage')) {
        const hook = entry.opts.storage?.onGet;
        if (!hook) continue;
        try {
            const r = hook(key, which, ctx);
            if (r !== undefined) return r;
        } catch { /* skip */ }
    }
    return undefined;
}

function emitStorage(op: StorageObservation['op'], which: StorageObservation['which'], key?: string, value?: string, crossTab?: boolean, initiator?: SandboxCtx['initiator']): void {
    const data: StorageObservation = { op, which, key, value, crossTab };
    emit('storage', { ts: Date.now(), source: 'storage', kind: op, data, initiator });
}

// ───────────────────────────────────────────────────────────────────
// Storage Proxy
// ───────────────────────────────────────────────────────────────────

function makeStorageProxy(real: Storage, which: StorageObservation['which']): Storage {
    // Original methods bound to the REAL target — used inside wrappers to
    // avoid the proxy set trap re-firing during native setItem.
    const origSet = Storage.prototype.setItem.bind(real);
    const origGet = Storage.prototype.getItem.bind(real);
    const origRemove = Storage.prototype.removeItem.bind(real);
    const origClear = Storage.prototype.clear.bind(real);
    const origKey = Storage.prototype.key.bind(real);

    const wrappedMethods = {
        setItem(key: string, value: string): void {
            const k = String(key), v = String(value);
            const { blocked, key: fk, value: fv, ctx } = runOnSet(k, v, which);
            emitStorage('set', which, fk, clip(fv), undefined, ctx.initiator);
            if (!blocked) origSet(fk, fv);
        },
        getItem(key: string): string | null {
            const k = String(key);
            const override = runOnGet(k, which);
            if (override !== undefined) return override;
            return origGet(k);
        },
        removeItem(key: string): void {
            const k = String(key);
            const { blocked, ctx } = runOnRemove(k, which);
            emitStorage('remove', which, k, undefined, undefined, ctx.initiator);
            if (!blocked) origRemove(k);
        },
        clear(): void {
            const { blocked, ctx } = runOnClear(which);
            emitStorage('clear', which, undefined, undefined, undefined, ctx.initiator);
            if (!blocked) origClear();
        },
        key(index: number): string | null {
            return origKey(index);
        },
    } as const;

    const proxy = new Proxy(real, {
        get(target, prop) {
            if (prop === PROXY_SENTINEL) return true;
            if (prop === 'setItem') return wrappedMethods.setItem;
            if (prop === 'getItem') return wrappedMethods.getItem;
            if (prop === 'removeItem') return wrappedMethods.removeItem;
            if (prop === 'clear') return wrappedMethods.clear;
            if (prop === 'key') return wrappedMethods.key;
            // length, [Symbol.toStringTag], constructor, etc — passthrough.
            // We don't bind here so reference equality (e.g. `constructor === Storage`)
            // holds. For Storage methods we already wrap above, so the only
            // remaining functions accessed via get are non-method values that
            // shouldn't be bound.
            return Reflect.get(target, prop, target);
        },
        set(target, prop, value) {
            if (typeof prop !== 'symbol') {
                const k = String(prop), v = String(value);
                const { blocked, key: fk, value: fv, ctx } = runOnSet(k, v, which);
                emitStorage('set', which, fk, clip(fv), undefined, ctx.initiator);
                if (blocked) return true;  // pretend success
                // Use origSet so we don't recurse through proxy.
                origSet(fk, fv);
                return true;
            }
            return Reflect.set(target, prop, value, target);
        },
        deleteProperty(target, prop) {
            if (typeof prop !== 'symbol') {
                const k = String(prop);
                const { blocked, ctx } = runOnRemove(k, which);
                emitStorage('remove', which, k, undefined, undefined, ctx.initiator);
                if (blocked) return true;
                origRemove(k);
                return true;
            }
            return Reflect.deleteProperty(target, prop);
        },
        // Default passthrough traps for has / ownKeys / getOwnPropertyDescriptor
        // / getPrototypeOf preserve native enumeration + identity semantics.
    });

    return proxy;
}

// ───────────────────────────────────────────────────────────────────
// Top-level installer
// ───────────────────────────────────────────────────────────────────

function installStoragePatch(): () => void {
    if (typeof window === 'undefined') return () => {};

    const restores: Array<() => void> = [];

    // 1. Proxy-wrap each Storage instance and replace the global getter.
    let realLocal: Storage | undefined;
    let proxyLocal: Storage | undefined;
    let realSession: Storage | undefined;
    let proxySession: Storage | undefined;

    try {
        realLocal = window.localStorage;
        proxyLocal = makeStorageProxy(realLocal, 'local');
        Object.defineProperty(window, 'localStorage', {
            configurable: true,
            get: () => proxyLocal,
        });
        restores.push(() => {
            Object.defineProperty(window, 'localStorage', {
                configurable: true, value: realLocal, writable: true,
            });
        });
    } catch { /* skip if engine refuses */ }

    try {
        realSession = window.sessionStorage;
        proxySession = makeStorageProxy(realSession, 'session');
        Object.defineProperty(window, 'sessionStorage', {
            configurable: true,
            get: () => proxySession,
        });
        restores.push(() => {
            Object.defineProperty(window, 'sessionStorage', {
                configurable: true, value: realSession, writable: true,
            });
        });
    } catch { /* skip */ }

    // 2. Patch Storage.prototype methods so .call() routes via interceptor too.
    //    Inside the patched methods, we identify "which" by comparing `this`
    //    against the real storages (NOT the proxies — Storage.prototype.X.call(proxy)
    //    has this=proxy, but we want to write to the underlying real storage).
    //
    //    Also: WebIDL-binding marks Storage.prototype methods enumerable=true. Native
    //    Storage has a special [[Enumerate]] hook so `for...in localStorage` hides
    //    them. With a Proxy we lose that hook and `for...in` walks the prototype,
    //    surfacing setItem/etc. Fix: defineProperty every Storage.prototype member
    //    as enumerable=false on install; restore descriptors on dispose.
    try {
        const protoMemberDescriptors = new Map<string | symbol, PropertyDescriptor>();
        for (const k of Reflect.ownKeys(Storage.prototype)) {
            if (k === 'constructor') continue;
            const desc = Object.getOwnPropertyDescriptor(Storage.prototype, k);
            if (!desc) continue;
            protoMemberDescriptors.set(k, desc);
            if (desc.enumerable && desc.configurable) {
                try {
                    Object.defineProperty(Storage.prototype, k, { ...desc, enumerable: false });
                } catch { /* skip member */ }
            }
        }
        restores.push(() => {
            for (const [k, desc] of protoMemberDescriptors) {
                try { Object.defineProperty(Storage.prototype, k, desc); }
                catch { /* ignore */ }
            }
        });

        const origProtoSet = Storage.prototype.setItem;
        const origProtoGet = Storage.prototype.getItem;
        const origProtoRemove = Storage.prototype.removeItem;
        const origProtoClear = Storage.prototype.clear;

        function whichOf(self: Storage | unknown): StorageObservation['which'] | null {
            if (self === realSession || self === proxySession) return 'session';
            if (self === realLocal || self === proxyLocal) return 'local';
            return null;
        }
        function realOf(which: StorageObservation['which']): Storage | undefined {
            return which === 'session' ? realSession : realLocal;
        }

        Storage.prototype.setItem = function patchedSet(this: Storage, key: string, value: string): void {
            const which = whichOf(this);
            if (!which) return origProtoSet.call(this, key, value);
            const k = String(key), v = String(value);
            const { blocked, key: fk, value: fv, ctx } = runOnSet(k, v, which);
            emitStorage('set', which, fk, clip(fv), undefined, ctx.initiator);
            if (!blocked) origProtoSet.call(realOf(which)!, fk, fv);
        };

        Storage.prototype.getItem = function patchedGet(this: Storage, key: string): string | null {
            const which = whichOf(this);
            if (!which) return origProtoGet.call(this, key);
            const override = runOnGet(String(key), which);
            if (override !== undefined) return override;
            return origProtoGet.call(realOf(which)!, key);
        };

        Storage.prototype.removeItem = function patchedRemove(this: Storage, key: string): void {
            const which = whichOf(this);
            if (!which) return origProtoRemove.call(this, key);
            const k = String(key);
            const { blocked, ctx } = runOnRemove(k, which);
            emitStorage('remove', which, k, undefined, undefined, ctx.initiator);
            if (!blocked) origProtoRemove.call(realOf(which)!, k);
        };

        Storage.prototype.clear = function patchedClear(this: Storage): void {
            const which = whichOf(this);
            if (!which) return origProtoClear.call(this);
            const { blocked, ctx } = runOnClear(which);
            emitStorage('clear', which, undefined, undefined, undefined, ctx.initiator);
            if (!blocked) origProtoClear.call(realOf(which)!);
        };

        restores.push(() => {
            Storage.prototype.setItem = origProtoSet;
            Storage.prototype.getItem = origProtoGet;
            Storage.prototype.removeItem = origProtoRemove;
            Storage.prototype.clear = origProtoClear;
        });
    } catch { /* prototype frozen or missing — skip */ }

    // 3. Cookie via Document.prototype descriptor.
    try {
        const descriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
        if (descriptor?.set && descriptor?.get) {
            const origSet = descriptor.set;
            const origGet = descriptor.get;
            Object.defineProperty(Document.prototype, 'cookie', {
                configurable: true,
                get(this: Document) { return origGet.call(this); },
                set(this: Document, val: string) {
                    try {
                        const { key, value, removed } = parseCookieAssignment(val);
                        const op = removed ? 'remove' : 'set';
                        const { blocked, key: fk, value: fv, ctx } = op === 'set'
                            ? runOnSet(key ?? '', value ?? '', 'cookie')
                            : (() => {
                                const r = runOnRemove(key ?? '', 'cookie');
                                return { blocked: r.blocked, key: key ?? '', value: undefined as unknown as string, ctx: r.ctx };
                            })();
                        emitStorage(op as StorageObservation['op'], 'cookie', fk, fv ? clip(fv) : undefined, undefined, ctx.initiator);
                        if (!blocked) origSet.call(this, val);
                    } catch { origSet.call(this, val); }
                },
            });
            restores.push(() => {
                Object.defineProperty(Document.prototype, 'cookie', descriptor);
            });
        }
    } catch { /* skip */ }

    // 4. Cross-tab events.
    try {
        const onStorageEvent = (ev: StorageEvent): void => {
            try {
                const which: StorageObservation['which'] = ev.storageArea === window.sessionStorage ? 'session' : 'local';
                const op: StorageObservation['op'] = ev.key === null ? 'clear' : ev.newValue === null ? 'remove' : 'set';
                emitStorage(op, which, ev.key ?? undefined, ev.newValue !== null ? clip(ev.newValue) : undefined, true);
            } catch { /* swallow */ }
        };
        window.addEventListener('storage', onStorageEvent);
        restores.push(() => window.removeEventListener('storage', onStorageEvent));
    } catch { /* skip */ }

    return () => {
        for (let i = restores.length - 1; i >= 0; i--) {
            try { restores[i](); } catch { /* ignore */ }
        }
    };
}

function parseCookieAssignment(raw: string): { key?: string; value?: string; removed: boolean } {
    const parts = raw.split(';');
    const head = (parts[0] ?? '').trim();
    const eq = head.indexOf('=');
    const key = eq >= 0 ? head.slice(0, eq) : head;
    const value = eq >= 0 ? head.slice(eq + 1) : undefined;
    let removed = false;
    for (let i = 1; i < parts.length; i++) {
        const seg = parts[i].trim().toLowerCase();
        if (seg === 'max-age=0' || seg === 'max-age=-1') removed = true;
        if (seg.startsWith('expires=')) {
            const date = new Date(seg.slice('expires='.length).trim());
            if (!Number.isNaN(date.getTime()) && date.getTime() <= Date.now()) removed = true;
        }
    }
    return { key: key || undefined, value, removed };
}

registerPatch('storage', installStoragePatch);
