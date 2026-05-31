import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { createCoreClient, type CoreClient } from '@harness-fe/core';
import { GatewayStore } from './store.js';
import { createGateway, type GatewayHandle } from './server.js';
import { Policy } from './policy.js';

// ── minimal MCP-over-HTTP client ──────────────────────────────────────────────

function parseMaybeSse(text: string): any {
    try {
        return JSON.parse(text);
    } catch {
        /* SSE */
    }
    const dataLines = text.split('\n').filter((l) => l.startsWith('data:'));
    for (const l of dataLines.reverse()) {
        try {
            return JSON.parse(l.slice(5).trim());
        } catch {
            /* keep looking */
        }
    }
    return null;
}

async function rpc(base: string, token: string | undefined, body: unknown, sessionId?: string) {
    const headers: Record<string, string> = {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
    };
    if (token) headers.authorization = `Bearer ${token}`;
    if (sessionId) headers['mcp-session-id'] = sessionId;
    const r = await fetch(`${base}/mcp`, { method: 'POST', headers, body: JSON.stringify(body) });
    const sid = r.headers.get('mcp-session-id') ?? sessionId;
    const text = await r.text();
    return { status: r.status, sid: sid ?? undefined, json: text ? parseMaybeSse(text) : null };
}

/** initialize → notify initialized → return session id. Throws on non-200. */
async function connect(base: string, token?: string): Promise<string> {
    const init = await rpc(base, token, {
        jsonrpc: '2.0', id: 1, method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '1' } },
    });
    if (init.status !== 200 || !init.sid) throw new Error(`initialize failed: ${init.status}`);
    await rpc(base, token, { jsonrpc: '2.0', method: 'notifications/initialized' }, init.sid);
    return init.sid;
}

async function toolNames(base: string, token: string | undefined, sid: string): Promise<string[]> {
    const r = await rpc(base, token, { jsonrpc: '2.0', id: 2, method: 'tools/list' }, sid);
    const tools = r.json?.result?.tools ?? [];
    return (tools as Array<{ name: string }>).map((t) => t.name);
}

async function callTool(base: string, token: string | undefined, sid: string, name: string, args: Record<string, unknown> = {}) {
    return rpc(base, token, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name, arguments: args } }, sid);
}

// ── Open policy ────────────────────────────────────────────────────────────────

describe('gateway e2e — Open policy (solo)', () => {
    let core: CoreClient;
    let gw: GatewayHandle;
    let base: string;

    beforeEach(async () => {
        core = createCoreClient({ store: null, taskStore: null, autoPurge: { enabled: false } });
        await core.start();
        gw = createGateway({ coreClient: core, policy: new Policy({ mode: 'open' }) });
        base = `http://127.0.0.1:${await gw.listen(0)}`;
    });
    afterEach(async () => { await gw.close(); await core.stop(); });

    it('no token: full toolset + a read call works', async () => {
        const sid = await connect(base);
        const names = await toolNames(base, undefined, sid);
        expect(names).toContain('page.click');     // control allowed under Open
        expect(names).toContain('session.list');   // read
        expect(names).toContain('tab.list');
        const res = await callTool(base, undefined, sid, 'tab.list');
        expect(res.json?.result?.content?.[0]?.text).toBe('[]'); // no tabs connected
    });
});

// ── Governed policy ──────────────────────────────────────────────────────────

describe('gateway e2e — Governed policy (team)', () => {
    let dir: string;
    let store: GatewayStore;
    let core: CoreClient;
    let gw: GatewayHandle;
    let base: string;
    let agentA: string; // read+control, projects=[demo]
    let agentB: string; // read only
    let runtimeTok: string; // write only

    beforeEach(async () => {
        dir = mkdtempSync(join(tmpdir(), 'hfe-gw-e2e-'));
        store = new GatewayStore(dir);
        const srv = store.addServer({ name: 'local', endpoint: 'in-process', env: 'local' });
        agentA = store.createToken({ name: 'A', serverId: srv.id, scopes: ['read', 'control'], projects: ['demo'] }).raw;
        agentB = store.createToken({ name: 'B', serverId: srv.id, scopes: ['read'] }).raw;
        runtimeTok = store.createToken({ name: 'rt', serverId: srv.id, scopes: ['write'], projects: ['demo'] }).raw;
        core = createCoreClient({ store: null, taskStore: null, autoPurge: { enabled: false } });
        await core.start();
        gw = createGateway({ coreClient: core, policy: new Policy({ mode: 'governed', store }), store });
        base = `http://127.0.0.1:${await gw.listen(0)}`;
    });
    afterEach(async () => { await gw.close(); await core.stop(); rmSync(dir, { recursive: true, force: true }); });

    it('rejects MCP with no token (401)', async () => {
        const init = await rpc(base, undefined, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '1' } } });
        expect(init.status).toBe(401);
    });

    it('manifest is scoped: agentB (read) sees no control tools; agentA (read+control) does', async () => {
        const sidB = await connect(base, agentB);
        const namesB = await toolNames(base, agentB, sidB);
        expect(namesB).toContain('session.list');
        expect(namesB).not.toContain('page.click');
        expect(namesB).not.toContain('page.evaluate');

        const sidA = await connect(base, agentA);
        const namesA = await toolNames(base, agentA, sidA);
        expect(namesA).toContain('page.click');
        expect(namesA).toContain('session.list');
    });

    it('a write-only runtime token gets an empty agent manifest (no read/control tools)', async () => {
        const sid = await connect(base, runtimeTok);
        const names = await toolNames(base, runtimeTok, sid);
        expect(names).toEqual([]);
    });

    it('agentB cannot invoke a control tool (scope denied)', async () => {
        const sid = await connect(base, agentB);
        const res = await callTool(base, agentB, sid, 'page.click', { selector: { css: '#x' } });
        // Either an MCP error (tool not registered) or a capability scope error — never a success result.
        const ok = res.json?.result && !res.json?.result?.isError;
        expect(ok).toBeFalsy();
    });

    it('audits MCP calls', async () => {
        const sid = await connect(base, agentA);
        await callTool(base, agentA, sid, 'tab.list');
        const audit = store.listAudit();
        expect(audit.length).toBeGreaterThan(0);
        expect(audit.some((a) => a.tokenId)).toBe(true);
    });

    it('runtime reports over /ws and agentA can read + drive it', async () => {
        // Runtime connects with its write token.
        const ws = new WebSocket(`${base.replace('http', 'ws')}/ws?token=${encodeURIComponent(runtimeTok)}`);
        await new Promise<void>((resolve, reject) => {
            ws.once('open', () => resolve());
            ws.once('error', reject);
        });
        // hello → ack
        const ack = await new Promise<any>((resolve) => {
            ws.once('message', (raw) => resolve(JSON.parse(raw.toString())));
            ws.send(JSON.stringify({ type: 'hello', id: 'h1', role: 'runtime-client', projectId: 'demo', tabId: 't1', sessionId: 's1', page: {} }));
        });
        expect(ack.type).toBe('hello.ack');

        // Auto-answer the next command frame so a drive round-trips.
        ws.on('message', (raw) => {
            const f = JSON.parse(raw.toString());
            if (f.type === 'command') ws.send(JSON.stringify({ type: 'response', id: f.id, ok: true, result: { clicked: true } }));
        });

        const sid = await connect(base, agentA);
        const tabs = await callTool(base, agentA, sid, 'tab.list');
        expect(tabs.json?.result?.content?.[0]?.text).toContain('t1');

        const click = await callTool(base, agentA, sid, 'page.click', { selector: { css: '#go' }, tabId: 't1' });
        expect(click.json?.result?.content?.[0]?.text).toContain('clicked');

        ws.close();
    });
});
