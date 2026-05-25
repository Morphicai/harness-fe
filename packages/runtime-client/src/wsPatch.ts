/**
 * WebSocket monkey-patch — captures open / send / recv / close frames so
 * agents can see long-lived push channels (IM, presence, sync, kick-out).
 *
 * Safety contract (mirrors fetchPatch):
 *  1. Identity-preserving: replacement is a constructor with the same name,
 *     prototype, and CONNECTING/OPEN/CLOSING/CLOSED static fields. Existing
 *     `instanceof WebSocket` checks still pass because we extend the original.
 *  2. Error-isolated: capture failures swallowed via safeEmit.
 *  3. No timing or value change: pass-through to native WebSocket; we only
 *     observe events and call sites. The original Promise / data flow is
 *     untouched.
 *  4. Bounded memory: frame payloads capped at BODY_CAP per send/recv. Binary
 *     frames record a `[binary Nb]` marker rather than the bytes.
 *
 * The patch is idempotent. Returns a dispose function that restores
 * `window.WebSocket`.
 */

import type { WsEntry } from '@harness-fe/protocol';
import { captureInitiator } from './initiator.js';

const DEFAULT_BODY_CAP = 256 * 1024;
const PATCHED_FLAG = '__hfeWsPatched';

export interface WsPatchOptions {
    onEntry: (entry: WsEntry) => void;
    bodyCap?: number;
    /** URL patterns to skip entirely. Default skips daemon traffic. */
    denylist?: RegExp[];
}

const DEFAULT_DENYLIST: RegExp[] = [/\/__hfe\//, /sockjs-node/];

export function installWsPatch(opts: WsPatchOptions): () => void {
    if (typeof window === 'undefined' || typeof window.WebSocket !== 'function') {
        return () => {};
    }
    const OriginalWS = window.WebSocket;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((OriginalWS as any)[PATCHED_FLAG]) return () => {};

    const bodyCap = opts.bodyCap ?? DEFAULT_BODY_CAP;
    const denylist = opts.denylist ?? DEFAULT_DENYLIST;
    const emit = (entry: WsEntry): void => {
        try {
            opts.onEntry(entry);
        } catch {
            /* swallow */
        }
    };

    const Patched = function PatchedWebSocket(
        this: WebSocket,
        url: string | URL,
        protocols?: string | string[],
    ): WebSocket {
        const urlStr = typeof url === 'string' ? url : url.toString();
        const ws = protocols !== undefined
            ? new OriginalWS(url, protocols)
            : new OriginalWS(url);

        if (denylist.some((re) => re.test(urlStr))) return ws;

        const id = generateId();
        const protoList = Array.isArray(protocols)
            ? protocols
            : typeof protocols === 'string'
                ? [protocols]
                : undefined;
        const openInitiator = captureInitiator();

        emit({
            ts: Date.now(),
            id,
            phase: 'open',
            url: urlStr,
            protocols: protoList,
            initiator: openInitiator,
        });

        ws.addEventListener('message', (ev: MessageEvent) => {
            const { payload, truncated } = serializeFrame(ev.data, bodyCap);
            emit({
                ts: Date.now(),
                id,
                phase: 'recv',
                url: urlStr,
                payload,
                payloadTruncated: truncated || undefined,
            });
        });

        ws.addEventListener('close', (ev: CloseEvent) => {
            emit({
                ts: Date.now(),
                id,
                phase: 'close',
                url: urlStr,
                code: ev.code,
                reason: ev.reason || undefined,
                wasClean: ev.wasClean,
            });
        });

        // Wrap `send` on this instance so we record outgoing payloads + caller.
        const origSend = ws.send.bind(ws);
        ws.send = function patchedSend(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
            const initiator = captureInitiator();
            const { payload, truncated } = serializeFrame(data, bodyCap);
            emit({
                ts: Date.now(),
                id,
                phase: 'send',
                url: urlStr,
                payload,
                payloadTruncated: truncated || undefined,
                initiator,
            });
            return origSend(data);
        };

        return ws;
    } as unknown as typeof WebSocket;

    // Preserve constructor surface so library detection still works.
    Patched.prototype = OriginalWS.prototype;
    for (const key of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'] as const) {
        try {
            Object.defineProperty(Patched, key, {
                value: OriginalWS[key],
                writable: false,
                configurable: true,
            });
        } catch {
            /* readonly already — ignore */
        }
    }
    try {
        Object.defineProperty(Patched, 'name', { value: 'WebSocket' });
    } catch {
        /* ignore */
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (Patched as any)[PATCHED_FLAG] = true;

    window.WebSocket = Patched;

    return () => {
        if (window.WebSocket === Patched) {
            window.WebSocket = OriginalWS;
        }
    };
}

function generateId(): string {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
        return crypto.randomUUID();
    }
    return `ws_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function serializeFrame(
    data: unknown,
    cap: number,
): { payload?: unknown; truncated: boolean } {
    if (typeof data === 'string') {
        if (data.length <= cap) {
            // Try JSON for structured payloads.
            const parsed = tryJson(data);
            return { payload: parsed !== undefined ? parsed : data, truncated: false };
        }
        return { payload: data.slice(0, cap), truncated: true };
    }
    if (data instanceof ArrayBuffer) {
        return { payload: `[binary ArrayBuffer ${data.byteLength}B]`, truncated: false };
    }
    if (typeof Blob !== 'undefined' && data instanceof Blob) {
        return { payload: `[binary Blob ${data.size}B]`, truncated: false };
    }
    if (ArrayBuffer.isView(data)) {
        const view = data as ArrayBufferView;
        return { payload: `[binary ${view.constructor.name} ${view.byteLength}B]`, truncated: false };
    }
    return { payload: undefined, truncated: false };
}

function tryJson(s: string): unknown {
    const trimmed = s.trim();
    if (!trimmed) return undefined;
    const first = trimmed[0];
    if (first !== '{' && first !== '[' && first !== '"') return undefined;
    try {
        return JSON.parse(trimmed);
    } catch {
        return undefined;
    }
}
