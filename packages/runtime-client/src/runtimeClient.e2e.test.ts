// @vitest-environment happy-dom
/**
 * End-to-end test for the complete runtime-client → bridge → store path on
 * the capabilities added in this sweep:
 *
 *   user code triggers `new WebSocket(...)` / `localStorage.setItem(...)`
 *     → patched runtime captures + emits via outbox
 *     → real Bridge over a real WebSocket connection
 *     → events land in JsonlStore with the right `t` field
 *
 * We use a real `RuntimeClient` instance (happy-dom is its environment) and
 * a real Bridge bound to an ephemeral port on 127.0.0.1.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// rrweb has CommonJS interop issues under happy-dom + Vite ESM. We never need
// the actual recorder in this test — it's purely background DOM capture — so
// stub the module surface used by client.ts before any imports resolve it.
vi.mock('rrweb', () => ({
    record: () => () => {},
    EventType: { Custom: 5 },
}));
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InProcessCoreClient, JsonlStore, type StoreEvent } from '@harness-fe/core';
import { createGateway, Policy, type GatewayHandle } from '@harness-fe/gateway';
import { RuntimeClient } from './client.js';
import { getCaptureStore } from './capture.js';
import type { NetworkEntry, StorageEntry, WsEntry } from '@harness-fe/protocol';

interface Env {
    core: InProcessCoreClient;
    gw: GatewayHandle;
    store: JsonlStore;
    dir: string;
    port: number;
    client: RuntimeClient;
    sessionId: string;
}

let env: Env | undefined;

async function rmDirWithRetry(dir: string, attempts = 5): Promise<void> {
    for (let i = 0; i < attempts; i++) {
        try {
            rmSync(dir, { recursive: true, force: true });
            return;
        } catch (err) {
            const code = (err as NodeJS.ErrnoException).code;
            if (code !== 'ENOTEMPTY' && code !== 'EBUSY' && code !== 'EPERM') throw err;
            if (i === attempts - 1) throw err;
            await new Promise((r) => setTimeout(r, 20 * (i + 1)));
        }
    }
}

async function setup(): Promise<Env> {
    const dir = mkdtempSync(join(tmpdir(), 'harness-rt-e2e-'));
    const store = new JsonlStore(dir);
    // New architecture: an in-process core behind the gateway front door; the
    // runtime connects to the gateway's /ws (Open policy → local principal).
    const core = new InProcessCoreClient({ store, taskStore: null, autoPurge: { enabled: false } });
    await core.start();
    const gw = createGateway({ coreClient: core, policy: new Policy({ mode: 'open' }) });
    const port = await gw.listen(0, '127.0.0.1');
    if (!port) throw new Error('no port');

    // happy-dom keeps singletons across tests — reset the patch state so this
    // RuntimeClient's onEvent wiring takes hold.
    getCaptureStore().dispose();

    const client = new RuntimeClient({
        projectId: 'rt-e2e',
        mcpUrl: `ws://127.0.0.1:${port}/ws`,
    });
    client.start();

    // Wait for hello.ack — bridge logs `peer connected` when the runtime is
    // registered. We poll the store's session list until ours shows up.
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
        const sessions = store.listSessions({ projectId: 'rt-e2e', limit: 5 });
        if (sessions.length > 0 && client.getConnectionState() === 'open') {
            break;
        }
        await new Promise((r) => setTimeout(r, 30));
    }
    if (client.getConnectionState() !== 'open') {
        throw new Error('runtime-client never connected');
    }

    return { core, gw, store, dir, port, client, sessionId: client.sessionId };
}

beforeEach(async () => {
    env = await setup();
});

afterEach(async () => {
    if (!env) return;
    env.client.stop();
    await env.gw.close();
    await env.core.stop();
    // close() drains the async write queue — must await, else rmSync races
    // file writes and the dir-recursive-rm trips ENOTEMPTY on Linux CI.
    await env.store.close();
    // Even after drain, Node's directory cache can lag by a tick on Linux —
    // retry-with-backoff handles the residual race deterministically.
    await rmDirWithRetry(env.dir);
    // Reset capture singleton so subsequent tests get a clean install.
    const cap = getCaptureStore();
    cap.dispose();
    cap.console.clear();
    cap.network.clear();
    cap.errors.clear();
    cap.ws.clear();
    cap.storage.clear();
    env = undefined;
});

/** Read events of a given type from the session timeline, polling for flush. */
async function readTypedEvents(
    store: JsonlStore,
    sessionId: string,
    type: string,
    expectedMin: number,
    timeoutMs = 1500,
): Promise<StoreEvent[]> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        await store.flush();
        const rows = store.tail(sessionId, { n: 200, type });
        if (rows.length >= expectedMin) return rows;
        await new Promise((r) => setTimeout(r, 30));
    }
    await store.flush();
    return store.tail(sessionId, { n: 200, type });
}

describe('RuntimeClient E2E — bridge connection sanity', () => {
    it('connects, sends hello, opens a session in the store', () => {
        const e = env!;
        const sessions = e.store.listSessions({ projectId: 'rt-e2e', limit: 5 });
        expect(sessions.length).toBeGreaterThanOrEqual(1);
        expect(sessions.find((s) => s.id === e.sessionId)).toBeDefined();
    });

    it('daemon connection is denylisted from ws capture (no self-loop)', async () => {
        const e = env!;
        // No user code touched WebSocket yet, but the runtime opened its own
        // ws to the daemon. If the patch were intercepting, the buffer would
        // already have a `phase:'open'` entry for that URL.
        const cap = getCaptureStore();
        const selfFrames = cap.ws.tail(50).filter((f) =>
            f.url.startsWith(`ws://127.0.0.1:${e.port}`),
        );
        expect(selfFrames).toHaveLength(0);
    });
});

describe('RuntimeClient E2E — patched WebSocket flows to bridge', () => {
    it('user-issued ws frames land in the store as t=ws', async () => {
        const e = env!;
        // happy-dom's WebSocket attempts real network, which we don't want.
        // Replace the global WebSocket BEFORE we trigger user code, then the
        // patched constructor wraps our fake instead.
        const realWs = (window as unknown as { WebSocket: typeof WebSocket }).WebSocket;
        class FakeWS extends EventTarget {
            static readonly CONNECTING = 0;
            static readonly OPEN = 1;
            static readonly CLOSING = 2;
            static readonly CLOSED = 3;
            url: string;
            readyState = 1;
            constructor(url: string | URL) {
                super();
                this.url = typeof url === 'string' ? url : url.toString();
            }
            send(_data: unknown): void { /* swallow */ }
            close(): void { this.readyState = 3; }
        }
        // Patched WebSocket caches the OriginalWS reference inside, but it
        // was captured at install-time. We must point window.WebSocket to
        // FakeWS BEFORE that — which means re-installing the patch. Easiest:
        // tear down + re-install via a fresh dispose + capture install.
        const cap = getCaptureStore();
        cap.dispose();
        (window as unknown as { WebSocket: typeof WebSocket }).WebSocket = FakeWS as unknown as typeof WebSocket;
        cap.install(
            (name, payload) => e.client.sendEvent(name, payload),
            { daemonUrl: `ws://127.0.0.1:${e.port}/ws` },
        );

        try {
            const ws = new window.WebSocket('wss://chat.test/v1') as unknown as FakeWS;
            ws.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ kind: 'kick' }) }));
            ws.send(JSON.stringify({ kind: 'ack' }));
            ws.dispatchEvent(new CloseEvent('close', { code: 4001, reason: 'kicked', wasClean: false }));

            const rows = await readTypedEvents(e.store, e.sessionId, 'ws', 3);
            const phases = rows.map((r) => (r.d as WsEntry).phase);
            expect(phases).toContain('open');
            expect(phases).toContain('recv');
            expect(phases).toContain('send');
            expect(phases).toContain('close');

            const close = rows.find((r) => (r.d as WsEntry).phase === 'close')!;
            expect((close.d as WsEntry).code).toBe(4001);
            // visitorId stamped on row by bridge ingestion.
            expect(close.visitorId).toBe(e.client.visitorId);
        } finally {
            (window as unknown as { WebSocket: typeof WebSocket }).WebSocket = realWs;
        }
    });
});

describe('RuntimeClient E2E — patched storage flows to bridge', () => {
    it('localStorage.setItem / removeItem reaches the store as t=storage', async () => {
        const e = env!;
        localStorage.setItem('Tanka_tokenInfo', 'abc');
        localStorage.removeItem('Tanka_tokenInfo');

        const rows = await readTypedEvents(e.store, e.sessionId, 'storage', 2);
        const ops = rows.map((r) => (r.d as StorageEntry).op);
        expect(ops).toContain('set');
        expect(ops).toContain('remove');
        const removeRow = rows.find((r) => (r.d as StorageEntry).op === 'remove')!;
        expect((removeRow.d as StorageEntry).key).toBe('Tanka_tokenInfo');
        // initiator stack survives the round-trip.
        expect((removeRow.d as StorageEntry).initiator?.stack).toBeDefined();
    });
});

describe('RuntimeClient E2E — patched fetch initiator round-trip', () => {
    it('fetch() carries an initiator.stack into the store', async () => {
        const e = env!;
        // Stub fetch with a minimal mock — happy-dom's fetch would try real
        // network, which we don't want.
        const origFetch = window.fetch;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).fetch = async () => new Response('{}', {
            status: 200,
            headers: { 'content-type': 'application/json' },
        });
        const cap = getCaptureStore();
        // Re-install so fetch patch wraps the new stub.
        cap.dispose();
        cap.install(
            (name, payload) => e.client.sendEvent(name, payload),
            { daemonUrl: `ws://127.0.0.1:${e.port}/ws` },
        );

        try {
            await window.fetch('http://api.test/users');
            await new Promise((r) => setTimeout(r, 20));

            const rows = await readTypedEvents(e.store, e.sessionId, 'network', 1);
            const req = rows.find((r) => (r.d as NetworkEntry).phase === 'req')!;
            expect(req).toBeDefined();
            expect((req.d as NetworkEntry).initiator?.stack).toBeDefined();
        } finally {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (window as any).fetch = origFetch;
        }
    });
});
