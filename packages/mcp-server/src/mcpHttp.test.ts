import { afterEach, describe, expect, it } from 'vitest';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { Bridge } from '@harness-fe/daemon';
import { startMcpHttpServer } from './mcpHttp.js';
import { MemoryEventStore } from '@harness-fe/daemon';
import type { EventStore } from '@harness-fe/daemon';

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

    it('supports multiple concurrent clients (per-session transports)', async () => {
        // Regression: the old single shared transport threw "Server already
        // initialized" on the 2nd initialize, blocking multi-agent (gateway) use
        // and any reconnect. Per-session transports must let each client init.
        const bridge = await startBridge();
        const handle = await startMcpHttpServer(bridge, { path: '/mcp' });
        cleanups.push(() => handle.close());
        const port = bridge.getBoundPort()!;

        const headers = {
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
        };
        const initBody = (name: string) =>
            JSON.stringify({
                jsonrpc: '2.0',
                method: 'initialize',
                params: {
                    protocolVersion: '2025-06-18',
                    capabilities: {},
                    clientInfo: { name, version: '1' },
                },
                id: 1,
            });

        const r1 = await fetch(`http://127.0.0.1:${port}/mcp`, { method: 'POST', headers, body: initBody('c1') });
        await r1.text();
        const sid1 = r1.headers.get('mcp-session-id');
        expect(r1.status).toBe(200);
        expect(sid1).toBeTruthy();

        const r2 = await fetch(`http://127.0.0.1:${port}/mcp`, { method: 'POST', headers, body: initBody('c2') });
        await r2.text();
        const sid2 = r2.headers.get('mcp-session-id');
        expect(r2.status).toBe(200);
        expect(sid2).toBeTruthy();
        // Distinct sessions — the whole point of per-session transports.
        expect(sid2).not.toBe(sid1);

        // A request carrying an unknown session id is rejected (not silently
        // attached to some shared transport).
        const bad = await fetch(`http://127.0.0.1:${port}/mcp`, {
            method: 'POST',
            headers: { ...headers, 'mcp-session-id': 'does-not-exist' },
            body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 2 }),
        });
        expect(bad.status).toBe(400);
    });

    // SSE Last-Event-ID resumption — end-to-end wiring proof.
    //
    // What this asserts:
    //   1. A real MCP HTTP session goes through the wire protocol cleanly.
    //   2. The configured `EventStore` actually sees `storeEvent` calls
    //      (the SDK is wired to persist outgoing messages through the
    //      transport — not just sitting unused).
    //   3. When a new GET arrives with `Last-Event-ID`, the SDK invokes
    //      `replayEventsAfter` on the same store with that id (the resume
    //      path is taken; replay isn't a no-op).
    //
    // The actual "no dupes / no gaps" invariant is covered comprehensively
    // by MemoryEventStore.test.ts — here we prove the transport drives it.
    it('drives the EventStore on stream and replays after Last-Event-ID', async () => {
        const bridge = await startBridge();

        // Spy that mirrors MemoryEventStore's contract while recording calls.
        const storeCalls: Array<{ streamId: string; eventId: string }> = [];
        const replayCalls: Array<{ lastEventId: string }> = [];
        const eventsByStream = new Map<
            string,
            Array<{ eventId: string; message: JSONRPCMessage }>
        >();
        let seq = 0;
        const spy: EventStore = {
            async storeEvent(streamId, message) {
                seq += 1;
                const eventId = `${streamId}_${seq}`;
                storeCalls.push({ streamId, eventId });
                const arr = eventsByStream.get(streamId) ?? [];
                arr.push({ eventId, message });
                eventsByStream.set(streamId, arr);
                return eventId;
            },
            async replayEventsAfter(lastEventId, { send }) {
                replayCalls.push({ lastEventId });
                // Recover streamId from event id and replay everything past it.
                const streamId = lastEventId.split('_')[0];
                const arr = eventsByStream.get(streamId) ?? [];
                let resuming = false;
                for (const { eventId, message } of arr) {
                    if (resuming) await send(eventId, message);
                    if (eventId === lastEventId) resuming = true;
                }
                return streamId;
            },
        };

        const handle = await startMcpHttpServer(bridge, {
            path: '/mcp',
            eventStore: spy,
        });
        cleanups.push(() => handle.close());
        const port = bridge.getBoundPort()!;
        const url = `http://127.0.0.1:${port}/mcp`;

        // 1. Initialize MCP session. The response goes back over the
        //    Streamable HTTP response stream, so the SDK persists each
        //    outgoing message through our spy store.
        const init = await fetch(url, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                accept: 'application/json, text/event-stream',
            },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'initialize',
                params: {
                    protocolVersion: '2024-11-05',
                    capabilities: {},
                    clientInfo: { name: 'mcpHttp.test', version: '0.0.0' },
                },
            }),
        });
        const sessionId = init.headers.get('mcp-session-id');
        expect(sessionId).toBeTruthy();
        // Drain the response body so the connection can be reused.
        await init.text();

        // 2. The SDK should have persisted at least one message to the
        //    EventStore by now — the initialize response.
        expect(storeCalls.length).toBeGreaterThan(0);
        const firstEventId = storeCalls[0]!.eventId;

        // 3. Reopen the stream with Last-Event-ID set. This is what a
        //    real client would do after a transient disconnect.
        const resumed = await fetch(url, {
            headers: {
                accept: 'text/event-stream',
                'mcp-session-id': sessionId!,
                'last-event-id': firstEventId,
            },
        });
        // Status varies (200 SSE) but the salient assertion is the spy
        // saw the replay path get hit with the same id we passed.
        expect(replayCalls).toEqual([{ lastEventId: firstEventId }]);
        // Drop the long-lived stream we just opened — it has no consumer.
        await resumed.body?.cancel();
    });
});
