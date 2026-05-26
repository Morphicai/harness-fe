/**
 * Navigation channel — observe + intercept browser navigation:
 *   - history.pushState / replaceState         (interceptable)
 *   - history.go / back / forward              (observable; cannot block)
 *   - popstate event                           (observable)
 *   - hashchange event                         (observable)
 *   - location.href setter                     (best-effort interceptable)
 *   - location.hash setter                     (best-effort interceptable)
 *   - location.assign() / location.replace()   (interceptable)
 *
 * Some location properties are unforgeable in real browsers — we degrade
 * gracefully when defineProperty refuses. Failure to patch ANY part still
 * leaves business behavior intact.
 */

import type { NavigationObservation, SandboxCtx } from '../types.js';
import { captureInitiator } from '../initiator.js';
import { emit, getChain, registerPatch } from '../chain.js';

function emitNav(kind: NavigationObservation['kind'], url: string | undefined, state?: unknown, replace?: boolean, initiator?: SandboxCtx['initiator']): void {
    const data: NavigationObservation = { kind, url, state, replace };
    emit('navigation', { ts: Date.now(), source: 'navigation', kind, data, initiator });
}

function runOnPush(url: string | undefined, state: unknown): { blocked: boolean; url: string | undefined; state: unknown } {
    const ctx: SandboxCtx = { channel: 'navigation', kind: 'push', initiator: captureInitiator(), ts: Date.now() };
    let cu = url, cs = state, blocked = false;
    for (const entry of getChain('navigation')) {
        const hook = entry.opts.navigation?.onPush;
        if (!hook) continue;
        try {
            const r = hook(cu, cs, ctx);
            if (r === false) { blocked = true; break; }
            if (r && typeof r === 'object') {
                if ('url' in r) cu = r.url;
                if ('state' in r) cs = r.state;
            }
        } catch { /* skip */ }
    }
    return { blocked, url: cu, state: cs };
}

function runOnReplace(url: string | undefined, state: unknown): { blocked: boolean; url: string | undefined; state: unknown } {
    const ctx: SandboxCtx = { channel: 'navigation', kind: 'replace', initiator: captureInitiator(), ts: Date.now() };
    let cu = url, cs = state, blocked = false;
    for (const entry of getChain('navigation')) {
        const hook = entry.opts.navigation?.onReplace;
        if (!hook) continue;
        try {
            const r = hook(cu, cs, ctx);
            if (r === false) { blocked = true; break; }
            if (r && typeof r === 'object') {
                if ('url' in r) cu = r.url;
                if ('state' in r) cs = r.state;
            }
        } catch { /* skip */ }
    }
    return { blocked, url: cu, state: cs };
}

function runOnAssign(url: string, replace: boolean): { blocked: boolean; url: string } {
    const ctx: SandboxCtx = { channel: 'navigation', kind: 'assign', initiator: captureInitiator(), ts: Date.now() };
    let cu = url, blocked = false;
    for (const entry of getChain('navigation')) {
        const hook = entry.opts.navigation?.onAssign;
        if (!hook) continue;
        try {
            const r = hook(cu, replace, ctx);
            if (r === false) { blocked = true; break; }
            if (typeof r === 'string') cu = r;
        } catch { /* skip */ }
    }
    return { blocked, url: cu };
}

function runOnHash(hash: string): { blocked: boolean; hash: string } {
    const ctx: SandboxCtx = { channel: 'navigation', kind: 'hash', initiator: captureInitiator(), ts: Date.now() };
    let ch = hash, blocked = false;
    for (const entry of getChain('navigation')) {
        const hook = entry.opts.navigation?.onHash;
        if (!hook) continue;
        try {
            const r = hook(ch, ctx);
            if (r === false) { blocked = true; break; }
            if (typeof r === 'string') ch = r;
        } catch { /* skip */ }
    }
    return { blocked, hash: ch };
}

function installNavigationPatch(): () => void {
    if (typeof window === 'undefined') return () => {};

    const restores: Array<() => void> = [];

    // history.pushState / replaceState — patch on prototype
    try {
        const origPush = History.prototype.pushState;
        const origReplace = History.prototype.replaceState;

        History.prototype.pushState = function patchedPush(this: History, state: unknown, _unused: string, url?: string | URL | null): void {
            try {
                const urlStr = url == null ? undefined : (typeof url === 'string' ? url : url.toString());
                const init = captureInitiator();
                const r = runOnPush(urlStr, state);
                emitNav('push', r.url, r.state, false, init);
                if (r.blocked) return;
                return origPush.call(this, r.state, _unused, r.url ?? null);
            } catch {
                return origPush.call(this, state, _unused, url ?? null);
            }
        };

        History.prototype.replaceState = function patchedReplace(this: History, state: unknown, _unused: string, url?: string | URL | null): void {
            try {
                const urlStr = url == null ? undefined : (typeof url === 'string' ? url : url.toString());
                const init = captureInitiator();
                const r = runOnReplace(urlStr, state);
                emitNav('replace', r.url, r.state, true, init);
                if (r.blocked) return;
                return origReplace.call(this, r.state, _unused, r.url ?? null);
            } catch {
                return origReplace.call(this, state, _unused, url ?? null);
            }
        };

        restores.push(() => {
            History.prototype.pushState = origPush;
            History.prototype.replaceState = origReplace;
        });
    } catch { /* skip */ }

    // popstate + hashchange — observe only
    try {
        const onPopState = (_e: PopStateEvent) => {
            try { emitNav('pop', typeof location !== 'undefined' ? location.href : undefined); }
            catch { /* skip */ }
        };
        const onHashChange = (_e: HashChangeEvent) => {
            try { emitNav('hash', typeof location !== 'undefined' ? location.hash : undefined); }
            catch { /* skip */ }
        };
        window.addEventListener('popstate', onPopState);
        window.addEventListener('hashchange', onHashChange);
        restores.push(() => {
            window.removeEventListener('popstate', onPopState);
            window.removeEventListener('hashchange', onHashChange);
        });
    } catch { /* skip */ }

    // location.href / location.hash setters + assign / replace methods.
    // window.location is unforgeable in real browsers — defineProperty may
    // refuse. We try, then degrade silently on failure (location navigation
    // simply isn't intercepted, but no error reaches business code).
    try {
        const loc = window.location;
        // Use Object.getOwnPropertyDescriptor on Location.prototype if exists,
        // else fall back to defineProperty on instance.
        const proto = Object.getPrototypeOf(loc) as Location | null;

        // href setter
        const hrefDesc =
            (proto && Object.getOwnPropertyDescriptor(proto, 'href')) ||
            Object.getOwnPropertyDescriptor(loc, 'href');
        if (hrefDesc?.set && hrefDesc?.get) {
            const origSet = hrefDesc.set;
            const origGet = hrefDesc.get;
            try {
                Object.defineProperty(loc, 'href', {
                    configurable: true,
                    get(this: Location) { return origGet.call(this); },
                    set(this: Location, val: string) {
                        try {
                            const init = captureInitiator();
                            const r = runOnAssign(String(val), false);
                            emitNav('assign', r.url, undefined, false, init);
                            if (r.blocked) return;
                            origSet.call(this, r.url);
                        } catch { origSet.call(this, val); }
                    },
                });
                restores.push(() => {
                    try { Object.defineProperty(loc, 'href', hrefDesc); }
                    catch { /* ignore */ }
                });
            } catch { /* skip if unforgeable */ }
        }

        // hash setter
        const hashDesc =
            (proto && Object.getOwnPropertyDescriptor(proto, 'hash')) ||
            Object.getOwnPropertyDescriptor(loc, 'hash');
        if (hashDesc?.set && hashDesc?.get) {
            const origSet = hashDesc.set;
            const origGet = hashDesc.get;
            try {
                Object.defineProperty(loc, 'hash', {
                    configurable: true,
                    get(this: Location) { return origGet.call(this); },
                    set(this: Location, val: string) {
                        try {
                            const init = captureInitiator();
                            const r = runOnHash(String(val));
                            emitNav('hash', r.hash, undefined, false, init);
                            if (r.blocked) return;
                            origSet.call(this, r.hash);
                        } catch { origSet.call(this, val); }
                    },
                });
                restores.push(() => {
                    try { Object.defineProperty(loc, 'hash', hashDesc); }
                    catch { /* ignore */ }
                });
            } catch { /* skip */ }
        }

        // assign / replace methods
        try {
            const origAssign = loc.assign?.bind(loc);
            const origReplaceFn = loc.replace?.bind(loc);
            if (typeof origAssign === 'function') {
                loc.assign = function patchedAssign(url: string | URL): void {
                    try {
                        const init = captureInitiator();
                        const urlStr = typeof url === 'string' ? url : url.toString();
                        const r = runOnAssign(urlStr, false);
                        emitNav('assign', r.url, undefined, false, init);
                        if (r.blocked) return;
                        origAssign(r.url);
                    } catch { origAssign(url); }
                };
                restores.push(() => { loc.assign = origAssign; });
            }
            if (typeof origReplaceFn === 'function') {
                loc.replace = function patchedReplace(url: string | URL): void {
                    try {
                        const init = captureInitiator();
                        const urlStr = typeof url === 'string' ? url : url.toString();
                        const r = runOnAssign(urlStr, true);
                        emitNav('assign', r.url, undefined, true, init);
                        if (r.blocked) return;
                        origReplaceFn(r.url);
                    } catch { origReplaceFn(url); }
                };
                restores.push(() => { loc.replace = origReplaceFn; });
            }
        } catch { /* skip */ }
    } catch { /* skip */ }

    return () => {
        for (let i = restores.length - 1; i >= 0; i--) {
            try { restores[i](); } catch { /* ignore */ }
        }
    };
}

registerPatch('navigation', installNavigationPatch);
