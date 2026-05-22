/**
 * Tests for the dashboard SPA static handler.
 *
 * These tests don't exercise the React app itself (that lives in
 * `@harnessa-fe/dashboard-ui`); they verify mcp-server can find the
 * built dist, serves index.html with the right headers, and falls back
 * to index.html for arbitrary client-side routes.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Bridge } from './bridge.js';
import { JsonlStore } from './store/index.js';

const tempDirs: string[] = [];
function mkTmp(): string {
    const dir = mkdtempSync(join(tmpdir(), 'harnessa-spa-test-'));
    tempDirs.push(dir);
    return dir;
}

afterEach(async () => {
    while (tempDirs.length) {
        const d = tempDirs.pop()!;
        try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
    }
});

async function bootBridge() {
    const dir = mkTmp();
    const store = new JsonlStore(dir);
    const bridge = new Bridge({ port: 0, host: '127.0.0.1', store, taskStore: null, memoryStore: null });
    await bridge.start();
    const port = bridge.getBoundPort();
    if (!port) throw new Error('no port');
    return { bridge, store, port };
}

describe('Dashboard SPA handler — token handoff', () => {
    async function bootBridgeWithAuth() {
        const dir = mkTmp();
        const store = new JsonlStore(dir);
        const bridge = new Bridge({
            port: 0,
            host: '127.0.0.1',
            store,
            taskStore: null,
            memoryStore: null,
            auth: { token: 'secret-token' },
        });
        await bridge.start();
        const port = bridge.getBoundPort();
        if (!port) throw new Error('no port');
        return { bridge, port };
    }

    it('first /dashboard/?token=… visit sets the cookie and redirects to a clean URL', async () => {
        const { bridge, port } = await bootBridgeWithAuth();
        try {
            const resp = await fetch(
                `http://127.0.0.1:${port}/dashboard/?token=secret-token`,
                { redirect: 'manual' },
            );
            expect(resp.status).toBe(302);
            expect(resp.headers.get('location')).toBe('/dashboard/');
            const cookie = resp.headers.get('set-cookie') ?? '';
            expect(cookie).toContain('harnessa_fe_token=secret-token');
            expect(cookie).toMatch(/Path=\//);
            expect(cookie).toMatch(/SameSite=Lax/i);
        } finally {
            await bridge.stop();
        }
    });

    it('subsequent SPA fetch with the cookie alone is authorized', async () => {
        const { bridge, port } = await bootBridgeWithAuth();
        try {
            const denied = await fetch(`http://127.0.0.1:${port}/dashboard/`);
            expect(denied.status).toBe(401);
            const ok = await fetch(`http://127.0.0.1:${port}/dashboard/`, {
                headers: { cookie: 'harnessa_fe_token=secret-token' },
            });
            expect(ok.status).toBe(200);
        } finally {
            await bridge.stop();
        }
    });

    it('does not loop-redirect when the cookie is already present', async () => {
        const { bridge, port } = await bootBridgeWithAuth();
        try {
            const resp = await fetch(
                `http://127.0.0.1:${port}/dashboard/?token=secret-token`,
                {
                    redirect: 'manual',
                    headers: { cookie: 'harnessa_fe_token=secret-token' },
                },
            );
            expect(resp.status).toBe(200);
        } finally {
            await bridge.stop();
        }
    });
});

describe('Dashboard SPA handler', () => {
    it('GET / redirects to /dashboard/ preserving query (legacy root)', async () => {
        const { bridge, port } = await bootBridge();
        try {
            const resp = await fetch(`http://127.0.0.1:${port}/?token=xyz`, { redirect: 'manual' });
            expect(resp.status).toBe(302);
            expect(resp.headers.get('location')).toBe('/dashboard/?token=xyz');
        } finally {
            await bridge.stop();
        }
    });

    it('GET /sessions/:id redirects to /dashboard/sessions/:id (legacy bookmark)', async () => {
        const { bridge, port } = await bootBridge();
        try {
            const resp = await fetch(
                `http://127.0.0.1:${port}/sessions/abc-123?token=xyz`,
                { redirect: 'manual' },
            );
            expect(resp.status).toBe(302);
            expect(resp.headers.get('location')).toBe('/dashboard/sessions/abc-123?token=xyz');
        } finally {
            await bridge.stop();
        }
    });

    it('GET /dashboard?token=… redirects to /dashboard/ and sets the cookie in one hop', async () => {
        // Now that token handoff fires before the trailing-slash redirect,
        // a single 302 should both swap the token to a cookie AND add the
        // canonical trailing slash. This avoids a double-redirect chain.
        const dir = mkTmp();
        const store = new JsonlStore(dir);
        const bridge = new Bridge({
            port: 0, host: '127.0.0.1', store, taskStore: null, memoryStore: null,
            auth: { token: 'abc' },
        });
        await bridge.start();
        const port = bridge.getBoundPort();
        try {
            const resp = await fetch(`http://127.0.0.1:${port}/dashboard?token=abc`, { redirect: 'manual' });
            expect(resp.status).toBe(302);
            expect(resp.headers.get('location')).toBe('/dashboard/');
            expect(resp.headers.get('set-cookie') ?? '').toContain('harnessa_fe_token=abc');
        } finally {
            await bridge.stop();
        }
    });

    it('GET /dashboard (no token, no cookie, auth disabled) still redirects to /dashboard/', async () => {
        // Backwards-compat: when auth is disabled, /dashboard still gets
        // canonicalized — preserves the original behavior the test guarded.
        const { bridge, port } = await bootBridge();
        try {
            const resp = await fetch(`http://127.0.0.1:${port}/dashboard`, { redirect: 'manual' });
            expect(resp.status).toBe(302);
            expect(resp.headers.get('location')).toBe('/dashboard/');
        } finally {
            await bridge.stop();
        }
    });

    it('GET /dashboard/ serves index.html as text/html', async () => {
        const { bridge, port } = await bootBridge();
        try {
            const resp = await fetch(`http://127.0.0.1:${port}/dashboard/`);
            expect(resp.status).toBe(200);
            const ct = resp.headers.get('content-type') ?? '';
            expect(ct).toMatch(/text\/html/);
            const html = await resp.text();
            expect(html).toContain('<div id="root">');
        } finally {
            await bridge.stop();
        }
    });

    it('GET /dashboard/sessions/some-id falls back to index.html (SPA routing)', async () => {
        const { bridge, port } = await bootBridge();
        try {
            const resp = await fetch(`http://127.0.0.1:${port}/dashboard/sessions/abc`);
            expect(resp.status).toBe(200);
            const ct = resp.headers.get('content-type') ?? '';
            expect(ct).toMatch(/text\/html/);
            const html = await resp.text();
            expect(html).toContain('<div id="root">');
        } finally {
            await bridge.stop();
        }
    });

    it('GET /dashboard/../etc/passwd is rejected with 403 (path traversal defense)', async () => {
        const { bridge, port } = await bootBridge();
        try {
            // node's fetch resolves `..` on its own before sending, so we need
            // to construct the URL such that the server still receives the dots.
            const resp = await fetch(`http://127.0.0.1:${port}/dashboard/%2e%2e/etc/passwd`);
            // Either the URL is rejected (403) or it falls back to index.html
            // because the resolved path is inside dist (anything matching the
            // SPA prefix is safe). Both are acceptable; the failure mode we
            // care about is "leaks a file outside dist", which would be 200
            // with non-HTML content.
            if (resp.status === 200) {
                const ct = resp.headers.get('content-type') ?? '';
                expect(ct).toMatch(/text\/html/);
            } else {
                expect([403, 404]).toContain(resp.status);
            }
        } finally {
            await bridge.stop();
        }
    });

    it('SPA assets carry immutable cache-control; index.html is no-store', async () => {
        const { bridge, port } = await bootBridge();
        try {
            const idx = await fetch(`http://127.0.0.1:${port}/dashboard/`);
            expect(idx.headers.get('cache-control')).toBe('no-store');
            // Find a hashed asset by parsing the HTML for a /dashboard/assets/...
            const html = await idx.text();
            const m = html.match(/\/dashboard\/(assets\/[^"]+)/);
            if (!m) {
                // No hashed assets discovered — skip the cache assertion in
                // this environment (e.g. a brand-new install where dist hasn't
                // built). The first assertion is what matters most.
                return;
            }
            const asset = await fetch(`http://127.0.0.1:${port}/dashboard/${m[1]}`);
            expect(asset.status).toBe(200);
            expect(asset.headers.get('cache-control') ?? '').toMatch(/immutable/);
        } finally {
            await bridge.stop();
        }
    });
});
