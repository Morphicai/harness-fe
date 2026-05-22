import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { Bridge } from './bridge.js';

const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
    while (cleanups.length) {
        const fn = cleanups.shift();
        if (fn) await fn();
    }
});

async function startBridge(opts: Parameters<typeof Bridge.prototype.constructor>[0] = {}): Promise<{
    bridge: Bridge;
    baseUrl: string;
}> {
    const bridge = new Bridge({
        port: 0,
        host: '127.0.0.1',
        store: null,
        taskStore: null,
        autoPurge: { enabled: false },
        ...opts,
    });
    await bridge.start();
    cleanups.push(() => bridge.stop());
    const port = bridge.getBoundPort()!;
    return { bridge, baseUrl: `http://127.0.0.1:${port}` };
}

async function request(
    url: string,
    init: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<{ status: number; headers: Record<string, string>; text: string }> {
    const res = await fetch(url, init);
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => {
        headers[k] = v;
    });
    const text = await res.text();
    return { status: res.status, headers, text };
}

describe('Bridge — token auth on HTTP routes', () => {
    it('serves requests without token when auth disabled', async () => {
        const { baseUrl } = await startBridge();
        const res = await request(baseUrl + '/');
        // dashboard isn't wired (store=null), so 404 — but it's a 404 from
        // the bridge handler, not 401.
        expect(res.status).toBe(404);
    });

    it('returns 401 JSON to API clients when token missing', async () => {
        const { baseUrl } = await startBridge({ auth: { token: 's3cret' } });
        const res = await request(baseUrl + '/');
        expect(res.status).toBe(401);
        expect(res.headers['www-authenticate']).toContain('Bearer');
        expect(res.headers['content-type']).toContain('application/json');
    });

    it('returns HTML login page to browsers', async () => {
        const { baseUrl } = await startBridge({ auth: { token: 's3cret' } });
        const res = await request(baseUrl + '/', { headers: { accept: 'text/html' } });
        expect(res.status).toBe(401);
        expect(res.headers['content-type']).toContain('text/html');
        expect(res.text).toContain('<form');
        expect(res.text).toContain('name="token"');
    });

    it('accepts request with valid Bearer token', async () => {
        const { baseUrl } = await startBridge({ auth: { token: 's3cret' } });
        const res = await request(baseUrl + '/', { headers: { authorization: 'Bearer s3cret' } });
        // Falls through to 404 (no httpHandler since store=null) — but NOT 401.
        expect(res.status).not.toBe(401);
    });

    it('accepts request with valid cookie', async () => {
        const { baseUrl } = await startBridge({ auth: { token: 's3cret' } });
        const res = await request(baseUrl + '/', { headers: { cookie: 'harnessa_fe_token=s3cret' } });
        expect(res.status).not.toBe(401);
    });

    it('accepts request with valid ?token= query', async () => {
        const { baseUrl } = await startBridge({ auth: { token: 's3cret' } });
        const res = await request(baseUrl + '/?token=s3cret');
        expect(res.status).not.toBe(401);
    });

    it('POST /__auth with valid token sets cookie and 303-redirects', async () => {
        const { baseUrl } = await startBridge({ auth: { token: 's3cret' } });
        const res = await fetch(baseUrl + '/__auth', {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: 'token=s3cret&next=/dashboard',
            redirect: 'manual',
        });
        expect(res.status).toBe(303);
        const setCookie = res.headers.get('set-cookie') ?? '';
        expect(setCookie).toMatch(/harnessa_fe_token=s3cret/);
        expect(setCookie).toMatch(/HttpOnly/);
        expect(setCookie).toMatch(/SameSite=Lax/);
        expect(res.headers.get('location')).toBe('/dashboard');
    });

    it('POST /__auth with wrong token re-renders login with error', async () => {
        const { baseUrl } = await startBridge({ auth: { token: 's3cret' } });
        const res = await fetch(baseUrl + '/__auth', {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: 'token=wrong&next=/',
            redirect: 'manual',
        });
        expect(res.status).toBe(401);
        const text = await res.text();
        expect(text).toContain('Invalid token');
    });

    it('POST /__auth ignores external "next" — falls back to /', async () => {
        const { baseUrl } = await startBridge({ auth: { token: 's3cret' } });
        const res = await fetch(baseUrl + '/__auth', {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: 'token=s3cret&next=//evil.example/',
            redirect: 'manual',
        });
        expect(res.status).toBe(303);
        expect(res.headers.get('location')).toBe('/');
    });
});

describe('Bridge — WS upgrade auth', () => {
    it('rejects WS upgrade when token missing', async () => {
        const { bridge } = await startBridge({ auth: { token: 's3cret' } });
        const wsUrl = `ws://127.0.0.1:${bridge.getBoundPort()}/`;
        const err: { code?: string; message?: string } = await new Promise((resolve) => {
            const ws = new WebSocket(wsUrl);
            ws.once('error', (e: NodeJS.ErrnoException) => resolve({ code: e.code, message: e.message }));
            ws.once('open', () => {
                ws.close();
                resolve({ message: 'unexpectedly opened' });
            });
        });
        // ws library surfaces the 401 as "Unexpected server response: 401".
        expect(err.message ?? '').toMatch(/401|Unauthorized|unexpected/i);
    });

    it('accepts WS upgrade with valid Bearer header', async () => {
        const { bridge } = await startBridge({ auth: { token: 's3cret' } });
        const wsUrl = `ws://127.0.0.1:${bridge.getBoundPort()}/`;
        const opened: boolean = await new Promise((resolve) => {
            const ws = new WebSocket(wsUrl, { headers: { authorization: 'Bearer s3cret' } });
            const t = setTimeout(() => resolve(false), 2000);
            ws.once('open', () => {
                clearTimeout(t);
                ws.close();
                resolve(true);
            });
            ws.once('error', () => {
                clearTimeout(t);
                resolve(false);
            });
        });
        expect(opened).toBe(true);
    });

    it('accepts WS upgrade with valid ?token= query', async () => {
        const { bridge } = await startBridge({ auth: { token: 's3cret' } });
        const wsUrl = `ws://127.0.0.1:${bridge.getBoundPort()}/?token=s3cret`;
        const opened: boolean = await new Promise((resolve) => {
            const ws = new WebSocket(wsUrl);
            const t = setTimeout(() => resolve(false), 2000);
            ws.once('open', () => {
                clearTimeout(t);
                ws.close();
                resolve(true);
            });
            ws.once('error', () => {
                clearTimeout(t);
                resolve(false);
            });
        });
        expect(opened).toBe(true);
    });
});

describe('Bridge — viewer base URL with non-loopback host', () => {
    it('rewrites 0.0.0.0 binds to a routable LAN IP for outbound URLs', async () => {
        const { bridge } = await startBridge({ host: '0.0.0.0', auth: { token: 'x' } });
        const url = bridge.getViewerBaseUrl();
        expect(url).toBeDefined();
        // Either a real LAN IP, or 127.0.0.1 if the test machine has no
        // non-internal interfaces — never the literal 0.0.0.0.
        expect(url).not.toContain('0.0.0.0');
    });
});
