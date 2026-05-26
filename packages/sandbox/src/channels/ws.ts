/**
 * WebSocket channel — observe + intercept.
 *
 * Key improvements over the original `wsPatch.ts` from runtime-client:
 *   1. `new.target` check: calling `WebSocket(...)` without `new` throws
 *      TypeError, matching native behavior.
 *   2. **prototype.send is patched** (not per-instance own property), so
 *      `WebSocket.prototype.send.call(ws, data)` ALSO goes through interceptors.
 *      Closes red-list #12.
 *   3. onConstruct / onSend / onMessage / onClose interceptor hooks.
 *
 * Graceful: native ws if patching fails, no error propagation.
 */

import type { SandboxCtx, WsObservation } from '../types.js';
import { captureInitiator } from '../initiator.js';
import { emit, enterSandbox, exitSandbox, getChain, isInSandbox, registerPatch } from '../chain.js';

const DEFAULT_BODY_CAP = 256 * 1024;
const PATCHED_FLAG = '__hfeSandboxWsPatched__';
const INSTANCE_ID = '__hfeSandboxWsId__';

function generateId(): string {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
    return `ws_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function serializeFrame(data: unknown, cap: number): { payload?: unknown; truncated: boolean } {
    if (typeof data === 'string') {
        if (data.length <= cap) {
            const trimmed = data.trim();
            const first = trimmed[0];
            if (first === '{' || first === '[' || first === '"') {
                try { return { payload: JSON.parse(trimmed), truncated: false }; }
                catch { /* fall through */ }
            }
            return { payload: data, truncated: false };
        }
        return { payload: data.slice(0, cap), truncated: true };
    }
    if (data instanceof ArrayBuffer) return { payload: `[binary ArrayBuffer ${data.byteLength}B]`, truncated: false };
    if (typeof Blob !== 'undefined' && data instanceof Blob) return { payload: `[binary Blob ${data.size}B]`, truncated: false };
    if (ArrayBuffer.isView(data)) {
        const v = data as ArrayBufferView;
        return { payload: `[binary ${v.constructor.name} ${v.byteLength}B]`, truncated: false };
    }
    return { payload: undefined, truncated: false };
}

interface PatchedWs extends WebSocket {
    [INSTANCE_ID]?: string;
}

function installWsPatch(): () => void {
    if (typeof window === 'undefined' || typeof window.WebSocket !== 'function') {
        return () => {};
    }
    const OriginalWS = window.WebSocket;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((OriginalWS as any)[PATCHED_FLAG]) return () => {};

    // Body cap is currently the lib default; per-install opts could override later.
    const bodyCap = DEFAULT_BODY_CAP;

    const Patched = function PatchedWebSocket(
        this: PatchedWs,
        url: string | URL,
        protocols?: string | string[],
    ): WebSocket {
        // 1. Enforce `new`-only construction (red list #13).
        if (!new.target) {
            throw new TypeError(
                "Failed to construct 'WebSocket': Please use the 'new' operator, this DOM object constructor cannot be called as a function.",
            );
        }

        const urlStr = typeof url === 'string' ? url : url.toString();
        const protoList = Array.isArray(protocols)
            ? protocols
            : typeof protocols === 'string'
                ? [protocols]
                : undefined;

        // selfUrls denylist
        for (const entry of getChain('ws')) {
            const sus = entry.opts.selfUrls ?? [];
            if (sus.some((u) => urlStr.startsWith(u))) {
                return protocols !== undefined ? new OriginalWS(url, protocols) : new OriginalWS(url);
            }
        }

        const ts = Date.now();
        const initiator = captureInitiator();
        const ctx: SandboxCtx = { channel: 'ws', kind: 'open', initiator, ts };

        // onConstruct chain — can rewrite url/protocols or block.
        let finalUrl = urlStr;
        let finalProtocols = protoList;
        let blocked = false;
        for (const entry of getChain('ws')) {
            const hook = entry.opts.ws?.onConstruct;
            if (!hook) continue;
            try {
                const r = hook(finalUrl, finalProtocols, ctx);
                if (r === false) { blocked = true; break; }
                if (r && typeof r === 'object') {
                    if (typeof r.url === 'string') finalUrl = r.url;
                    if (r.protocols) finalProtocols = r.protocols;
                }
            } catch { /* skip */ }
        }

        if (blocked) {
            // We cannot truly "not construct" — return a closed stub.
            // Simplest approach: construct then immediately close.
            const stub = finalProtocols !== undefined
                ? new OriginalWS(finalUrl, finalProtocols)
                : new OriginalWS(finalUrl);
            try { stub.close(); } catch { /* ignore */ }
            return stub;
        }

        const ws = finalProtocols !== undefined
            ? new OriginalWS(finalUrl, finalProtocols)
            : new OriginalWS(finalUrl);

        const id = generateId();
        (ws as PatchedWs)[INSTANCE_ID] = id;

        emit('ws', {
            ts, source: 'ws', kind: 'open',
            data: { id, phase: 'open', url: finalUrl, protocols: finalProtocols },
            initiator,
        });

        ws.addEventListener('message', (ev: MessageEvent) => {
            try {
                const incoming = ev.data;
                const { payload, truncated } = serializeFrame(incoming, bodyCap);

                // onMessage chain
                let current: unknown = payload;
                let drop = false;
                for (const entry of getChain('ws')) {
                    const hook = entry.opts.ws?.onMessage;
                    if (!hook) continue;
                    try {
                        const r = hook(current, id, { channel: 'ws', kind: 'recv', initiator: captureInitiator(), ts: Date.now() });
                        if (r === false) { drop = true; break; }
                        if (r !== undefined) current = r;
                    } catch { /* skip */ }
                }
                if (drop) return;

                emit('ws', {
                    ts: Date.now(), source: 'ws', kind: 'recv',
                    data: {
                        id, phase: 'recv', url: finalUrl,
                        payload: current,
                        payloadTruncated: truncated || undefined,
                    },
                });
            } catch { /* swallow */ }
        });

        ws.addEventListener('close', (ev: CloseEvent) => {
            try {
                for (const entry of getChain('ws')) {
                    const hook = entry.opts.ws?.onClose;
                    if (!hook) continue;
                    try { hook(ev.code, ev.reason || undefined, id, { channel: 'ws', kind: 'close', initiator: captureInitiator(), ts: Date.now() }); }
                    catch { /* skip */ }
                }
                emit('ws', {
                    ts: Date.now(), source: 'ws', kind: 'close',
                    data: {
                        id, phase: 'close', url: finalUrl,
                        code: ev.code, reason: ev.reason || undefined, wasClean: ev.wasClean,
                    },
                });
            } catch { /* swallow */ }
        });

        return ws;
    } as unknown as typeof WebSocket;

    // Preserve constructor surface so `instanceof` / library detection still works.
    Patched.prototype = OriginalWS.prototype;
    for (const key of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'] as const) {
        try {
            Object.defineProperty(Patched, key, {
                value: OriginalWS[key], writable: false, configurable: true,
            });
        } catch { /* readonly already, ignore */ }
    }
    try { Object.defineProperty(Patched, 'name', { value: 'WebSocket' }); } catch { /* ignore */ }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (Patched as any)[PATCHED_FLAG] = true;

    // ★ Patch WebSocket.prototype.send so `Storage.prototype.send.call(ws, data)` style
    // also goes through interceptors (red list #12).
    const origProtoSend = OriginalWS.prototype.send;
    const patchedProtoSend = function send(this: PatchedWs, data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
        // Re-entrant call (e.g. interceptor wrote back to this WS) → straight through.
        if (isInSandbox()) return origProtoSend.call(this, data);
        // Denylisted instances never get an INSTANCE_ID — they bypassed the
        // wrapping path entirely at construction. Skip prototype-level
        // observation too, otherwise the daemon connection's sends get
        // captured (defeats selfUrls).
        if (!this[INSTANCE_ID]) return origProtoSend.call(this, data);
        enterSandbox();
        const id = this[INSTANCE_ID];
        const initiator = captureInitiator();
        try {
            const { payload, truncated } = serializeFrame(data, bodyCap);

            // onSend chain
            let current: unknown = payload;
            let drop = false;
            for (const entry of getChain('ws')) {
                const hook = entry.opts.ws?.onSend;
                if (!hook) continue;
                try {
                    const r = hook(current, id, { channel: 'ws', kind: 'send', initiator, ts: Date.now() });
                    if (r === false) { drop = true; break; }
                    if (r !== undefined) current = r;
                } catch { /* skip */ }
            }

            if (drop) {
                emit('ws', {
                    ts: Date.now(), source: 'ws', kind: 'send',
                    data: { id, phase: 'send', url: this.url ?? '', payload: '[dropped by interceptor]' },
                    initiator,
                });
                return;
            }

            emit('ws', {
                ts: Date.now(), source: 'ws', kind: 'send',
                data: {
                    id, phase: 'send', url: this.url ?? '',
                    payload: current,
                    payloadTruncated: truncated || undefined,
                },
                initiator,
            });

            // If interceptor rewrote payload to a string, we send that. Otherwise pass original `data`.
            const toSend = (typeof current === 'string' && current !== data) ? current : data;
            return origProtoSend.call(this, toSend as string | ArrayBufferLike | Blob | ArrayBufferView);
        } catch {
            // Anything goes wrong in our wrapper → pass through to original send to preserve business behavior.
            return origProtoSend.call(this, data);
        } finally {
            exitSandbox();
        }
    } as typeof origProtoSend;

    try {
        OriginalWS.prototype.send = patchedProtoSend;
    } catch { /* couldn't patch — degrade silently */ }

    window.WebSocket = Patched;

    return () => {
        try {
            if (window.WebSocket === Patched) window.WebSocket = OriginalWS;
            OriginalWS.prototype.send = origProtoSend;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            delete (OriginalWS as any)[PATCHED_FLAG];
        } catch { /* ignore */ }
    };
}

registerPatch('ws', installWsPatch);
