// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installFetchPatch } from './fetchPatch.js';
import type { NetworkEntry } from '@morphixai/harnessa-fe.protocol';

// happy-dom installs `window.fetch` via Node's undici. We override with a
// controllable mock per test so we can shape the Response exactly.

let originalFetch: typeof globalThis.fetch;
let entries: NetworkEntry[];
let dispose: () => void;

function setMockFetch(impl: typeof globalThis.fetch): void {
    window.fetch = impl as typeof window.fetch;
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
    return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
        ...init,
    });
}

function sseStream(chunks: string[]): ReadableStream<Uint8Array> {
    const enc = new TextEncoder();
    let i = 0;
    return new ReadableStream({
        pull(controller) {
            if (i < chunks.length) {
                controller.enqueue(enc.encode(chunks[i++]));
            } else {
                controller.close();
            }
        },
    });
}

beforeEach(() => {
    originalFetch = window.fetch;
    entries = [];
});

afterEach(() => {
    dispose?.();
    window.fetch = originalFetch;
});

describe('installFetchPatch — identity', () => {
    it('keeps fetch.name === "fetch"', () => {
        setMockFetch(() => Promise.resolve(new Response('ok')));
        dispose = installFetchPatch({ onEntry: (e) => entries.push(e) });
        expect(window.fetch.name).toBe('fetch');
    });

    it('returns the original Response without wrapping', async () => {
        const original = new Response('hello', { status: 201 });
        setMockFetch(() => Promise.resolve(original));
        dispose = installFetchPatch({ onEntry: (e) => entries.push(e) });
        const got = await window.fetch('http://x/');
        // business reads the body — capture must not have stolen it
        await expect(got.text()).resolves.toBe('hello');
        expect(got.status).toBe(201);
    });

    it('dispose restores window.fetch', () => {
        const mock: typeof globalThis.fetch = () => Promise.resolve(new Response());
        setMockFetch(mock);
        dispose = installFetchPatch({ onEntry: (e) => entries.push(e) });
        expect(window.fetch).not.toBe(mock);
        dispose();
        dispose = () => {};
        expect(window.fetch).toBe(mock);
    });

    it('re-install while patched is a no-op', () => {
        setMockFetch(() => Promise.resolve(new Response()));
        const d1 = installFetchPatch({ onEntry: (e) => entries.push(e) });
        const first = window.fetch;
        const d2 = installFetchPatch({ onEntry: (e) => entries.push(e) });
        expect(window.fetch).toBe(first);
        d2(); // no-op
        d1();
    });
});

describe('installFetchPatch — emission', () => {
    it('emits a req event eagerly and a res event after completion', async () => {
        setMockFetch(() => Promise.resolve(jsonResponse({ ok: true })));
        dispose = installFetchPatch({ onEntry: (e) => entries.push(e) });
        await window.fetch('http://x/', { method: 'POST', body: '{"k":1}' });
        // give the body-clone branch a chance to flush
        await new Promise((r) => setTimeout(r, 10));
        const ids = new Set(entries.map((e) => e.id));
        expect(ids.size).toBe(1);
        const phases = entries.map((e) => e.phase);
        expect(phases).toContain('req');
        expect(phases).toContain('res');
        const res = entries.find((e) => e.phase === 'res')!;
        expect(res.status).toBe(200);
        expect(res.responseBody).toEqual({ ok: true });
    });

    it('captures and caps a large JSON response body', async () => {
        const huge = 'x'.repeat(2000);
        setMockFetch(() => Promise.resolve(jsonResponse({ s: huge })));
        dispose = installFetchPatch({
            onEntry: (e) => entries.push(e),
            bodyCap: 500,
        });
        await window.fetch('http://x/');
        await new Promise((r) => setTimeout(r, 10));
        const res = entries.find((e) => e.phase === 'res')!;
        expect(res.responseBodyTruncated).toBe(true);
        // body is the raw truncated text when JSON.parse fails
        expect(typeof res.responseBody).toBe('string');
    });

    it('redacts sensitive request headers', async () => {
        setMockFetch(() => Promise.resolve(new Response('ok')));
        dispose = installFetchPatch({ onEntry: (e) => entries.push(e) });
        await window.fetch('http://x/', {
            method: 'POST',
            headers: {
                Authorization: 'Bearer abc.def.ghi',
                'X-Api-Key': 'sk-12345',
                'content-type': 'text/plain',
            },
            body: 'hi',
        });
        await new Promise((r) => setTimeout(r, 10));
        const req = entries.find((e) => e.phase === 'req' && e.requestHeaders)!;
        expect(req.requestHeaders!.Authorization).toMatch(/^\[redacted \d+\]$/);
        expect(req.requestHeaders!['X-Api-Key']).toMatch(/^\[redacted \d+\]$/);
        // non-sensitive header is preserved
        expect(req.requestHeaders!['content-type']).toBe('text/plain');
    });

    it('emits res with error field when underlying fetch rejects', async () => {
        setMockFetch(() => Promise.reject(new Error('network down')));
        dispose = installFetchPatch({ onEntry: (e) => entries.push(e) });
        await expect(window.fetch('http://x/')).rejects.toThrow('network down');
        await new Promise((r) => setTimeout(r, 10));
        const res = entries.find((e) => e.phase === 'res')!;
        expect(res.error).toBe('network down');
        expect(res.status).toBeUndefined();
    });

    it('caps an SSE stream and cancels the cloned reader', async () => {
        const longChunk = 'data: ' + 'x'.repeat(2000) + '\n\n';
        setMockFetch(() =>
            Promise.resolve(
                new Response(sseStream([longChunk, longChunk, longChunk]), {
                    status: 200,
                    headers: { 'content-type': 'text/event-stream' },
                }),
            ),
        );
        dispose = installFetchPatch({
            onEntry: (e) => entries.push(e),
            bodyCap: 500,
        });
        const res = await window.fetch('http://x/');
        // business can still read its own stream
        await res.text();
        await new Promise((r) => setTimeout(r, 30));
        const captured = entries.find((e) => e.phase === 'res')!;
        expect(captured.responseBodyTruncated).toBe(true);
        expect((captured.responseBody as string).length).toBe(500);
    });

    it('skips internal traffic when __hfeInternal flag is set', async () => {
        setMockFetch(() => Promise.resolve(new Response('ok')));
        dispose = installFetchPatch({ onEntry: (e) => entries.push(e) });
        await window.fetch('http://x/', {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ...({ __hfeInternal: true } as any),
        });
        await new Promise((r) => setTimeout(r, 10));
        expect(entries).toHaveLength(0);
    });

    it('skips denylisted URLs', async () => {
        setMockFetch(() => Promise.resolve(new Response('ok')));
        dispose = installFetchPatch({
            onEntry: (e) => entries.push(e),
            denylist: [/example/],
        });
        await window.fetch('http://example.com/__hfe__');
        await new Promise((r) => setTimeout(r, 10));
        expect(entries).toHaveLength(0);
    });

    it('does not let an onEntry throw crash business fetch', async () => {
        setMockFetch(() => Promise.resolve(new Response('ok')));
        dispose = installFetchPatch({
            onEntry: () => {
                throw new Error('boom');
            },
        });
        await expect(window.fetch('http://x/')).resolves.toBeInstanceOf(Response);
    });
});
