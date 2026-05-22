import { afterEach, describe, expect, it } from 'vitest';
import { Bridge } from './bridge.js';
import { startMcpHttpServer } from './mcpHttp.js';

const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
    while (cleanups.length) {
        const fn = cleanups.shift();
        if (fn) await fn();
    }
});

async function startBridge(opts: Parameters<typeof Bridge.prototype.constructor>[0] = {}) {
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
    return bridge;
}

describe('mcpHttp', () => {
    it('mounts on the configured path and 404s other paths', async () => {
        const bridge = await startBridge();
        const handle = await startMcpHttpServer(bridge, { path: '/mcp' });
        cleanups.push(() => handle.close());

        const port = bridge.getBoundPort()!;
        // GET on /mcp without a session id should still be routed to the
        // transport (which decides what to do); /something-else should fall
        // through to the bridge default handler (404).
        const elsewhere = await fetch(`http://127.0.0.1:${port}/elsewhere`);
        expect(elsewhere.status).toBe(404);

        const mcpRes = await fetch(`http://127.0.0.1:${port}/mcp`);
        // Transport responds (status varies — what we assert is that the
        // request reached the transport, i.e. it's NOT the bridge 404 body).
        const body = await mcpRes.text();
        expect(body).not.toBe('Not Found');
    });

    it('requires token when bridge has auth enabled', async () => {
        const bridge = await startBridge({ auth: { token: 's3cret' } });
        const handle = await startMcpHttpServer(bridge, { path: '/mcp' });
        cleanups.push(() => handle.close());
        const port = bridge.getBoundPort()!;

        const noAuth = await fetch(`http://127.0.0.1:${port}/mcp`);
        expect(noAuth.status).toBe(401);

        const withAuth = await fetch(`http://127.0.0.1:${port}/mcp`, {
            headers: { authorization: 'Bearer s3cret' },
        });
        // 401 specifically would mean auth still blocked us. Anything else
        // (200 / 405 / 406 / 400 — depending on what the SDK does for a
        // bodyless GET) means we made it past the auth layer.
        expect(withAuth.status).not.toBe(401);
    });
});
