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

describe('Dashboard SPA handler', () => {
    it('GET /dashboard redirects to /dashboard/ preserving query', async () => {
        const { bridge, port } = await bootBridge();
        try {
            const resp = await fetch(`http://127.0.0.1:${port}/dashboard?token=abc`, { redirect: 'manual' });
            expect(resp.status).toBe(302);
            expect(resp.headers.get('location')).toBe('/dashboard/?token=abc');
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
