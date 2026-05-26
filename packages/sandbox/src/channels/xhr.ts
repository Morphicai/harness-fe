/**
 * XHR channel — observe + intercept.
 *
 * Wraps `XMLHttpRequest.prototype.open` to capture method+url, and
 * `XMLHttpRequest.prototype.send` to thread through the install chain's
 * `xhr.onRequest` hook (sync only — XHR send is sync).
 *
 * Response observation fires on `loadend`. `xhr.onResponse` mutators run there.
 *
 * Graceful: if patching fails, falls back to original XHR cleanly.
 */

import type {
    SandboxCtx,
    XhrReqObservation,
    XhrResObservation,
} from '../types.js';
import { captureInitiator } from '../initiator.js';
import { emit, enterSandbox, exitSandbox, getChain, isInSandbox, registerPatch } from '../chain.js';

const META_KEY = '__hfeSandboxXhrMeta__';
const PATCHED_FLAG = '__hfeSandboxXhrPatched__';

interface XhrMeta {
    id: string;
    method: string;
    url: string;
    headers: Record<string, string>;
    initiator: ReturnType<typeof captureInitiator>;
}

interface PatchedXhr extends XMLHttpRequest {
    [META_KEY]?: XhrMeta;
}

function generateId(): string {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
    return `xhr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function installXhrPatch(): () => void {
    if (typeof XMLHttpRequest === 'undefined') return () => {};
    const proto = XMLHttpRequest.prototype;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((proto as any)[PATCHED_FLAG]) return () => {};

    const origOpen = proto.open;
    const origSetHeader = proto.setRequestHeader;
    const origSend = proto.send;

    const patchedOpen = function open(this: PatchedXhr, method: string, url: string | URL): void {
        try {
            this[META_KEY] = {
                id: generateId(),
                method: method.toUpperCase(),
                url: typeof url === 'string' ? url : url.toString(),
                headers: {},
                initiator: captureInitiator(),
            };
        } catch { /* leave meta unset; downstream patch becomes pass-through */ }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return origOpen.apply(this, arguments as any);
    } as typeof proto.open;

    const patchedSetHeader = function setRequestHeader(this: PatchedXhr, name: string, value: string): void {
        try {
            const meta = this[META_KEY];
            if (meta) meta.headers[name.toLowerCase()] = String(value);
        } catch { /* skip */ }
        return origSetHeader.call(this, name, value);
    } as typeof proto.setRequestHeader;

    const patchedSend = function send(this: PatchedXhr, body?: Document | XMLHttpRequestBodyInit | null): void {
        const meta = this[META_KEY];
        if (!meta) return origSend.call(this, body ?? null);
        if (isInSandbox()) return origSend.call(this, body ?? null);
        enterSandbox();
        try {

        const reqObs: XhrReqObservation = {
            id: meta.id,
            method: meta.method,
            url: meta.url,
            headers: meta.headers,
        };
        const ctx: SandboxCtx = {
            channel: 'xhr', kind: 'req', initiator: meta.initiator, ts: Date.now(),
        };

        // selfUrls denylist
        for (const entry of getChain('xhr')) {
            const sus = entry.opts.selfUrls ?? [];
            if (sus.some((u) => meta.url.startsWith(u))) {
                return origSend.call(this, body ?? null);
            }
        }

        // Synchronous onRequest chain — XHR send doesn't await.
        let current = reqObs;
        let blocked = false;
        for (const entry of getChain('xhr')) {
            const hook = entry.opts.xhr?.onRequest;
            if (!hook) continue;
            try {
                const result = hook(current, ctx);
                // Async result on XHR is best-effort — not awaited (xhr.send is sync).
                if (result instanceof Promise) continue;
                if (result === false) { blocked = true; break; }
                if (result && typeof result === 'object') current = result;
            } catch { /* skip */ }
        }

        emit('xhr', { ts: ctx.ts, source: 'xhr', kind: 'req', data: current, initiator: meta.initiator });

        if (blocked) {
            // We can't truly abort send() once it's running, so we just emit
            // an aborted res observation and call abort. Best-effort.
            try { this.abort(); } catch { /* ignore */ }
            return;
        }

        // Listen for completion to emit res observation + run onResponse chain.
        const onLoadEnd = (): void => {
            try {
                this.removeEventListener('loadend', onLoadEnd);
                let resObs: XhrResObservation = {
                    id: meta.id,
                    method: meta.method,
                    url: meta.url,
                    status: this.status,
                };
                for (const entry of getChain('xhr')) {
                    const hook = entry.opts.xhr?.onResponse;
                    if (!hook) continue;
                    try {
                        const r = hook(resObs, ctx);
                        if (r && typeof r === 'object') resObs = r;
                    } catch { /* skip */ }
                }
                emit('xhr', {
                    ts: Date.now(), source: 'xhr', kind: 'res',
                    data: resObs, initiator: meta.initiator,
                });
            } catch { /* swallow */ }
        };
        this.addEventListener('loadend', onLoadEnd);

        return origSend.call(this, body ?? null);
        } finally {
            exitSandbox();
        }
    } as typeof proto.send;

    try {
        proto.open = patchedOpen;
        proto.setRequestHeader = patchedSetHeader;
        proto.send = patchedSend;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (proto as any)[PATCHED_FLAG] = true;
    } catch {
        // Couldn't patch — restore any partial changes.
        proto.open = origOpen;
        proto.setRequestHeader = origSetHeader;
        proto.send = origSend;
        return () => {};
    }

    return () => {
        try {
            proto.open = origOpen;
            proto.setRequestHeader = origSetHeader;
            proto.send = origSend;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            delete (proto as any)[PATCHED_FLAG];
        } catch { /* ignore */ }
    };
}

registerPatch('xhr', installXhrPatch);
