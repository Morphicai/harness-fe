/**
 * XMLHttpRequest monkey-patch — captures URL/method/headers/body for
 * request and response WITHOUT replacing the XMLHttpRequest constructor.
 *
 * The previous implementation wrapped `window.XMLHttpRequest` with a new
 * constructor, which broke `xhr instanceof XMLHttpRequest` checks in
 * business code. This patch attaches per-instance metadata via a
 * non-enumerable Symbol key and overrides only prototype methods, leaving
 * the constructor and prototype chain native.
 *
 * Capture rules mirror fetchPatch.ts:
 *  - 256 KB body cap with content-type routing (json / text / binary)
 *  - Sensitive header redaction (Authorization / Cookie / x-api-key / x-auth-*)
 *  - Two events per request keyed by a shared `id` (`phase: 'req' | 'res'`)
 *  - Errors inside capture are swallowed via `safeEmit`
 *  - `__hfeInternal` opt-out via a magic header `x-hfe-internal: 1`
 *    (XHR has no init-style options bag like fetch)
 *  - Idempotent install + dispose() restores original prototype methods
 */

import type { NetworkEntry } from '@harness-fe/protocol';
import { captureInitiator } from './initiator.js';

const DEFAULT_BODY_CAP = 256 * 1024;
const PATCHED_FLAG = '__hfeXhrPatched';
const META_KEY = Symbol.for('@harness-fe/xhr-meta');
const INTERNAL_HEADER = 'x-hfe-internal';
const SENSITIVE_HEADER = /^(authorization|cookie|x-api-key|x-auth-.+)$/i;

export interface XhrPatchOptions {
    onEntry: (entry: NetworkEntry) => void;
    bodyCap?: number;
    denylist?: RegExp[];
}

interface XhrMeta {
    id: string;
    method: string;
    url: string;
    headers: Record<string, string>;
    startedAt: number;
    startedTs: number;
    bodyCap: number;
    internal: boolean;
    skipped: boolean;
    reqEmitted: boolean;
}

interface PatchedXhr extends XMLHttpRequest {
    [META_KEY]?: XhrMeta;
}

export function installXhrPatch(opts: XhrPatchOptions): () => void {
    if (typeof XMLHttpRequest === 'undefined') return () => {};
    const proto = XMLHttpRequest.prototype as XMLHttpRequest & Record<string, unknown>;
    if ((proto as Record<string, unknown>)[PATCHED_FLAG]) return () => {};

    const bodyCap = opts.bodyCap ?? DEFAULT_BODY_CAP;
    const denylist = opts.denylist ?? [];
    const emit = (entry: NetworkEntry): void => safeEmit(opts.onEntry, entry);

    const origOpen = proto.open;
    const origSetHeader = proto.setRequestHeader;
    const origSend = proto.send;

    const patchedOpen = function open(
        this: PatchedXhr,
        method: string,
        url: string | URL,
        ...rest: unknown[]
    ): void {
        const meta: XhrMeta = {
            id: generateId(),
            method,
            url: typeof url === 'string' ? url : url.toString(),
            headers: {},
            startedAt: 0,
            startedTs: 0,
            bodyCap,
            internal: false,
            skipped: denylist.some((re) => re.test(typeof url === 'string' ? url : url.toString())),
            reqEmitted: false,
        };
        this[META_KEY] = meta;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (origOpen as any).call(this, method, url, ...rest);
    } as typeof proto.open;

    const patchedSetHeader = function setRequestHeader(
        this: PatchedXhr,
        name: string,
        value: string,
    ): void {
        const meta = this[META_KEY];
        if (meta) {
            if (name.toLowerCase() === INTERNAL_HEADER) {
                meta.internal = true;
            } else {
                meta.headers[name] = value;
            }
        }
        // Do NOT forward the internal sentinel to the server.
        if (name.toLowerCase() === INTERNAL_HEADER) return;
        return origSetHeader.call(this, name, value);
    } as typeof proto.setRequestHeader;

    const patchedSend = function send(
        this: PatchedXhr,
        body?: Document | XMLHttpRequestBodyInit | null,
    ): void {
        const meta = this[META_KEY];
        if (!meta || meta.internal || meta.skipped) {
            return origSend.call(this, body ?? null);
        }
        meta.startedAt = performance.now();
        meta.startedTs = Date.now();
        const initiator = captureInitiator();

        // Emit req eagerly with headers; body added on second emit after
        // serialization (mirrors fetchPatch behavior).
        const reqRecord: NetworkEntry = {
            ts: meta.startedTs,
            id: meta.id,
            phase: 'req',
            method: meta.method,
            url: meta.url,
            requestHeaders: redactHeaders(meta.headers),
            initiator,
        };
        emit(reqRecord);
        meta.reqEmitted = true;

        const serialized = serializeBody(body, meta.bodyCap);
        if (serialized.body !== undefined || serialized.truncated) {
            emit({
                ...reqRecord,
                requestBody: serialized.body,
                requestBodyTruncated: serialized.truncated || undefined,
            });
        }

        this.addEventListener('loadend', () => {
            const status = this.status;
            const ct = safeGetResponseHeader(this, 'content-type') ?? '';
            const respHeaders = parseAllResponseHeaders(this);
            const isErr = status === 0;
            const baseRes: NetworkEntry = {
                ts: Date.now(),
                id: meta.id,
                phase: 'res',
                method: meta.method,
                url: meta.url,
                status: isErr ? undefined : status,
                responseHeaders: respHeaders,
                durationMs: performance.now() - meta.startedAt,
            };
            if (isErr) {
                emit({ ...baseRes, error: 'xhr error or aborted' });
                return;
            }
            if (isTextLike(ct)) {
                const text = safeReadResponseText(this);
                if (text === undefined) {
                    emit(baseRes);
                    return;
                }
                const capped = capText(text, meta.bodyCap);
                emit({
                    ...baseRes,
                    responseBody: /json/i.test(ct) ? safeParseJson(capped.body) : capped.body,
                    responseBodyTruncated: capped.truncated || undefined,
                });
            } else {
                // Binary or unknown → don't pull bytes, just record size when available.
                const len = Number(safeGetResponseHeader(this, 'content-length') ?? '0') || 0;
                emit({
                    ...baseRes,
                    responseBody: len ? `[binary ${len}B]` : '[binary]',
                });
            }
        });

        return origSend.call(this, body ?? null);
    } as typeof proto.send;

    proto.open = patchedOpen;
    proto.setRequestHeader = patchedSetHeader;
    proto.send = patchedSend;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (proto as any)[PATCHED_FLAG] = true;

    return () => {
        // Only restore if we still own the patch — don't clobber a later patch.
        if (proto.open !== patchedOpen) return;
        proto.open = origOpen;
        proto.setRequestHeader = origSetHeader;
        proto.send = origSend;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        delete (proto as any)[PATCHED_FLAG];
    };
}

// ─── helpers ────────────────────────────────────────────────────────────────

function generateId(): string {
    try {
        return crypto.randomUUID();
    } catch {
        return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    }
}

function redactHeaders(h: Record<string, string>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(h)) {
        out[k] = SENSITIVE_HEADER.test(k) ? `[redacted ${String(v).length}]` : v;
    }
    return out;
}

function serializeBody(
    body: Document | XMLHttpRequestBodyInit | null | undefined,
    cap: number,
): { body?: unknown; truncated: boolean } {
    if (body === undefined || body === null) return { truncated: false };
    if (typeof body === 'string') return capText(body, cap);
    if (typeof FormData !== 'undefined' && body instanceof FormData) {
        const obj: Record<string, unknown> = {};
        body.forEach((v, k) => {
            obj[k] = typeof v === 'string'
                ? v
                : `[File ${(v as File).name} ${(v as File).size}B]`;
        });
        return { body: obj, truncated: false };
    }
    if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) {
        return { body: body.toString(), truncated: false };
    }
    if (typeof Blob !== 'undefined' && body instanceof Blob) {
        return { body: `[Blob ${body.size}B]`, truncated: false };
    }
    if (body instanceof ArrayBuffer) {
        return { body: `[ArrayBuffer ${body.byteLength}B]`, truncated: false };
    }
    if (ArrayBuffer.isView(body)) {
        return {
            body: `[${(body.constructor as { name: string }).name} ${body.byteLength}B]`,
            truncated: false,
        };
    }
    if (typeof Document !== 'undefined' && body instanceof Document) {
        return { body: '[Document]', truncated: false };
    }
    return { body: '[unknown body]', truncated: false };
}

function capText(text: string, cap: number): { body: string; truncated: boolean } {
    if (text.length > cap) return { body: text.slice(0, cap), truncated: true };
    return { body: text, truncated: false };
}

function safeGetResponseHeader(xhr: XMLHttpRequest, name: string): string | null {
    try {
        return xhr.getResponseHeader(name);
    } catch {
        return null;
    }
}

function parseAllResponseHeaders(xhr: XMLHttpRequest): Record<string, string> | undefined {
    let raw: string;
    try {
        raw = xhr.getAllResponseHeaders();
    } catch {
        return undefined;
    }
    if (!raw) return undefined;
    const out: Record<string, string> = {};
    for (const line of raw.split('\r\n')) {
        const idx = line.indexOf(':');
        if (idx < 0) continue;
        const k = line.slice(0, idx).trim();
        const v = line.slice(idx + 1).trim();
        if (k) out[k] = v;
    }
    return Object.keys(out).length ? redactHeaders(out) : undefined;
}

function safeReadResponseText(xhr: XMLHttpRequest): string | undefined {
    try {
        // responseType must be '' or 'text' to access responseText.
        if (xhr.responseType !== '' && xhr.responseType !== 'text') return undefined;
        return xhr.responseText;
    } catch {
        return undefined;
    }
}

function safeParseJson(text: string): unknown {
    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
}

function isTextLike(ct: string): boolean {
    return /json|text|xml|javascript|x-www-form-urlencoded/i.test(ct);
}

function safeEmit(fn: (entry: NetworkEntry) => void, entry: NetworkEntry): void {
    try {
        fn(entry);
    } catch {
        /* swallow */
    }
}
