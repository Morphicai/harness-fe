import { afterEach, describe, expect, it } from 'vitest';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { Bridge } from './bridge.js';
import { startMcpHttpServer } from './mcpHttp.js';
import { MemoryEventStore } from './store/MemoryEventStore.js';
import type { EventStore } from './store/types.js';

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

    it('accepts a custom EventStore and disables resumability when passed null', async () => {
        const bridge = await startBridge();

        // Spy store records which events the SDK hands it.
        const stored: Array<{ streamId: string; message: JSONRPCMessage }> = [];
        const spy: EventStore = {
            async storeEvent(streamId, message) {
                stored.push({ streamId, message });
                return `${streamId}::${stored.length}`;
            },
            async replayEventsAfter() {
                return '';
            },
        };

        const h1 = await startMcpHttpServer(bridge, { path: '/mcp1', eventStore: spy });
        cleanups.push(() => h1.close());
        expect(h1.path).toBe('/mcp1');

        // Disabling resumability is a supported configuration.
        const h2 = await startMcpHttpServer(bridge, { path: '/mcp2', eventStore: null });
        cleanups.push(() => h2.close());
        expect(h2.path).toBe('/mcp2');

        // And the default path keeps the built-in MemoryEventStore.
        const h3 = await startMcpHttpServer(bridge, {
            path: '/mcp3',
            eventStore: new MemoryEventStore({ maxEventsPerStream: 10 }),
        });
        cleanups.push(() => h3.close());
        expect(h3.path).toBe('/mcp3');
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
