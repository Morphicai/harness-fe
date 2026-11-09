import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HEARTBEAT_INTERVAL_MS, HEARTBEAT_REAP_MS } from '@harness-fe/protocol';
import { Bridge } from './bridge.js';
import { JsonlStore } from './store/index.js';
import { FakePeerSocket } from './test-utils.js';

/**
 * Session lifecycle around ws disconnects — the flapping-CLOSED bug:
 *  - disconnect ⇒ session close is deferred behind a grace window
 *  - reconnect inside the window ⇒ close is cancelled, session stays LIVE
 *  - reconnect after the window ⇒ session reopens (endedAt cleared)
 *  - startedAt is write-once across reconnect re-upserts
 *  - heartbeat ping/pong + silent-peer reaping
 */

const GRACE_MS = 30_000; // RUNTIME_SESSION_GRACE_MS in bridge.ts

let dir: string;
let store: JsonlStore;

beforeEach(() => {
    vi.useFakeTimers();
    dir = mkdtempSync(join(tmpdir(), 'harness-bridge-lifecycle-'));
    store = new JsonlStore(dir);
});

afterEach(() => {
    vi.useRealTimers();
    try {
        rmSync(dir, { recursive: true, force: true });
    } catch {
        /* ignore */
    }
});

function newBridge(): Bridge {
    return new Bridge({ store, taskStore: null, autoPurge: { enabled: false } });
}

function connect(
    bridge: Bridge,
    role: 'runtime-client' | 'dashboard-client' | 'node-runtime',
    opts: { sessionId?: string; tabId?: string; projectId?: string } = {},
): FakePeerSocket {
    const sock = new FakePeerSocket();
    bridge.acceptPeer(sock);
    const hello: Record<string, unknown> = {
        type: 'hello',
        id: `h-${Math.random().toString(36).slice(2)}`,
        role,
        projectId: opts.projectId ?? 'demo',
        page: { url: 'http://localhost:5173/', title: 'Demo' },
    };
    if (role === 'runtime-client') {
        hello.tabId = opts.tabId ?? 'tab-1';
        hello.sessionId = opts.sessionId ?? 'sess-1';
    }
    sock.receive(hello);
    return sock;
}

describe('Bridge — session lifecycle across ws disconnects', () => {
    it('keeps the session LIVE when the peer reconnects inside the grace window', async () => {
        const bridge = newBridge();
        await bridge.start();
        const sock = connect(bridge, 'runtime-client', { sessionId: 'sess-1', tabId: 'tab-1' });

        sock.close(); // ws blip
        vi.advanceTimersByTime(GRACE_MS - 5_000); // still inside the window
        connect(bridge, 'runtime-client', { sessionId: 'sess-1', tabId: 'tab-1' }); // auto-reconnect

        vi.advanceTimersByTime(2 * GRACE_MS); // original close timer must NOT fire
        expect(store.getSession('sess-1')?.endedAt).toBeUndefined();
        expect(store.getTab('tab-1')?.disconnectedAt).toBeUndefined();
        await bridge.stop();
    });

    it('closes session + tab after the grace window expires, and notifies dashboard', async () => {
        const bridge = newBridge();
        await bridge.start();
        const watcher = connect(bridge, 'dashboard-client');
        const sock = connect(bridge, 'runtime-client', { sessionId: 'sess-1', tabId: 'tab-1' });

        sock.close();
        vi.advanceTimersByTime(GRACE_MS);
        expect(store.getSession('sess-1')?.endedAt).toBeTypeOf('number');
        expect(store.getTab('tab-1')?.disconnectedAt).toBeTypeOf('number');
        const closed = watcher
            .sentFrames()
            .find((f) => f.type === 'dashboard.update' && f.kind === 'session.closed' && f.sessionId === 'sess-1');
        expect(closed).toBeTruthy();
        await bridge.stop();
    });

    it('reopens the session when the peer reconnects after a close (endedAt cleared)', async () => {
        const bridge = newBridge();
        await bridge.start();
        const sock = connect(bridge, 'runtime-client', { sessionId: 'sess-1', tabId: 'tab-1' });

        sock.close();
        vi.advanceTimersByTime(GRACE_MS);
        expect(store.getSession('sess-1')?.endedAt).toBeTypeOf('number');

        vi.advanceTimersByTime(60_000);
        connect(bridge, 'runtime-client', { sessionId: 'sess-1', tabId: 'tab-1' });
        expect(store.getSession('sess-1')?.endedAt).toBeUndefined();
        expect(store.getTab('tab-1')?.disconnectedAt).toBeUndefined();
        await bridge.stop();
    });

    it('keeps startedAt write-once across reconnect re-upserts (no timestamp inversion)', async () => {
        const bridge = newBridge();
        await bridge.start();
        connect(bridge, 'runtime-client', { sessionId: 'sess-1', tabId: 'tab-1' });
        const startedAt = store.getSession('sess-1')!.startedAt;

        vi.advanceTimersByTime(120_000);
        connect(bridge, 'runtime-client', { sessionId: 'sess-1', tabId: 'tab-1' });
        vi.advanceTimersByTime(120_000);
        connect(bridge, 'runtime-client', { sessionId: 'sess-1', tabId: 'tab-1' });

        expect(store.getSession('sess-1')!.startedAt).toBe(startedAt);
        await bridge.stop();
    });

    it('a stale deferred close never flips a session owned by a live peer', async () => {
        const bridge = newBridge();
        await bridge.start();
        // Two connections on the same page load: C1 (older, half-open) and C2.
        const stale = connect(bridge, 'runtime-client', { sessionId: 'sess-1', tabId: 'tab-1' });
        connect(bridge, 'runtime-client', { sessionId: 'sess-1', tabId: 'tab-1' });

        // C1 dies; its deferred close is armed while C2 keeps the session live.
        stale.close();
        vi.advanceTimersByTime(GRACE_MS + 1_000);
        expect(store.getSession('sess-1')?.endedAt).toBeUndefined();
        expect(store.getTab('tab-1')?.disconnectedAt).toBeUndefined();
        await bridge.stop();
    });

    it('a deferred close spares a tab reused by a fresh page load', async () => {
        const bridge = newBridge();
        await bridge.start();
        const sock = connect(bridge, 'runtime-client', { sessionId: 'sess-1', tabId: 'tab-1' });

        sock.close(); // arms the deferred close for sess-1/tab-1
        vi.advanceTimersByTime(10_000);
        // Reload: new session on the same tab, before the deferred close fires.
        connect(bridge, 'runtime-client', { sessionId: 'sess-2', tabId: 'tab-1' });

        vi.advanceTimersByTime(GRACE_MS + 1_000);
        // The old session closes …
        expect(store.getSession('sess-1')?.endedAt).toBeTypeOf('number');
        // … but the reused tab is NOT stamped disconnected.
        expect(store.getTab('tab-1')?.disconnectedAt).toBeUndefined();
        await bridge.stop();
    });

    it('stop() flushes pending session closes instead of stranding them LIVE', async () => {
        const bridge = newBridge();
        await bridge.start();
        const sock = connect(bridge, 'runtime-client', { sessionId: 'sess-1', tabId: 'tab-1' });
        sock.close(); // deferred close armed, 30s remain

        await bridge.stop(); // teardown before the timer fires
        expect(store.getSession('sess-1')?.endedAt).toBeTypeOf('number');
        expect(store.getTab('tab-1')?.disconnectedAt).toBeTypeOf('number');
    });
});

describe('Bridge — heartbeat', () => {
    it('advertises heartbeatMs in hello.ack', async () => {
        const bridge = newBridge();
        await bridge.start();
        const sock = connect(bridge, 'runtime-client', { sessionId: 'sess-1', tabId: 'tab-1' });
        const ack = sock.sentFrames().find((f) => f.type === 'hello.ack');
        expect(ack?.heartbeatMs).toBe(HEARTBEAT_INTERVAL_MS);
        await bridge.stop();
    });

    it('answers every ping with a pong carrying the same id', async () => {
        const bridge = newBridge();
        await bridge.start();
        const sock = connect(bridge, 'runtime-client', { sessionId: 'sess-1', tabId: 'tab-1' });
        sock.receive({ type: 'ping', id: 'p-1' });
        sock.receive({ type: 'ping', id: 'p-2' });
        const pongs = sock.sentFrames().filter((f) => f.type === 'pong');
        expect(pongs.map((p) => p.id)).toEqual(['p-1', 'p-2']);
        await bridge.stop();
    });

    it('reaps heartbeat-capable peers silent past the reap threshold (half-open sockets)', async () => {
        const bridge = newBridge();
        await bridge.start();
        const sock = connect(bridge, 'runtime-client', { sessionId: 'sess-1', tabId: 'tab-1' });
        sock.receive({ type: 'ping', id: 'p-cap' }); // proves heartbeat capability

        // No further frames. Sweep runs every REAP/3; reap at first sweep
        // where now - lastActive > REAP.
        vi.advanceTimersByTime(HEARTBEAT_REAP_MS + 2 * (HEARTBEAT_REAP_MS / 3));
        expect(sock.isOpen).toBe(false);
        // The reap funnels into the regular close path: session closes after grace.
        vi.advanceTimersByTime(GRACE_MS);
        expect(store.getSession('sess-1')?.endedAt).toBeTypeOf('number');
        await bridge.stop();
    });

    it('never reaps peers that never ping (pre-heartbeat clients)', async () => {
        const bridge = newBridge();
        await bridge.start();
        const sock = connect(bridge, 'runtime-client', { sessionId: 'sess-1', tabId: 'tab-1' });

        // Silent the whole time but no ping ever sent — old clients only close
        // on real close events; the reaper must not reconnect-loop them.
        vi.advanceTimersByTime(5 * HEARTBEAT_REAP_MS);
        expect(sock.isOpen).toBe(true);
        expect(store.getSession('sess-1')?.endedAt).toBeUndefined();
        await bridge.stop();
    });

    it('does not reap peers that keep sending frames (ping counts as liveness)', async () => {
        const bridge = newBridge();
        await bridge.start();
        const sock = connect(bridge, 'runtime-client', { sessionId: 'sess-1', tabId: 'tab-1' });

        for (let i = 0; i < 6; i++) {
            vi.advanceTimersByTime(HEARTBEAT_REAP_MS / 3);
            sock.receive({ type: 'ping', id: `p-${i}` });
        }
        expect(sock.isOpen).toBe(true);
        expect(store.getSession('sess-1')?.endedAt).toBeUndefined();
        await bridge.stop();
    });
});
