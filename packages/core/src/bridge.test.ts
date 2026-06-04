import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { COMMAND, EVENT_NAME, PROTOCOL_VERSION } from '@harness-fe/protocol';
import { Bridge } from './bridge.js';
import { JsonlStore, JsonTaskStore, type IStore } from './store/index.js';
import { LOCAL_PRINCIPAL } from './identity.js';
import { FakePeerSocket } from './test-utils.js';

// ── helpers ─────────────────────────────────────────────────────────────────

function newBridge(opts: Partial<ConstructorParameters<typeof Bridge>[0]> = {}): Bridge {
    return new Bridge({ store: null, taskStore: null, autoPurge: { enabled: false }, ...opts });
}

/** Accept a peer and send its hello; returns the socket (ack is its lastFrame). */
function connect(
    bridge: Bridge,
    role: 'runtime-client' | 'vite-plugin' | 'webpack-plugin' | 'node-runtime' | 'dashboard-client',
    opts: { tabId?: string; projectId?: string; sessionId?: string; visitorId?: string; buildId?: string } = {},
    principal = LOCAL_PRINCIPAL,
): FakePeerSocket {
    const sock = new FakePeerSocket();
    bridge.acceptPeer(sock, principal);
    const hello: Record<string, unknown> = {
        type: 'hello',
        id: 'h1',
        role,
        projectId: opts.projectId ?? 'demo',
        page: { url: 'http://localhost:5173/', title: 'Demo' },
    };
    if (role === 'runtime-client') {
        hello.tabId = opts.tabId ?? 'tab-1';
        hello.sessionId = opts.sessionId ?? 'sess-1';
        if (opts.visitorId) hello.visitorId = opts.visitorId;
        if (opts.buildId) hello.buildId = opts.buildId;
    }
    if (role === 'node-runtime' && opts.sessionId) hello.sessionId = opts.sessionId;
    sock.receive(hello);
    return sock;
}

/** Wire a runtime-client peer and resolve the next outbound command via a response. */
function answerNextCommand(sock: FakePeerSocket, result: unknown, ok = true, error?: string): void {
    const cmd = sock.framesOfType('command').at(-1);
    if (!cmd) throw new Error('no command frame was sent');
    sock.receive({
        type: 'response',
        id: cmd.id,
        ok,
        ...(ok ? { result } : { error: { message: error ?? 'failed' } }),
    });
}

// ── auto-purge scheduler ──────────────────────────────────────────────────────

describe('Bridge — auto-purge scheduler', () => {
    it('runs store.purge() on start when enabled, with policy passed through', async () => {
        const calls: unknown[] = [];
        const fakeStore = {
            purge: (policy: unknown) => {
                calls.push(policy);
                return { sessionsDeleted: 0, recordingsDeleted: 0, exportsDeleted: 0, bytesFreed: 0 };
            },
        } as unknown as IStore;
        const bridge = new Bridge({
            store: fakeStore,
            taskStore: null,
            autoPurge: { enabled: true, intervalMs: 9_999_999, policy: { maxAgeDays: 1 } },
        });
        try {
            await bridge.start();
            expect(calls).toEqual([{ maxAgeDays: 1 }]);
        } finally {
            await bridge.stop();
        }
    });

    it('skips startup purge when skipInitial is set', async () => {
        const calls: unknown[] = [];
        const fakeStore = {
            purge: (p: unknown) => { calls.push(p); return { sessionsDeleted: 0, recordingsDeleted: 0, exportsDeleted: 0, bytesFreed: 0 }; },
        } as unknown as IStore;
        const bridge = new Bridge({ store: fakeStore, taskStore: null, autoPurge: { enabled: true, skipInitial: true, intervalMs: 9_999_999 } });
        try {
            await bridge.start();
            expect(calls).toEqual([]);
        } finally {
            await bridge.stop();
        }
    });

    it('does not crash when store.purge throws', async () => {
        const fakeStore = { purge: () => { throw new Error('disk full'); } } as unknown as IStore;
        const bridge = new Bridge({ store: fakeStore, taskStore: null, autoPurge: { enabled: true, intervalMs: 9_999_999 } });
        const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
        try {
            await expect(bridge.start()).resolves.toBeUndefined();
        } finally {
            spy.mockRestore();
            await bridge.stop();
        }
    });

    it('respects enabled:false (no purge runs)', async () => {
        const calls: unknown[] = [];
        const fakeStore = { purge: (p: unknown) => { calls.push(p); return { sessionsDeleted: 0, recordingsDeleted: 0, exportsDeleted: 0, bytesFreed: 0 }; } } as unknown as IStore;
        const bridge = new Bridge({ store: fakeStore, taskStore: null, autoPurge: { enabled: false } });
        try {
            await bridge.start();
            expect(calls).toEqual([]);
        } finally {
            await bridge.stop();
        }
    });
});

// ── handshake + commands ──────────────────────────────────────────────────────

describe('Bridge — handshake + commands', () => {
    let bridge: Bridge;
    beforeEach(() => { bridge = newBridge(); });
    afterEach(async () => { await bridge.stop(); });

    it('handshakes a runtime-client and acks with tabId + consent', () => {
        const sock = connect(bridge, 'runtime-client', { tabId: 'tab-1' });
        const ack = sock.lastFrame();
        expect(ack.type).toBe('hello.ack');
        expect(ack.tabId).toBe('tab-1');
        expect(ack.serverVersion).toBe(PROTOCOL_VERSION);
        expect(ack.consent).toEqual({ mode: 'off' });
    });

    it('pushes consent policy from options into the ack', () => {
        const b = newBridge({ consent: { mode: 'session' } });
        const sock = connect(b, 'runtime-client', { tabId: 'tab-x' });
        expect(sock.lastFrame().consent).toEqual({ mode: 'session' });
    });

    it('rejects a runtime-client hello missing sessionId', () => {
        const sock = new FakePeerSocket();
        bridge.acceptPeer(sock);
        sock.receive({ type: 'hello', id: 'h1', role: 'runtime-client', projectId: 'demo', tabId: 'tab-1' });
        const ack = sock.lastFrame();
        expect(ack.type).toBe('hello.ack');
        expect(ack.error).toMatch(/missing sessionId/);
    });

    it('sendCommand round-trips request and response', async () => {
        const sock = connect(bridge, 'runtime-client', { tabId: 'tab-1' });
        const p = bridge.sendCommand(COMMAND.PAGE_CLICK, { selector: { css: '#go' } }, { tabId: 'tab-1' });
        const cmd = sock.framesOfType('command').at(-1);
        expect(cmd.command).toBe(COMMAND.PAGE_CLICK);
        expect(cmd.tabId).toBe('tab-1');
        answerNextCommand(sock, { clicked: true });
        await expect(p).resolves.toEqual({ clicked: true });
    });

    it('sendCommand rejects when no runtime-client tab is connected', async () => {
        await expect(bridge.sendCommand(COMMAND.PAGE_CLICK, {}, {})).rejects.toThrow(/no runtime-client connected/);
    });

    it('sendCommand surfaces ok=false errors', async () => {
        const sock = connect(bridge, 'runtime-client', { tabId: 'tab-1' });
        const p = bridge.sendCommand(COMMAND.PAGE_EVALUATE, { expr: 'boom' }, { tabId: 'tab-1' });
        answerNextCommand(sock, undefined, false, 'evaluation failed');
        await expect(p).rejects.toThrow(/evaluation failed/);
    });

    it('fans out event frames to listeners', () => {
        const sock = connect(bridge, 'runtime-client', { tabId: 'tab-1' });
        const seen: string[] = [];
        bridge.onEvent((ev) => seen.push(ev.name));
        sock.receive({ type: 'event', id: 'e1', name: 'console', ts: Date.now(), payload: { level: 'log', args: ['hi'] } });
        expect(seen).toContain('console');
    });

    it('lists connected tabs', async () => {
        connect(bridge, 'runtime-client', { tabId: 'tab-1' });
        connect(bridge, 'runtime-client', { tabId: 'tab-2', sessionId: 'sess-2' });
        const tabs = await bridge.listTabs();
        expect(tabs.map((t) => t.tabId).sort()).toEqual(['tab-1', 'tab-2']);
    });

    it('drops the peer + pending state on socket close', async () => {
        const sock = connect(bridge, 'runtime-client', { tabId: 'tab-1' });
        sock.close();
        await expect(bridge.sendCommand(COMMAND.PAGE_CLICK, {}, { tabId: 'tab-1' })).rejects.toThrow();
    });
});

// ── tasks ──────────────────────────────────────────────────────────────────────

describe('Bridge — tasks', () => {
    const submit = (sock: FakePeerSocket, over: Record<string, unknown> = {}) =>
        sock.receive({
            type: 'event',
            id: `t${Math.random()}`,
            name: EVENT_NAME.TASK_SUBMIT,
            ts: Date.now(),
            tabId: 'tab-1',
            payload: {
                question: 'why broken?',
                selector: { css: '#x' },
                url: 'http://localhost/',
                element: { tag: 'button', outerHTML: '<button>Go</button>' },
                ...over,
            },
        });

    it('records task.submit events into the queue', async () => {
        const bridge = newBridge();
        const sock = connect(bridge, 'runtime-client', { tabId: 'tab-1' });
        submit(sock);
        const tasks = await bridge.listTasks();
        expect(tasks).toHaveLength(1);
        expect(tasks[0].question).toBe('why broken?');
        await bridge.stop();
    });

    it('ignores task.submit events with invalid payload', async () => {
        const bridge = newBridge();
        const sock = connect(bridge, 'runtime-client', { tabId: 'tab-1' });
        sock.receive({ type: 'event', id: 'bad', name: EVENT_NAME.TASK_SUBMIT, ts: Date.now(), payload: { nope: true } });
        expect(await bridge.listTasks()).toHaveLength(0);
        await bridge.stop();
    });

    it('deduplicates repeat submits with same tab + selector + question', async () => {
        const bridge = newBridge();
        const sock = connect(bridge, 'runtime-client', { tabId: 'tab-1' });
        submit(sock);
        submit(sock);
        expect(await bridge.listTasks()).toHaveLength(1);
        await bridge.stop();
    });

    it('claim + resolve transitions, defaulting verifiedAt when a verification session is given', async () => {
        const bridge = newBridge();
        const sock = connect(bridge, 'runtime-client', { tabId: 'tab-1' });
        submit(sock);
        const [task] = await bridge.listTasks();
        const claimed = await bridge.claimTask(task.id);
        expect(claimed?.status).toBe('claimed');
        const resolved = await bridge.resolveTask(task.id, 'fixed', {
            type: 'code-fix',
            commit: 'abc',
            verificationSessionId: 'sess-verify',
        });
        expect(resolved?.status).toBe('resolved');
        expect(resolved?.resolution?.verificationSessionId).toBe('sess-verify');
        expect(typeof resolved?.resolution?.verifiedAt).toBe('number');
        await bridge.stop();
    });

    it('persists tasks across bridge restarts via JsonTaskStore', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'core-tasks-'));
        try {
            const b1 = new Bridge({ store: null, taskStore: new JsonTaskStore(dir), autoPurge: { enabled: false } });
            const sock = connect(b1, 'runtime-client', { tabId: 'tab-1' });
            submit(sock);
            await b1.stop();

            const b2 = new Bridge({ store: null, taskStore: new JsonTaskStore(dir), autoPurge: { enabled: false } });
            // A vite-plugin / node-runtime hello triggers loadTasksForProject when store is null.
            connect(b2, 'vite-plugin', { projectId: 'demo' });
            const tasks = await b2.listTasks();
            expect(tasks.map((t) => t.question)).toContain('why broken?');
            await b2.stop();
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

// ── query channel (runtime → core, owner-scoped) ─────────────────────────────

describe('Bridge — query channel', () => {
    it('tasks.mine returns only the caller-visitor tasks; tasks.delete enforces ownership', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'core-query-'));
        try {
            const bridge = new Bridge({ store: null, taskStore: new JsonTaskStore(dir), autoPurge: { enabled: false } });
            const sock = connect(bridge, 'runtime-client', { tabId: 'tab-1', visitorId: 'vis-1' });
            sock.receive({
                type: 'event', id: 'tk', name: EVENT_NAME.TASK_SUBMIT, ts: Date.now(), tabId: 'tab-1',
                payload: { question: 'mine', selector: { css: '#a' }, url: 'http://x/', element: { tag: 'div', outerHTML: '<div/>' } },
            });
            sock.receive({ type: 'query', id: 'q1', method: 'tasks.mine', args: {} });
            const resp = sock.framesOfType('query.response').at(-1);
            expect(resp.ok).toBe(true);
            expect(resp.result.tasks).toHaveLength(1);
            const taskId = resp.result.tasks[0].id;

            // A different visitor cannot delete it.
            const other = connect(bridge, 'runtime-client', { tabId: 'tab-2', sessionId: 'sess-2', visitorId: 'vis-2' });
            other.receive({ type: 'query', id: 'q2', method: 'tasks.delete', args: { id: taskId } });
            const del = other.framesOfType('query.response').at(-1);
            expect(del.ok).toBe(false);
            expect(del.error.code).toBe('forbidden');
            await bridge.stop();
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('rejects queries from a peer without a visitorId', () => {
        const bridge = newBridge();
        const sock = connect(bridge, 'runtime-client', { tabId: 'tab-1' }); // no visitorId
        sock.receive({ type: 'query', id: 'q', method: 'tasks.mine', args: {} });
        const resp = sock.framesOfType('query.response').at(-1);
        expect(resp.ok).toBe(false);
        expect(resp.error.code).toBe('forbidden');
    });
});

// ── dashboard subscribers ─────────────────────────────────────────────────────

describe('Bridge — dashboard subscribers', () => {
    it('dashboard-client gets an ack and receives session.new on a new runtime session', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'core-dash-'));
        try {
            const bridge = new Bridge({ store: new JsonlStore(dir), taskStore: null, autoPurge: { enabled: false } });
            const dash = connect(bridge, 'dashboard-client');
            expect(dash.lastFrame().type).toBe('hello.ack');
            connect(bridge, 'runtime-client', { tabId: 'tab-1', sessionId: 'sess-new' });
            const updates = dash.framesOfType('dashboard.update');
            expect(updates.some((u) => u.kind === 'session.new' && u.sessionId === 'sess-new')).toBe(true);
            await bridge.stop();
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

// ── store persistence ──────────────────────────────────────────────────────────

describe('Bridge — store persistence', () => {
    let dir: string;
    let bridge: Bridge;
    beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'core-store-')); });
    afterEach(async () => { await bridge.stop(); rmSync(dir, { recursive: true, force: true }); });

    it('persists events to the session timeline on disk', async () => {
        const store = new JsonlStore(dir);
        bridge = new Bridge({ store, taskStore: null, autoPurge: { enabled: false } });
        const sock = connect(bridge, 'runtime-client', { tabId: 'tab-1', sessionId: 'sess-1' });
        sock.receive({ type: 'event', id: 'e1', name: 'console', ts: Date.now(), tabId: 'tab-1', payload: { level: 'log', args: ['hello'] } });
        await store.flush();
        const events = store.tail('sess-1', { n: 50 });
        expect(events.some((e) => e.t === 'console')).toBe(true);
    });

    it('persists rrweb payloads into recordings while keeping a metadata timeline row', async () => {
        const store = new JsonlStore(dir);
        bridge = new Bridge({ store, taskStore: null, autoPurge: { enabled: false } });
        const sock = connect(bridge, 'runtime-client', { tabId: 'tab-1', sessionId: 'sess-rr' });
        sock.receive({
            type: 'event', id: 'r1', name: EVENT_NAME.RRWEB, ts: Date.now(), tabId: 'tab-1',
            payload: { chunkId: 'c1', tabId: 'tab-1', startTs: 1, endTs: 2, eventCount: 3, events: [{ type: 2, data: {}, timestamp: 1 }] },
        });
        await store.flush();
        const chunks = store.listRecordings('sess-rr');
        expect(chunks).toHaveLength(1);
        const rows = store.tail('sess-rr', { n: 50, type: 'rrweb' });
        expect(rows[0].d).toMatchObject({ chunkId: 'c1', eventCount: 3 });
    });

    it('derives an rrweb marker from an error event', async () => {
        const store = new JsonlStore(dir);
        bridge = new Bridge({ store, taskStore: null, autoPurge: { enabled: false } });
        const sock = connect(bridge, 'runtime-client', { tabId: 'tab-1', sessionId: 'sess-mk' });
        sock.receive({ type: 'event', id: 'er1', name: 'error', ts: Date.now(), tabId: 'tab-1', payload: { message: 'TypeError: x', source: 'app.js' } });
        await store.flush();
        const markers = store.tail('sess-mk', { n: 50, type: 'rrweb:marker' });
        expect(markers).toHaveLength(1);
        expect(markers[0].d).toMatchObject({ kind: 'error', label: 'TypeError: x' });
    });

    it('records a PAGE_LOAD into session meta + a load row', async () => {
        const store = new JsonlStore(dir);
        bridge = new Bridge({ store, taskStore: null, autoPurge: { enabled: false } });
        const sock = connect(bridge, 'runtime-client', { tabId: 'tab-1', sessionId: 'sess-pl' });
        sock.receive({
            type: 'event', id: 'pl1', name: EVENT_NAME.PAGE_LOAD, ts: Date.now(), tabId: 'tab-1',
            payload: { sessionId: 'sess-pl', page: { url: 'http://localhost/app', title: 'App' }, storage: {} },
        });
        await store.flush();
        const loads = store.tail('sess-pl', { n: 50, type: 'load' });
        expect(loads).toHaveLength(1);
        expect(store.getSession('sess-pl')?.url).toBe('http://localhost/app');
    });

    it('plugin-less runtime-client opens its own session', () => {
        const store = new JsonlStore(dir);
        bridge = new Bridge({ store, taskStore: null, autoPurge: { enabled: false } });
        connect(bridge, 'runtime-client', { tabId: 'tab-1', sessionId: 'sess-solo' });
        expect(store.getSession('sess-solo')).toBeDefined();
    });
});

// ── HTTP-batch ingest (Edge runtime path) ────────────────────────────────────

describe('Bridge — handleHttpBatch', () => {
    it('persists batched events to the resolved session', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'core-batch-'));
        const store = new JsonlStore(dir);
        const bridge = new Bridge({ store, taskStore: null, autoPurge: { enabled: false } });
        try {
            bridge.handleHttpBatch(
                { projectId: 'demo', sessionId: 'sess-http', displayName: 'Demo' } as any,
                [{ name: 'app.log', ts: Date.now(), payload: { level: 'info', msg: 'server up' } }] as any,
            );
            await store.flush();
            const events = store.tail('sess-http', { n: 50 });
            expect(events.some((e) => e.t === 'app-log')).toBe(true);
        } finally {
            await bridge.stop();
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('fires event listeners for batched events', () => {
        const bridge = newBridge();
        const seen: string[] = [];
        bridge.onEvent((ev) => seen.push(ev.name));
        bridge.handleHttpBatch(
            { projectId: 'demo' } as any,
            [{ name: 'console', ts: Date.now(), payload: {} }] as any,
        );
        expect(seen).toContain('console');
    });
});

// ── node-runtime ────────────────────────────────────────────────────────────

describe('Bridge — node-runtime', () => {
    it('accepts a node-runtime hello and routes its events to the shared session', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'core-node-'));
        const store = new JsonlStore(dir);
        const bridge = new Bridge({ store, taskStore: null, autoPurge: { enabled: false } });
        try {
            // The browser runtime-client created the shared session first.
            connect(bridge, 'runtime-client', { tabId: 'tab-1', sessionId: 'shared' });
            const node = connect(bridge, 'node-runtime', { projectId: 'demo', sessionId: 'shared' });
            expect(node.lastFrame().type).toBe('hello.ack');
            node.receive({ type: 'event', id: 'n1', name: 'node:log', ts: Date.now(), payload: { msg: 'server hit' } });
            await store.flush();
            const events = store.tail('shared', { n: 50, type: 'node:log' });
            expect(events).toHaveLength(1);
        } finally {
            await bridge.stop();
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
