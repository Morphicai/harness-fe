import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GatewayStore } from './store.js';
import { createGateway, type GatewayHandle } from './server.js';

interface Received {
    method?: string;
    headers: Record<string, string | string[] | undefined>;
    body: string;
}

describe('gateway HTTP proxy (5.0 · P6 · C3)', () => {
    let dir: string;
    let store: GatewayStore;
    let gw: GatewayHandle;
    let gwPort: number;
    let daemon: Server;
    let daemonPort: number;
    let received: Received[];

    beforeEach(async () => {
        dir = mkdtempSync(join(tmpdir(), 'hfe-gw-proxy-'));
        store = new GatewayStore(dir);
        received = [];
        daemon = createServer((req, res) => {
            const chunks: Buffer[] = [];
            req.on('data', (c) => chunks.push(c as Buffer));
            req.on('end', () => {
                received.push({ method: req.method, headers: req.headers, body: Buffer.concat(chunks).toString('utf8') });
                res.statusCode = 200;
                res.setHeader('content-type', 'application/json');
                res.end(JSON.stringify({ jsonrpc: '2.0', result: { ok: true }, id: 1 }));
            });
        });
        daemonPort = await new Promise<number>((r) =>
            daemon.listen(0, '127.0.0.1', () => r((daemon.address() as { port: number }).port)),
        );
        gw = createGateway({ store });
        gwPort = await gw.listen(0);
    });

    afterEach(async () => {
        await gw.close();
        await new Promise<void>((r) => daemon.close(() => r()));
        try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    });

    async function gwPost(token: string, body: unknown) {
        const res = await fetch(`http://127.0.0.1:${gwPort}/mcp`, {
            method: 'POST',
            headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
            body: JSON.stringify(body),
        });
        return { status: res.status, json: await res.json().catch(() => null) };
    }

    it('valid token → routes to daemon, injects caller + daemon token', async () => {
        const srv = store.addServer({ name: 'dev', endpoint: `http://127.0.0.1:${daemonPort}`, env: 'dev', token: 'daemon-secret' });
        const { token, raw } = store.createToken({ name: 'agent', serverId: srv.id, scopes: ['read', 'control'] });
        const r = await gwPost(raw, { jsonrpc: '2.0', method: 'tools/call', params: { name: 'page.click' }, id: 1 });
        expect(r.status).toBe(200);
        expect(r.json).toMatchObject({ result: { ok: true } });
        expect(received).toHaveLength(1);
        expect(received[0].headers['x-harness-caller']).toBe(token.id);
        expect(received[0].headers['authorization']).toBe('Bearer daemon-secret');
    });

    it('bad token → 401, nothing forwarded', async () => {
        const r = await gwPost('hfe_bogus.secret', { method: 'tools/list', id: 1 });
        expect(r.status).toBe(401);
        expect(received).toHaveLength(0);
    });

    it('token for a missing server → 502', async () => {
        const { raw } = store.createToken({ name: 'x', serverId: 'ghost', scopes: ['read'] });
        const r = await gwPost(raw, { method: 'tools/list', id: 1 });
        expect(r.status).toBe(502);
        expect(received).toHaveLength(0);
    });

    it('audits each forwarded call (tool name from JSON-RPC)', async () => {
        const srv = store.addServer({ name: 'dev', endpoint: `http://127.0.0.1:${daemonPort}`, env: 'dev' });
        const { raw } = store.createToken({ name: 'agent', serverId: srv.id, scopes: ['read'] });
        await gwPost(raw, { jsonrpc: '2.0', method: 'tools/call', params: { name: 'console.tail' }, id: 1 });
        const last = store.listAudit().at(-1);
        expect(last).toMatchObject({ tool: 'console.tail', serverId: srv.id });
    });

    it('non-/mcp path → 404', async () => {
        const res = await fetch(`http://127.0.0.1:${gwPort}/nope`);
        expect(res.status).toBe(404);
    });
});
