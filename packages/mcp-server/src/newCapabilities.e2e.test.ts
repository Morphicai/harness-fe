/**
 * End-to-end tests for the capabilities added in the multi-tab observability
 * sweep: ws / storage event ingestion, initiator stack preservation, and the
 * `visitor.timeline` aggregation.
 *
 * These run a real Bridge + JsonlStore on tmpdir and a `ws` (node) client
 * pretending to be a runtime-client. We emit the exact event shapes the
 * patched runtime would emit and assert what the store + tools observe.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Bridge } from './bridge.js';
import { JsonlStore } from './store/index.js';
import type {
    EventFrame,
    HelloAckFrame,
    NetworkEntry,
    StorageEntry,
    WsEntry,
} from '@harness-fe/protocol';
import { buildVisitorTimeline } from './visitorTimeline.js';

interface TestEnv {
    bridge: Bridge;
    store: JsonlStore;
    dir: string;
    port: number;
}

const envs: TestEnv[] = [];

async function setup(): Promise<TestEnv> {
    const dir = mkdtempSync(join(tmpdir(), 'harness-e2e-'));
    const store = new JsonlStore(dir);
    const bridge = new Bridge({
        port: 0,
        host: '127.0.0.1',
        store,
        taskStore: null,
        autoPurge: { enabled: false },
    });
    await bridge.start();
    const port = bridge.getBoundPort();
    if (!port) throw new Error('no port');
    const env = { bridge, store, dir, port };
    envs.push(env);
    return env;
}

afterEach(async () => {
    while (envs.length > 0) {
        const env = envs.pop()!;
        await env.bridge.stop();
        env.store.close();
        rmSync(env.dir, { recursive: true, force: true });
    }
});

async function connectRuntimeClient(
    port: number,
    opts: { tabId: string; projectId: string; sessionId: string; visitorId?: string },
): Promise<WebSocket> {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise<void>((resolve, reject) => {
        ws.once('open', () => resolve());
        ws.once('error', reject);
    });
    ws.send(JSON.stringify({
        type: 'hello',
        id: 'h1',
        role: 'runtime-client',
        projectId: opts.projectId,
        tabId: opts.tabId,
        sessionId: opts.sessionId,
        visitorId: opts.visitorId,
        page: { url: 'http://localhost:5173/', title: 'Demo' },
    }));
    const ack = await new Promise<HelloAckFrame>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('hello.ack timeout')), 1000);
        ws.once('message', (raw) => {
            clearTimeout(timer);
            resolve(JSON.parse(raw.toString()) as HelloAckFrame);
        });
    });
    if (ack.error) throw new Error(`hello.ack error: ${ack.error}`);
    return ws;
}

function sendEvent(ws: WebSocket, name: string, payload: unknown, tabId: string, extras: Partial<EventFrame> = {}): void {
    ws.send(JSON.stringify({
        type: 'event',
        id: `evt-${randomUUID()}`,
        tabId,
        name,
        ts: Date.now(),
        payload,
        ...extras,
    } satisfies EventFrame));
}

/** Wait long enough for the bridge to ingest queued frames + flush JSONL. */
async function waitForIngestion(store: JsonlStore): Promise<void> {
    await new Promise((r) => setTimeout(r, 50));
    await store.flush();
}

describe('E2E — WebSocket frame ingestion', () => {
    it('routes ws events from runtime → bridge → jsonl with t="ws" and visitorId stamped', async () => {
        const env = await setup();
        const tabId = 't-ws';
        const projectId = 'demo';
        const sessionId = randomUUID();
        const visitorId = 'v-ws';

        const ws = await connectRuntimeClient(env.port, { tabId, projectId, sessionId, visitorId });

        // Mirror what runtime-client's wsPatch would emit.
        const wsId = randomUUID();
        sendEvent(ws, 'ws', { ts: Date.now(), id: wsId, phase: 'open', url: 'wss://chat.test/', protocols: ['v1'], initiator: { stack: 'Error\n  at userCode' } } satisfies WsEntry, tabId);
        sendEvent(ws, 'ws', { ts: Date.now(), id: wsId, phase: 'send', url: 'wss://chat.test/', payload: { type: 'ping' }, initiator: { stack: 'Error\n  at sendPing' } } satisfies WsEntry, tabId);
        sendEvent(ws, 'ws', { ts: Date.now(), id: wsId, phase: 'recv', url: 'wss://chat.test/', payload: { type: 'kick', reason: 'duplicate-login' } } satisfies WsEntry, tabId);
        sendEvent(ws, 'ws', { ts: Date.now(), id: wsId, phase: 'close', url: 'wss://chat.test/', code: 4001, reason: 'duplicate-login', wasClean: false } satisfies WsEntry, tabId);

        await waitForIngestion(env.store);
        ws.close();

        const events = env.store.tail(sessionId, { n: 50 });
        const wsEvents = events.filter((e) => e.t === 'ws');
        expect(wsEvents).toHaveLength(4);
        expect(wsEvents.map((e) => (e.d as WsEntry).phase)).toEqual(['open', 'send', 'recv', 'close']);
        // Every persisted ws row carries visitorId from the runtime hello.
        expect(wsEvents.every((e) => e.visitorId === visitorId)).toBe(true);
        // Close event preserves code/reason — proves the schema travels intact.
        const close = wsEvents.find((e) => (e.d as WsEntry).phase === 'close')!;
        expect((close.d as WsEntry).code).toBe(4001);
        expect((close.d as WsEntry).reason).toBe('duplicate-login');
        // Initiator on 'send' survives the round-trip.
        const send = wsEvents.find((e) => (e.d as WsEntry).phase === 'send')!;
        expect((send.d as WsEntry).initiator?.stack).toContain('sendPing');
    });

    it('session.tail filtered by t=ws returns only ws rows', async () => {
        const env = await setup();
        const tabId = 't-mix';
        const projectId = 'demo';
        const sessionId = randomUUID();
        const ws = await connectRuntimeClient(env.port, { tabId, projectId, sessionId });
        const wsId = randomUUID();

        sendEvent(ws, 'ws', { ts: Date.now(), id: wsId, phase: 'open', url: 'wss://x/' } satisfies WsEntry, tabId);
        sendEvent(ws, 'network', { ts: Date.now(), id: 'r1', phase: 'req', method: 'GET', url: 'https://api.test/' } satisfies NetworkEntry, tabId);

        await waitForIngestion(env.store);
        ws.close();

        const wsOnly = env.store.tail(sessionId, { n: 50, type: 'ws' });
        expect(wsOnly).toHaveLength(1);
        expect((wsOnly[0].d as WsEntry).phase).toBe('open');
    });
});

describe('E2E — storage event ingestion', () => {
    it('persists storage mutations with initiator stack and crossTab flag', async () => {
        const env = await setup();
        const tabId = 't-storage';
        const projectId = 'demo';
        const sessionId = randomUUID();
        const visitorId = 'v-storage';
        const ws = await connectRuntimeClient(env.port, { tabId, projectId, sessionId, visitorId });

        sendEvent(ws, 'storage', { ts: Date.now(), op: 'set', which: 'local', key: 'token', value: 'abc', initiator: { stack: 'Error\n  at setToken' } } satisfies StorageEntry, tabId);
        sendEvent(ws, 'storage', { ts: Date.now(), op: 'remove', which: 'local', key: 'token', initiator: { stack: 'Error\n  at logout' } } satisfies StorageEntry, tabId);
        sendEvent(ws, 'storage', { ts: Date.now(), op: 'remove', which: 'local', key: 'token', crossTab: true } satisfies StorageEntry, tabId);

        await waitForIngestion(env.store);
        ws.close();

        const rows = env.store.tail(sessionId, { n: 50, type: 'storage' });
        expect(rows).toHaveLength(3);

        const logoutRow = rows.find((r) => (r.d as StorageEntry).op === 'remove' && !(r.d as StorageEntry).crossTab);
        expect(logoutRow).toBeDefined();
        expect((logoutRow!.d as StorageEntry).initiator?.stack).toContain('logout');

        const crossTabRow = rows.find((r) => (r.d as StorageEntry).crossTab);
        expect(crossTabRow).toBeDefined();
        expect((crossTabRow!.d as StorageEntry).initiator).toBeUndefined();
    });
});

describe('E2E — network initiator stack round-trip', () => {
    it('preserves initiator stack across bridge ingestion', async () => {
        const env = await setup();
        const tabId = 't-net';
        const projectId = 'demo';
        const sessionId = randomUUID();
        const ws = await connectRuntimeClient(env.port, { tabId, projectId, sessionId });

        sendEvent(ws, 'network', {
            ts: Date.now(),
            id: 'r1',
            phase: 'req',
            method: 'POST',
            url: 'https://api.test/logout',
            initiator: { stack: 'Error\n  at AppLogout.tsx:42\n  at clickHandler' },
        } satisfies NetworkEntry, tabId);

        await waitForIngestion(env.store);
        ws.close();

        const rows = env.store.tail(sessionId, { n: 10, type: 'network' });
        expect(rows).toHaveLength(1);
        const entry = rows[0].d as NetworkEntry;
        expect(entry.initiator?.stack).toContain('AppLogout.tsx:42');
    });
});

describe('E2E — visitor.timeline across two tabs', () => {
    it('merges ws + storage + network events from two tabs into one ascending timeline', async () => {
        const env = await setup();
        const projectId = 'tanka';
        const visitorId = 'v-cross';

        // Tab A: ws connection.
        const tabA = 't-a';
        const sessA = randomUUID();
        const wsA = await connectRuntimeClient(env.port, { tabId: tabA, projectId, sessionId: sessA, visitorId });

        // Tab B: storage + network in a separate session.
        const tabB = 't-b';
        const sessB = randomUUID();
        const wsB = await connectRuntimeClient(env.port, { tabId: tabB, projectId, sessionId: sessB, visitorId });

        const t0 = Date.now();
        const wsId = randomUUID();
        // Tab A receives a kick frame.
        sendEvent(wsA, 'ws', { ts: t0 + 10, id: wsId, phase: 'recv', url: 'wss://x/', payload: { type: 'kick' } } satisfies WsEntry, tabA);
        // Tab B's network call to /sync runs.
        sendEvent(wsB, 'network', { ts: t0 + 20, id: 'r1', phase: 'req', method: 'POST', url: 'https://api.test/sync' } satisfies NetworkEntry, tabB);
        // Tab B then drops the local token.
        sendEvent(wsB, 'storage', { ts: t0 + 30, op: 'remove', which: 'local', key: 'token', initiator: { stack: 'at clearToken' } } satisfies StorageEntry, tabB);

        await waitForIngestion(env.store);
        wsA.close();
        wsB.close();

        const result = buildVisitorTimeline(env.store, visitorId);
        if ('error' in result) throw new Error(result.error);

        expect(result.sessionCount).toBe(2);
        // Ascending by ts.
        const tsSeq = result.events.map((e) => e.ts);
        expect(tsSeq).toEqual([...tsSeq].sort((a, b) => a - b));
        // All three event types are present.
        const types = new Set(result.events.map((e) => e.t));
        expect(types.has('ws')).toBe(true);
        expect(types.has('storage')).toBe(true);
        expect(types.has('network')).toBe(true);
        // Tab attribution is visible — both tabs contributed.
        const tabs = new Set(result.events.map((e) => e.tab));
        expect(tabs.has(tabA)).toBe(true);
        expect(tabs.has(tabB)).toBe(true);
    });

    it('does not leak another visitor\'s events into the timeline', async () => {
        const env = await setup();
        const projectId = 'tanka';
        const myVisitor = 'v-mine';
        const otherVisitor = 'v-other';
        const tabId = 't-shared';
        const sessionId = randomUUID();
        const myWs = await connectRuntimeClient(env.port, { tabId, projectId, sessionId, visitorId: myVisitor });

        // Same session, but synthesize a row tagged with another visitor by
        // writing directly through the store (mirrors the real-world case
        // where a session is shared, e.g. iframes from different origins).
        sendEvent(myWs, 'network', { ts: Date.now(), id: 'mine', phase: 'req', method: 'GET', url: '/mine' } satisfies NetworkEntry, tabId);

        await waitForIngestion(env.store);
        // Inject a foreign-visitor row directly into the same session.
        env.store.appendEvent(sessionId, {
            ts: Date.now(),
            t: 'network',
            tab: tabId,
            visitorId: otherVisitor,
            d: { id: 'other', phase: 'req', method: 'GET', url: '/other' } as NetworkEntry,
        });
        await env.store.flush();
        myWs.close();

        const result = buildVisitorTimeline(env.store, myVisitor);
        if ('error' in result) throw new Error(result.error);
        expect(result.events.every((e) => e.visitorId === myVisitor)).toBe(true);
        const urls = result.events.map((e) => (e.d as NetworkEntry).url);
        expect(urls).toContain('/mine');
        expect(urls).not.toContain('/other');
    });
});
