/**
 * Fetch channel — observe + intercept.
 *
 * Wraps `window.fetch` and threads each request through the install chain's
 * `fetch.onRequest` / `fetch.onResponse` hooks (in install order, async-aware).
 *
 * Failure mode: if patching fails, the channel stays uninstalled — original
 * fetch is untouched. Errors inside interceptors are caught and propagated
 * as a fall-through to the original fetch (the request is NOT silently lost).
 */

import type {
    FetchReqObservation,
    FetchResObservation,
    SandboxCtx,
} from '../types.js';
import { captureInitiator } from '../initiator.js';
import { emit, enterSandbox, exitSandbox, getChain, isInSandbox, registerPatch } from '../chain.js';

const DEFAULT_BODY_CAP = 256 * 1024;
const PATCHED_FLAG = '__hfeSandboxFetchPatched__';

function generateId(): string {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
    return `fetch_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function extractMeta(input: RequestInfo | URL, init?: RequestInit): {
    method: string;
    url: string;
    headers: Record<string, string>;
} {
    let url = '';
    let method = 'GET';
    let headers: Record<string, string> = {};

    if (typeof input === 'string') url = input;
    else if (input instanceof URL) url = input.toString();
    else if (input instanceof Request) {
        url = input.url;
        method = input.method;
        input.headers.forEach((v, k) => { headers[k] = v; });
    }

    if (init?.method) method = init.method;
    if (init?.headers) {
        const h = init.headers;
        if (h instanceof Headers) h.forEach((v, k) => { headers[k] = v; });
        else if (Array.isArray(h)) for (const [k, v] of h) headers[k] = v;
        else for (const k of Object.keys(h)) headers[k] = (h as Record<string, string>)[k];
    }
    return { method: method.toUpperCase(), url, headers };
}

async function runRequestChain(
    req: FetchReqObservation,
    ctx: SandboxCtx,
): Promise<FetchReqObservation | Response | false> {
    let current = req;
    for (const entry of getChain('fetch')) {
        const hook = entry.opts.fetch?.onRequest;
        if (!hook) continue;
        try {
            const result = await hook(current, ctx);
            if (result === false) return false;
            if (result instanceof Response) return result;
            if (result && typeof result === 'object') current = result as FetchReqObservation;
        } catch {
            // Interceptor errored — skip this layer, keep going.
        }
    }
    return current;
}

async function runResponseChain(
    res: Response,
    reqObs: FetchReqObservation,
    ctx: SandboxCtx,
): Promise<Response> {
    let current = res;
    for (const entry of getChain('fetch')) {
        const hook = entry.opts.fetch?.onResponse;
        if (!hook) continue;
        try {
            const next = await hook(current, reqObs, ctx);
            if (next instanceof Response) current = next;
        } catch { /* skip */ }
    }
    return current;
}

function installFetchPatch(): () => void {
    if (typeof window === 'undefined' || typeof window.fetch !== 'function') {
        return () => {};
    }
    const original = window.fetch;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((original as any)[PATCHED_FLAG]) return () => {};

    const patched = async function fetch(
        input: RequestInfo | URL,
        init?: RequestInit,
    ): Promise<Response> {
        // Re-entrant: interceptor / observer triggered another fetch → straight through.
        if (isInSandbox()) return original.call(window, input as RequestInfo, init);
        // selfUrls denylist (any install opts that set selfUrls should skip)
        const meta = extractMeta(input, init);
        for (const entry of getChain('fetch')) {
            const sus = entry.opts.selfUrls ?? [];
            if (sus.some((u) => meta.url.startsWith(u))) {
                return original.call(window, input as RequestInfo, init);
            }
        }
        enterSandbox();
        try {

        const id = generateId();
        const ts = Date.now();
        const initiator = captureInitiator();
        const reqObs: FetchReqObservation = {
            id,
            method: meta.method,
            url: meta.url,
            headers: meta.headers,
        };
        const ctx: SandboxCtx = { channel: 'fetch', kind: 'req', initiator, ts };

        // Emit observation pre-interceptor — observers see what the user sent.
        emit('fetch', { ts, source: 'fetch', kind: 'req', data: reqObs, initiator });

        // Run onRequest chain.
        const reqResult = await runRequestChain(reqObs, ctx);
        if (reqResult === false) {
            return new Response(null, { status: 0, statusText: 'sandbox aborted' });
        }
        if (reqResult instanceof Response) {
            // Short-circuited — emit synthetic res observation.
            emit('fetch', {
                ts: Date.now(), source: 'fetch', kind: 'res',
                data: { id, method: meta.method, url: meta.url, status: reqResult.status },
                initiator,
            });
            return reqResult;
        }

        // Apply any rewrites done by interceptors before calling native.
        const start = performance.now();
        let response: Response;
        try {
            // If interceptors changed url/method/headers/body, rebuild init.
            const finalInit: RequestInit = { ...(init ?? {}) };
            if (reqResult.method !== meta.method) finalInit.method = reqResult.method;
            if (reqResult.headers !== meta.headers) finalInit.headers = reqResult.headers;
            const finalInput = reqResult.url !== meta.url ? reqResult.url : input;
            response = await original.call(window, finalInput as RequestInfo, finalInit);
        } catch (err) {
            const resObs: FetchResObservation = {
                id, method: meta.method, url: meta.url,
                error: err instanceof Error ? err.message : String(err),
                durationMs: performance.now() - start,
            };
            emit('fetch', { ts: Date.now(), source: 'fetch', kind: 'res', data: resObs, initiator });
            throw err;
        }

        // Run onResponse chain.
        const finalRes = await runResponseChain(response, reqObs, ctx);

        emit('fetch', {
            ts: Date.now(), source: 'fetch', kind: 'res',
            data: {
                id, method: meta.method, url: meta.url,
                status: finalRes.status,
                durationMs: performance.now() - start,
            },
            initiator,
        });

        return finalRes;
        } finally {
            exitSandbox();
        }
    };

    try {
        Object.defineProperty(patched, 'name', { value: 'fetch' });
        Object.defineProperty(patched, 'length', { value: original.length });
        Object.defineProperty(patched, 'toString', { value: () => original.toString() });
    } catch { /* skip */ }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (patched as any)[PATCHED_FLAG] = true;

    window.fetch = patched as typeof fetch;
    return () => {
        if (window.fetch === (patched as typeof fetch)) {
            window.fetch = original;
        }
    };
}

// Expose so capture.ts in runtime-client can know body cap when adapting events.
export const FETCH_DEFAULT_BODY_CAP = DEFAULT_BODY_CAP;

registerPatch('fetch', installFetchPatch);
