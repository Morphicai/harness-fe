import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { COMMAND, EVENT_NAME } from '@harness-fe/protocol';
import { Bridge } from '../bridge.js';
import { JsonlStore, JsonTaskStore } from '../store/index.js';
import { LOCAL_PRINCIPAL, type Principal } from '../identity.js';
import { FakePeerSocket } from '../test-utils.js';
import { CoreCapabilities, ScopeDeniedError } from './index.js';

const writeOnly: Principal = { id: 'token:runtime', kind: 'token', scopes: { write: true } };
const reader: Principal = { id: 'token:r', kind: 'token', scopes: { read: true } };
const controller: Principal = { id: 'token:c', kind: 'token', scopes: { read: true, control: true }, projects: ['demo'] };

function connectRuntime(bridge: Bridge, tabId = 'tab-1', sessionId = 'sess-1', principal = LOCAL_PRINCIPAL): FakePeerSocket {
    const sock = new FakePeerSocket();
    bridge.acceptPeer(sock, principal);
    sock.receive({ type: 'hello', id: 'h1', role: 'runtime-client', projectId: 'demo', tabId, sessionId, page: {} });
    return sock;
}

describe('capability — scope enforcement (write-only deny)', () => {
    let bridge: Bridge;
    let caps: CoreCapabilities;
    beforeEach(() => { bridge = new Bridge({ store: null, taskStore: null, autoPurge: { enabled: false } }); caps = new CoreCapabilities(bridge); });
    afterEach(async () => { await bridge.stop(); });

    it('write-only principal is denied a control command', async () => {
        await expect(caps.command(COMMAND.PAGE_CLICK, {}, writeOnly)).rejects.toBeInstanceOf(ScopeDeniedError);
    });

    it('write-only principal is denied a read command (*.tail) and reads', async () => {
        await expect(caps.command(COMMAND.CONSOLE_TAIL, {}, writeOnly)).rejects.toBeInstanceOf(ScopeDeniedError);
        await expect(caps.listTabs(writeOnly)).rejects.toBeInstanceOf(ScopeDeniedError);
        await expect(caps.tasksPending(writeOnly)).rejects.toBeInstanceOf(ScopeDeniedError);
    });

    it('read-only principal is denied a control command but allowed reads', async () => {
        await expect(caps.command(COMMAND.PAGE_CLICK, {}, reader)).rejects.toBeInstanceOf(ScopeDeniedError);
        await expect(caps.listTabs(reader)).resolves.toEqual([]);
    });

    it('ScopeDeniedError carries a stable code + the missing scope', async () => {
        const e = await caps.command(COMMAND.PAGE_CLICK, {}, reader).catch((x) => x);
        expect(e).toBeInstanceOf(ScopeDeniedError);
        expect(e.code).toBe('scope_denied');
        expect(e.requiredScope).toBe('control');
    });

    it('a control command with a connected tab forwards through the bridge (local)', async () => {
        const sock = connectRuntime(bridge);
        const p = caps.command(COMMAND.PAGE_CLICK, { selector: { css: '#x' } }, LOCAL_PRINCIPAL, { tabId: 'tab-1' });
        const cmd = sock.framesOfType('command').at(-1);
        expect(cmd.command).toBe(COMMAND.PAGE_CLICK);
        sock.receive({ type: 'response', id: cmd.id, ok: true, result: { ok: true } });
        await expect(p).resolves.toEqual({ ok: true });
    });

    it('a controller bound to the project can drive the tab', async () => {
        const sock = connectRuntime(bridge, 'tab-1', 'sess-1', writeOnly); // runtime registers as write principal
        const p = caps.command(COMMAND.PAGE_CLICK, { selector: { css: '#x' } }, controller, { tabId: 'tab-1' });
        const cmd = sock.framesOfType('command').at(-1);
        sock.receive({ type: 'response', id: cmd.id, ok: true, result: 1 });
        await expect(p).resolves.toBe(1);
    });
});

describe('capability — tenant visibility', () => {
    let dir: string;
    let bridge: Bridge;
    let caps: CoreCapabilities;
    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'core-cap-'));
        bridge = new Bridge({ store: new JsonlStore(dir), taskStore: new JsonTaskStore(dir), autoPurge: { enabled: false } });
        caps = new CoreCapabilities(bridge);
    });
    afterEach(async () => { await bridge.stop(); rmSync(dir, { recursive: true, force: true }); });

    it('sessionList returns [] when the caller cannot see the project, data otherwise', async () => {
        // Runtime connects as a token principal → session.createdBy = token:runtime.
        connectRuntime(bridge, 'tab-1', 'sess-1', writeOnly);
        // Unbound named reader does NOT own the project → empty.
        await expect(caps.sessionList(reader, 'demo')).resolves.toEqual([]);
        // Bound controller (projects:['demo']) sees the project's sessions.
        const seen = await caps.sessionList(controller, 'demo');
        expect(seen.length).toBeGreaterThan(0);
        // local sees everything.
        expect((await caps.sessionList(LOCAL_PRINCIPAL, 'demo')).length).toBeGreaterThan(0);
    });

    it('tasksPending filters to projects the caller may see', async () => {
        const sock = connectRuntime(bridge, 'tab-1', 'sess-1', writeOnly);
        sock.receive({
            type: 'event', id: 'tk', name: EVENT_NAME.TASK_SUBMIT, ts: Date.now(), tabId: 'tab-1',
            payload: { question: 'q', selector: { css: '#a' }, url: 'http://x/', element: { tag: 'div', outerHTML: '<div/>' } },
        });
        expect(await caps.tasksPending(reader)).toHaveLength(0);            // unbound named → none
        expect((await caps.tasksPending(controller)).length).toBeGreaterThan(0); // bound → sees it
        expect((await caps.tasksPending(LOCAL_PRINCIPAL)).length).toBeGreaterThan(0); // local → all
    });
});

describe('capability — memory + replay', () => {
    let dir: string;
    let store: JsonlStore;
    let bridge: Bridge;
    let caps: CoreCapabilities;
    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'core-cap2-'));
        store = new JsonlStore(dir);
        bridge = new Bridge({ store, taskStore: null, viewerBaseUrl: 'http://gw.test', autoPurge: { enabled: false } });
        caps = new CoreCapabilities(bridge);
    });
    afterEach(async () => { await bridge.stop(); rmSync(dir, { recursive: true, force: true }); });

    it('memory set/get round-trips under read scope; write-only denied', async () => {
        await expect(caps.memorySet(writeOnly, 'demo', 'k', 'v')).rejects.toBeInstanceOf(ScopeDeniedError);
        await caps.memorySet(reader, 'demo', 'k', 'v');
        const got = await caps.memoryGet(reader, 'demo', 'k');
        expect(got).toMatchObject({ found: true, value: 'v' });
    });

    it('replayCreate produces a viewer URL on the injected gateway base', async () => {
        const sock = connectRuntime(bridge, 'tab-1', 'sess-rep', LOCAL_PRINCIPAL);
        const now = Date.now();
        sock.receive({
            type: 'event', id: 'r1', name: EVENT_NAME.RRWEB, ts: now, tabId: 'tab-1',
            payload: { chunkId: 'c1', tabId: 'tab-1', startTs: now, endTs: now + 100, eventCount: 2, events: [{ type: 4, data: {}, timestamp: now }, { type: 2, data: {}, timestamp: now }] },
        });
        await store.flush();
        const result = await caps.replayCreate(LOCAL_PRINCIPAL, { sessionId: 'sess-rep', ts: now, windowMs: 1000 }) as { viewerUrl?: string };
        expect(typeof result.viewerUrl).toBe('string');
        expect(result.viewerUrl).toContain('http://gw.test');
    });
});
