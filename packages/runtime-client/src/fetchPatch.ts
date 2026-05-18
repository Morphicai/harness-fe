/**
 * fetch monkey-patch — captures URL/method/headers/body for request and
 * response, including streaming SSE responses, without changing
 * business-observable fetch behavior.
 *
 * Safety contract (do not weaken without updating the spec):
 *  1. Identity-preserving: replacement is a named `fetch`, with
 *     defineProperty'd name/length/toString so library fingerprint checks
 *     still pass. Response / Request instances are NOT wrapped.
 *  2. Error-isolated: capture failures are swallowed via `safeEmit`; they
 *     NEVER propagate to business code.
 *  3. No timing or value change: the original Promise is returned to the
 *     caller unchanged. body capture reads `response.clone()` on a side
 *     branch — the business path retains an untouched stream.
 *  4. Self-traffic guard: requests carrying `init.__hfeInternal === true`
 *     short-circuit to the original fetch. A URL denylist also skips HMR /
 *     dev-server traffic to prevent capture feedback loops.
 *  5. Bounded memory: bodies are capped at BODY_CAP per request. SSE
 *     streams stop accumulating and `cancel()` the cloned reader once
 *     the cap is hit.
 *
 * The patch is idempotent (re-install is a no-op) and returns a dispose
 * function that restores the original `window.fetch`.
 */

import type { NetworkEntry } from '@harnessa-fe/protocol';

const DEFAULT_BODY_CAP = 256 * 1024;
const INTERNAL_FLAG = '__hfeInternal';
const PATCHED_FLAG = '__hfePatched';
const DEFAULT_DENYLIST: RegExp[] = [/\/__hfe\//, /sockjs-node/, /\.hot-update\./];
const SENSITIVE_HEADER = /^(authorization|cookie|x-api-key|x-auth-.+)$/i;

export interface FetchPatchOptions {
    /** Called once for each emitted record (request and response are separate calls). */
    onEntry: (entry: NetworkEntry) => void;
    /** Per-body byte cap. Default 256 KB. */
    bodyCap?: number;
    /** URL patterns to skip capture entirely. */
    denylist?: RegExp[];
}

/**
 * Install the fetch patch. Returns a dispose function that restores the
 * original window.fetch. Safe to call multiple times (subsequent calls
 * are no-ops while a patch is active).
 */
export function installFetchPatch(opts: FetchPatchOptions): () => void {
    if (typeof window === 'undefined' || typeof window.fetch !== 'function') {
        return () => {};
    }
    const original = window.fetch;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((original as any)[PATCHED_FLAG]) return () => {};

    const bodyCap = opts.bodyCap ?? DEFAULT_BODY_CAP;
    const denylist = opts.denylist ?? DEFAULT_DENYLIST;
    const emit = (entry: NetworkEntry): void => safeEmit(opts.onEntry, entry);

    // Named function so .name === 'fetch'.
    const patched = function fetch(
        this: typeof globalThis,
        input: RequestInfo | URL,
        init?: RequestInit,
    ): Promise<Response> {
        // Self-traffic short-circuit — internal requests bypass capture.
        if (init && (init as Record<string, unknown>)[INTERNAL_FLAG]) {
            return original.call(this, input as RequestInfo, init);
        }

        const meta = extractRequestMeta(input, init);
        if (denylist.some((re) => re.test(meta.url))) {
            return original.call(this, input as RequestInfo, init);
        }

        const id = generateId();
        const startedAt = performance.now();
        const startedTs = Date.now();

        // Emit request record eagerly (req body is read async — second emit
        // updates the record once body is serialized; consumers join by id).
        const reqRecord: NetworkEntry = {
            ts: startedTs,
            id,
            phase: 'req',
            method: meta.method,
            url: meta.url,
            requestHeaders: meta.headers,
        };
        emit(reqRecord);
        cloneRequestBody(input, init, bodyCap).then(
            ({ body, truncated }) => {
                if (body === undefined && !truncated) return;
                emit({
                    ...reqRecord,
                    requestBody: body,
                    requestBodyTruncated: truncated || undefined,
                });
            },
            () => {
                /* serialization error — ignore, req already emitted */
            },
        );

        const promise = original.call(this, input as RequestInfo, init);

        promise.then(
            (response) => {
                let cloned: Response | undefined;
                try {
                    cloned = response.clone();
                } catch {
                    emit({
                        ts: Date.now(),
                        id,
                        phase: 'res',
                        method: meta.method,
                        url: meta.url,
                        status: response.status,
                        responseHeaders: headersToObject(response.headers),
                        durationMs: performance.now() - startedAt,
                    });
                    return;
                }
                const finalize = (body: unknown, truncated: boolean): void => {
                    emit({
                        ts: Date.now(),
                        id,
                        phase: 'res',
                        method: meta.method,
                        url: meta.url,
                        status: response.status,
                        responseHeaders: headersToObject(response.headers),
                        responseBody: body,
                        responseBodyTruncated: truncated || undefined,
                        durationMs: performance.now() - startedAt,
                    });
                };

                const ct = response.headers.get('content-type') ?? '';
                if (isSSE(ct)) {
                    pumpSSE(cloned, bodyCap, finalize);
                } else if (isTextLike(ct)) {
                    readTextWithCap(cloned, bodyCap).then(
                        ({ body, truncated }) =>
                            finalize(maybeParseJson(body, ct), truncated),
                        () => finalize(undefined, false),
                    );
                } else {
                    // Binary or unknown: only record size, do not pull bytes.
                    cloned.arrayBuffer().then(
                        (buf) => finalize(`[binary ${buf.byteLength}B]`, false),
                        () => finalize(undefined, false),
                    );
                }
            },
            (err: unknown) => {
                emit({
                    ts: Date.now(),
                    id,
                    phase: 'res',
                    method: meta.method,
                    url: meta.url,
                    durationMs: performance.now() - startedAt,
                    error: err instanceof Error ? err.message : String(err),
                });
            },
        );

        return promise;
    };

    // Preserve fingerprint — library detection commonly inspects these.
    try {
        Object.defineProperty(patched, 'name', { value: 'fetch' });
        Object.defineProperty(patched, 'length', { value: original.length });
        Object.defineProperty(patched, 'toString', {
            value: () => original.toString(),
        });
    } catch {
        /* sealed property — safe to skip */
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (patched as any)[PATCHED_FLAG] = true;

    window.fetch = patched as typeof fetch;
    return () => {
        if (window.fetch === (patched as typeof fetch)) {
            window.fetch = original;
        }
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

interface RequestMeta {
    url: string;
    method: string;
    headers?: Record<string, string>;
}

function extractRequestMeta(input: RequestInfo | URL, init?: RequestInit): RequestMeta {
    let url: string;
    let method = 'GET';
    let headers: Record<string, string> | undefined;

    if (typeof input === 'string') {
        url = input;
    } else if (input instanceof URL) {
        url = input.toString();
    } else {
        url = input.url;
        method = input.method;
        headers = headersToObject(input.headers);
    }
    if (init?.method) method = init.method;
    if (init?.headers) {
        headers = { ...(headers ?? {}), ...(headersToObject(init.headers) ?? {}) };
    }
    return { url, method, headers };
}

function headersToObject(
    h: HeadersInit | Headers | undefined,
): Record<string, string> | undefined {
    if (!h) return undefined;
    const out: Record<string, string> = {};
    if (h instanceof Headers) {
        h.forEach((v, k) => {
            out[k] = v;
        });
    } else if (Array.isArray(h)) {
        for (const [k, v] of h) out[k] = v;
    } else {
        Object.assign(out, h);
    }
    return redactHeaders(out);
}

function redactHeaders(h: Record<string, string>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(h)) {
        out[k] = SENSITIVE_HEADER.test(k) ? `[redacted ${String(v).length}]` : v;
    }
    return out;
}

async function cloneRequestBody(
    input: RequestInfo | URL,
    init: RequestInit | undefined,
    cap: number,
): Promise<{ body?: unknown; truncated: boolean }> {
    if (init?.body !== undefined && init.body !== null) {
        return serializeBodyInit(init.body, cap);
    }
    if (input instanceof Request && input.body) {
        try {
            const text = await input.clone().text();
            return capText(text, cap);
        } catch {
            return { truncated: false };
        }
    }
    return { truncated: false };
}

function serializeBodyInit(
    body: BodyInit,
    cap: number,
): { body?: unknown; truncated: boolean } {
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
        return { body: `[${(body.constructor as { name: string }).name} ${body.byteLength}B]`, truncated: false };
    }
    return { body: '[unknown body]', truncated: false };
}

function capText(text: string, cap: number): { body: string; truncated: boolean } {
    if (text.length > cap) return { body: text.slice(0, cap), truncated: true };
    return { body: text, truncated: false };
}

async function readTextWithCap(
    res: Response,
    cap: number,
): Promise<{ body: string; truncated: boolean }> {
    const text = await res.text();
    return capText(text, cap);
}

function maybeParseJson(text: string, contentType: string): unknown {
    if (!/json/i.test(contentType)) return text;
    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
}

function isSSE(ct: string): boolean {
    return /text\/event-stream/i.test(ct);
}

function isTextLike(ct: string): boolean {
    return /json|text|xml|javascript|x-www-form-urlencoded/i.test(ct);
}

function pumpSSE(
    res: Response,
    cap: number,
    done: (body: string, truncated: boolean) => void,
): void {
    if (!res.body || typeof res.body.getReader !== 'function') {
        return done('', false);
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let total = '';
    let truncated = false;
    const step = (): void => {
        reader.read().then(
            ({ done: end, value }) => {
                if (end) return done(total, truncated);
                total += dec.decode(value, { stream: true });
                if (total.length > cap) {
                    total = total.slice(0, cap);
                    truncated = true;
                    reader.cancel().catch(() => {});
                    return done(total, truncated);
                }
                step();
            },
            () => done(total, truncated),
        );
    };
    step();
}

function safeEmit(fn: (entry: NetworkEntry) => void, entry: NetworkEntry): void {
    try {
        fn(entry);
    } catch {
        /* swallow — capture must not break business */
    }
}
