/**
 * System acceptance e2e — one governed gateway + in-process core, exercised
 * through real clients across every access surface so a green run means the
 * whole product wires up correctly (no manual demo needed):
 *
 *   MCP (agents)        agentA[read,control] full · agentB[read] denied control · no token → 401 · audited
 *   /ws (upload端)        a write-token runtime reports an event → it lands in the store
 *   /console (后台)       agent token → scoped to its projects · admin → all · no creds → 401
 *   /admin (治理)         API gated by the admin session
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { InProcessCoreClient } from '@harness-fe/core';
import { GatewayStore } from './store.js';
import { createGateway, type GatewayHandle } from './server.js';
import { Policy } from './policy.js';

// ── minimal MCP-over-HTTP client ──────────────────────────────────────────────
function parseMaybeSse(text: string): any {
    try { return JSON.parse(text); } catch { /* sse */ }
    for (const l of text.split('\n').filter((x) => x.startsWith('data:')).reverse()) {
        try { return JSON.parse(l.slice(5).trim()); } catch { /* keep */ }
    }
    return null;
}
async function rpc(base: string, token: string | undefined, body: unknown, sid?: string) {
    const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
    if (token) headers.authorization = `Bearer ${token}`;
    if (sid) headers['mcp-session-id'] = sid;
    const r = await fetch(`${base}/mcp`, { method: 'POST', headers, body: JSON.stringify(body) });
    const text = await r.text();
    return { status: r.status, sid: r.headers.get('mcp-session-id') ?? sid, json: text ? parseMaybeSse(text) : null };
}
async function mcpConnect(base: string, token?: string): Promise<string> {
    const init = await rpc(base, token, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '1' } } });
    if (init.status !== 200 || !init.sid) throw new Error(`initialize failed: ${init.status}`);
    await rpc(base, token, { jsonrpc: '2.0', method: 'notifications/initialized' }, init.sid);
    return init.sid;
}
async function toolNames(base: string, token: string | undefined, sid: string): Promise<string[]> {
    const r = await rpc(base, token, { jsonrpc: '2.0', id: 2, method: 'tools/list' }, sid);
    return ((r.json?.result?.tools ?? []) as Array<{ name: string }>).map((t) => t.name);
}
async function callTool(base: string, token: string | undefined, sid: string, name: string, args: Record<string, unknown> = {}) {
    return rpc(base, token, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name, arguments: args } }, sid);
}

// ── console / admin helpers ───────────────────────────────────────────────────
async function getJson(base: string, path: string, headers: Record<string, string> = {}) {
    const r = await fetch(`${base}${path}`, { headers });
    let body: any = null;
    try { body = await r.json(); } catch { /* non-json */ }
    return { status: r.status, body };
}
async function adminLogin(base: string): Promise<string> {
    const r = await fetch(`${base}/admin/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ username: 'root', password: 'pw' }).toString(),
        redirect: 'manual',
    });
    const setCookie = r.headers.get('set-cookie') ?? '';
    const cookie = setCookie.split(';')[0];
    if (!cookie.startsWith('hfe_gw_admin=')) throw new Error('admin login did not set a cookie');
    return cookie;
}

describe('system e2e — all access surfaces against one governed gateway', () => {
    let dir: string;
    let coreDir: string;
    let store: GatewayStore;
    let core: InProcessCoreClient;
    let gw: GatewayHandle;
    let base: string;
    let runtimeTok: string; // write, projects=[app-a]
    let agentA: string;     // read+control, projects=[app-a]
    let agentB: string;     // read, projects=[app-b]
    let agentAll: string;   // read, NO projects grant → should see everything (#161)

    beforeEach(async () => {
        dir = mkdtempSync(join(tmpdir(), 'hfe-sys-gw-'));
        coreDir = mkdtempSync(join(tmpdir(), 'hfe-sys-core-'));
        store = new GatewayStore(dir);
        store.addAdmin('root', 'pw');
        const srv = store.addServer({ name: 'local', endpoint: 'in-process', env: 'local' });
        runtimeTok = store.createToken({ name: 'rt', serverId: srv.id, scopes: ['write'], projects: ['app-a'] }).raw;
        agentA = store.createToken({ name: 'A', serverId: srv.id, scopes: ['read', 'control'], projects: ['app-a'] }).raw;
        agentB = store.createToken({ name: 'B', serverId: srv.id, scopes: ['read'], projects: ['app-b'] }).raw;
        // read token issued WITHOUT a projects= list — store docs "undefined = all".
        agentAll = store.createToken({ name: 'all', serverId: srv.id, scopes: ['read'] }).raw;

        core = new InProcessCoreClient({ dataDir: coreDir, taskStore: null, autoPurge: { enabled: false } });
        await core.start();
        // Seed two projects, each with a session, so console scoping is observable.
        const s = core.bridge.store!;
        for (const pid of ['app-a', 'app-b']) {
            s.upsertProject(pid, { displayName: pid, createdBy: 'local' });
            s.upsertSession(`sess-${pid}`, { tabId: 't', startedAt: Date.now(), participants: [{ projectId: pid, joinedAt: Date.now() }] });
        }
        // Edge sessions for the visibility fix (#161): one with no project on its
        // participant, and one whose project-owning participant isn't first. Both
        // were wrongly dropped from the list — even for admin — by the old filter.
        s.upsertSession('sess-orphan', { tabId: 't', startedAt: Date.now(), participants: [{ projectId: '', joinedAt: Date.now() }] });
        s.upsertSession('sess-multi', { tabId: 't', startedAt: Date.now(), participants: [{ projectId: '', joinedAt: Date.now() }, { projectId: 'app-a', joinedAt: Date.now() }] });
        await s.flush();

        gw = createGateway({ coreClient: core, policy: new Policy({ mode: 'governed', store }), store });
        base = `http://127.0.0.1:${await gw.listen(0)}`;
    });
    afterEach(async () => {
        await gw.close();
        await core.stop();
        rmSync(dir, { recursive: true, force: true });
        rmSync(coreDir, { recursive: true, force: true });
    });

    // ── MCP (agents) ──────────────────────────────────────────────────────────
    it('MCP: agentA drives + agentB is read-only + no token is rejected + calls are audited', async () => {
        const noTok = await rpc(base, undefined, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '1' } } });
        expect(noTok.status).toBe(401);

        const sidA = await mcpConnect(base, agentA);
        const namesA = await toolNames(base, agentA, sidA);
        expect(namesA).toContain('page.click');
        expect(namesA).toContain('session.list');
        const tab = await callTool(base, agentA, sidA, 'tab.list');
        expect(tab.json?.result?.content?.[0]?.text).toBe('[]');

        const sidB = await mcpConnect(base, agentB);
        const namesB = await toolNames(base, agentB, sidB);
        expect(namesB).not.toContain('page.click');
        const denied = await callTool(base, agentB, sidB, 'page.click', { selector: { css: '#x' } });
        expect(denied.json?.result && !denied.json.result.isError).toBeFalsy();

        expect(store.listAudit().length).toBeGreaterThan(0);
    });

    // ── /ws (upload端) ──────────────────────────────────────────────────────────
    it('upload: a write-token runtime reports an event that lands in the store', async () => {
        const ws = new WebSocket(`${base.replace('http', 'ws')}/ws?token=${encodeURIComponent(runtimeTok)}`);
        await new Promise<void>((resolve, reject) => { ws.once('open', () => resolve()); ws.once('error', reject); });
        const ack = await new Promise<any>((resolve) => {
            ws.once('message', (m) => resolve(JSON.parse(m.toString())));
            ws.send(JSON.stringify({ type: 'hello', id: 'h', role: 'runtime-client', projectId: 'app-a', tabId: 'tab-up', sessionId: 'sess-app-a', visitorId: 'v1', page: { url: 'http://x/' } }));
        });
        expect(ack.type).toBe('hello.ack');
        ws.send(JSON.stringify({ type: 'event', id: 'e1', name: 'console', ts: Date.now(), tabId: 'tab-up', payload: { level: 'log', args: ['from runtime'] } }));

        const s = core.bridge.store!;
        let rows: unknown[] = [];
        for (let i = 0; i < 30; i++) {
            await s.flush();
            rows = s.tail('sess-app-a', { n: 50, type: 'console' });
            if (rows.length > 0) break;
            await new Promise((r) => setTimeout(r, 30));
        }
        ws.close();
        expect(rows.length).toBeGreaterThan(0);
    });

    it('upload: a write-only token cannot reach the agent toolset (empty manifest)', async () => {
        const sid = await mcpConnect(base, runtimeTok);
        expect(await toolNames(base, runtimeTok, sid)).toEqual([]);
    });

    // ── /console (后台) — scoped by token, admin sees all ──────────────────────
    it('console: agent token sees only its projects; admin sees all; no creds → 401', async () => {
        // no creds → 401
        expect((await getJson(base, '/console/api/projects')).status).toBe(401);

        // agentA (projects=[app-a]) → only app-a
        const a = await getJson(base, '/console/api/projects', { authorization: `Bearer ${agentA}` });
        expect(a.status).toBe(200);
        expect(a.body.projects.map((e: any) => e.project.id).sort()).toEqual(['app-a']);

        // agentB (projects=[app-b]) → only app-b
        const b = await getJson(base, '/console/api/projects', { authorization: `Bearer ${agentB}` });
        expect(b.body.projects.map((e: any) => e.project.id).sort()).toEqual(['app-b']);

        // admin session → all
        const cookie = await adminLogin(base);
        const all = await getJson(base, '/console/api/projects', { cookie });
        expect(all.body.projects.map((e: any) => e.project.id).sort()).toEqual(['app-a', 'app-b']);
    });

    it('console: a read token with no projects= grant sees ALL projects (harness-fe#161)', async () => {
        // Was the footgun: a read token issued without projects= saw nothing,
        // because core default-denies a token principal with no grant. The
        // gateway now materializes the documented "undefined = all" into ['*'].
        const r = await getJson(base, '/console/api/projects', { authorization: `Bearer ${agentAll}` });
        expect(r.status).toBe(200);
        expect(r.body.projects.map((e: any) => e.project.id).sort()).toEqual(['app-a', 'app-b']);
        // and it can read a session in any project
        const sess = await getJson(base, '/console/api/sessions/sess-app-b', { authorization: `Bearer ${agentAll}` });
        expect(sess.status).toBe(200);
    });

    it('console: admin sees sessions with empty / non-first project participants (harness-fe#161)', async () => {
        const cookie = await adminLogin(base);
        const all = await getJson(base, '/console/api/sessions', { cookie });
        expect(all.status).toBe(200);
        const ids = all.body.sessions.map((s: any) => s.id);
        expect(ids).toContain('sess-orphan'); // empty projectId — dropped by old !!projectId short-circuit
        expect(ids).toContain('sess-multi');  // owning participant wasn't participants[0]
    });

    it('console: a scoped token still does NOT see unowned/other sessions (no regression)', async () => {
        // agentB is scoped to app-b; it must not gain visibility into the
        // empty-project orphan session via the relaxed filter.
        const r = await getJson(base, '/console/api/sessions?projectId=app-b', { authorization: `Bearer ${agentB}` });
        expect(r.status).toBe(200);
        const ids = r.body.sessions.map((s: any) => s.id);
        expect(ids).toContain('sess-app-b');
        expect(ids).not.toContain('sess-orphan');
        expect(ids).not.toContain('sess-app-a');
    });

    it('console: a token cannot read a session outside its projects (404)', async () => {
        // agentA may read app-a's session…
        const ok = await getJson(base, '/console/api/sessions/sess-app-a', { authorization: `Bearer ${agentA}` });
        expect(ok.status).toBe(200);
        expect(ok.body.session?.id).toBe('sess-app-a');
        // …but not app-b's (scoped out → 404, no existence leak).
        const denied = await getJson(base, '/console/api/sessions/sess-app-b', { authorization: `Bearer ${agentA}` });
        expect(denied.status).toBe(404);
    });

    it('console: a write-only token is denied the data API (403, no read scope)', async () => {
        const r = await getJson(base, '/console/api/projects', { authorization: `Bearer ${runtimeTok}` });
        expect(r.status).toBe(403);
    });

    it('console: whoami reports the auth gate (unauth / token-scoped / admin-all / write-only)', async () => {
        const anon = await getJson(base, '/console/api/whoami');
        expect(anon.body).toMatchObject({ mode: 'governed', authenticated: false });

        const a = await getJson(base, '/console/api/whoami', { authorization: `Bearer ${agentA}` });
        expect(a.body).toMatchObject({ authenticated: true, kind: 'token' });
        expect(a.body.projects).toEqual(['app-a']);

        const rt = await getJson(base, '/console/api/whoami', { authorization: `Bearer ${runtimeTok}` });
        expect(rt.body.authenticated).toBe(false); // write-only can't read → not a console viewer

        const cookie = await adminLogin(base);
        const admin = await getJson(base, '/console/api/whoami', { cookie });
        expect(admin.body).toMatchObject({ authenticated: true, kind: 'admin', projects: '*' });
    });

    // ── /admin (治理) ───────────────────────────────────────────────────────────
    it('admin: API requires the admin session', async () => {
        expect((await getJson(base, '/admin/api/tokens')).status).toBe(401);
        const cookie = await adminLogin(base);
        const list = await getJson(base, '/admin/api/tokens', { cookie });
        expect(list.status).toBe(200);
        expect(Array.isArray(list.body)).toBe(true);
        expect(list.body.length).toBeGreaterThanOrEqual(3); // rt + A + B
    });
});
