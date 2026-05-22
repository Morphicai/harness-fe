// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installXhrPatch } from './xhrPatch.js';
import type { NetworkEntry } from '@harness-fe/protocol';

let entries: NetworkEntry[];
let dispose: () => void;

beforeEach(() => {
    entries = [];
});

afterEach(() => {
    dispose?.();
});

/** Drive a single XHR using a synthetic loadend (no network in happy-dom). */
function driveXhr(opts: {
    method?: string;
    url?: string;
    headers?: Record<string, string>;
    body?: XMLHttpRequestBodyInit | null;
    status?: number;
    responseText?: string;
    responseHeaders?: string;
}): XMLHttpRequest {
    const xhr = new XMLHttpRequest();
    xhr.open(opts.method ?? 'GET', opts.url ?? 'http://x/');
    for (const [k, v] of Object.entries(opts.headers ?? {})) {
        xhr.setRequestHeader(k, v);
    }
    // Stub response-shape methods before send so the loadend handler reads them.
    Object.defineProperty(xhr, 'status', { value: opts.status ?? 200, configurable: true });
    Object.defineProperty(xhr, 'responseText', {
        value: opts.responseText ?? '',
        configurable: true,
    });
    Object.defineProperty(xhr, 'responseType', { value: '', configurable: true });
    const headerLines = opts.responseHeaders ?? 'content-type: application/json';
    xhr.getResponseHeader = (name: string) => {
        const lower = name.toLowerCase();
        for (const line of headerLines.split('\r\n')) {
            const idx = line.indexOf(':');
            if (idx < 0) continue;
            if (line.slice(0, idx).trim().toLowerCase() === lower) {
                return line.slice(idx + 1).trim();
            }
        }
        return null;
    };
    xhr.getAllResponseHeaders = () => headerLines;
    xhr.send(opts.body ?? null);
    // Fire loadend synthetically.
    xhr.dispatchEvent(new Event('loadend'));
    return xhr;
}

describe('installXhrPatch — identity', () => {
    it('preserves `instanceof XMLHttpRequest` after install', () => {
        dispose = installXhrPatch({ onEntry: (e) => entries.push(e) });
        const xhr = new XMLHttpRequest();
        expect(xhr).toBeInstanceOf(XMLHttpRequest);
    });

    it('dispose restores original prototype methods', () => {
        const origOpen = XMLHttpRequest.prototype.open;
        const origSend = XMLHttpRequest.prototype.send;
        dispose = installXhrPatch({ onEntry: (e) => entries.push(e) });
        expect(XMLHttpRequest.prototype.open).not.toBe(origOpen);
        dispose();
        dispose = () => {};
        expect(XMLHttpRequest.prototype.open).toBe(origOpen);
        expect(XMLHttpRequest.prototype.send).toBe(origSend);
    });

    it('re-install while patched is a no-op', () => {
        const d1 = installXhrPatch({ onEntry: (e) => entries.push(e) });
        const patchedOpen = XMLHttpRequest.prototype.open;
        const d2 = installXhrPatch({ onEntry: (e) => entries.push(e) });
        expect(XMLHttpRequest.prototype.open).toBe(patchedOpen);
        d2();
        d1();
    });
});

describe('installXhrPatch — emission', () => {
    it('emits req then res for a JSON GET', () => {
        dispose = installXhrPatch({ onEntry: (e) => entries.push(e) });
        driveXhr({ method: 'GET', responseText: '{"ok":true}' });
        const phases = entries.map((e) => e.phase);
        expect(phases).toContain('req');
        expect(phases).toContain('res');
        const res = entries.find((e) => e.phase === 'res')!;
        expect(res.status).toBe(200);
        expect(res.responseBody).toEqual({ ok: true });
    });

    it('serializes string body and emits with req record', () => {
        dispose = installXhrPatch({ onEntry: (e) => entries.push(e) });
        driveXhr({ method: 'POST', body: '{"x":1}', responseText: 'ok' });
        const reqWithBody = entries.find((e) => e.phase === 'req' && e.requestBody !== undefined)!;
        expect(reqWithBody.requestBody).toBe('{"x":1}');
    });

    it('caps response body at bodyCap', () => {
        const long = 'a'.repeat(2000);
        dispose = installXhrPatch({ onEntry: (e) => entries.push(e), bodyCap: 500 });
        driveXhr({
            responseText: long,
            responseHeaders: 'content-type: text/plain',
        });
        const res = entries.find((e) => e.phase === 'res')!;
        expect(res.responseBodyTruncated).toBe(true);
        expect((res.responseBody as string).length).toBe(500);
    });

    it('redacts sensitive request headers', () => {
        dispose = installXhrPatch({ onEntry: (e) => entries.push(e) });
        driveXhr({
            method: 'POST',
            headers: {
                Authorization: 'Bearer xyz',
                'x-api-key': 'sk-123',
                'content-type': 'application/json',
            },
            body: '{}',
            responseText: '{}',
        });
        const req = entries.find((e) => e.phase === 'req')!;
        expect(req.requestHeaders!.Authorization).toMatch(/^\[redacted \d+\]$/);
        expect(req.requestHeaders!['x-api-key']).toMatch(/^\[redacted \d+\]$/);
        expect(req.requestHeaders!['content-type']).toBe('application/json');
    });

    it('emits res with error field when status is 0', () => {
        dispose = installXhrPatch({ onEntry: (e) => entries.push(e) });
        driveXhr({ status: 0 });
        const res = entries.find((e) => e.phase === 'res')!;
        expect(res.error).toBeDefined();
        expect(res.status).toBeUndefined();
    });

    it('skips capture entirely when x-hfe-internal header is set', () => {
        dispose = installXhrPatch({ onEntry: (e) => entries.push(e) });
        driveXhr({
            method: 'GET',
            headers: { 'x-hfe-internal': '1' },
            responseText: '{}',
        });
        expect(entries).toHaveLength(0);
    });

    it('records binary response only as a size placeholder', () => {
        dispose = installXhrPatch({ onEntry: (e) => entries.push(e) });
        driveXhr({
            responseHeaders: 'content-type: application/octet-stream\r\ncontent-length: 1234',
            responseText: '',
        });
        const res = entries.find((e) => e.phase === 'res')!;
        expect(res.responseBody).toBe('[binary 1234B]');
    });

    it('keeps native loadend listeners firing', () => {
        dispose = installXhrPatch({ onEntry: (e) => entries.push(e) });
        let userCalled = false;
        const xhr = new XMLHttpRequest();
        xhr.addEventListener('loadend', () => {
            userCalled = true;
        });
        xhr.open('GET', 'http://x/');
        Object.defineProperty(xhr, 'status', { value: 200, configurable: true });
        Object.defineProperty(xhr, 'responseText', { value: 'ok', configurable: true });
        Object.defineProperty(xhr, 'responseType', { value: '', configurable: true });
        xhr.getAllResponseHeaders = () => 'content-type: text/plain';
        xhr.getResponseHeader = () => 'text/plain';
        xhr.send(null);
        xhr.dispatchEvent(new Event('loadend'));
        expect(userCalled).toBe(true);
    });

    it('does not let an onEntry throw crash xhr.send', () => {
        dispose = installXhrPatch({
            onEntry: () => {
                throw new Error('boom');
            },
        });
        expect(() =>
            driveXhr({ responseText: 'ok', responseHeaders: 'content-type: text/plain' }),
        ).not.toThrow();
    });
});
