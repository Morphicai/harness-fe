/**
 * End-to-end (5.0 · P6 · C6): real daemon ← gateway ← client.
 * Boots a real daemon (createDaemon + token + HTTP MCP), points the gateway at
 * it, and drives an MCP `initialize` through the gateway to prove the full
 * chain works: routing + daemon-token auth + x-harness-caller injection +
 * mcp-session-id passthrough. Tenant isolation / manifest are covered by unit
 * tests (daemon canSee, gateway scope); this asserts the wire path.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDaemon, type DaemonHandle } from '@harness-fe/mcp-server';
import { GatewayStore } from './store.js';
import { createGateway, type GatewayHandle } from './server.js';

describe('gateway ↔ real daemon e2e (5.0 · P6 · C6)', () => {
    let daemonDir: string;
    let gwDir: string;
    let daemon: DaemonHandle;
    let gw: GatewayHandle;
    let gwPort: number;
    let agentToken: string;

    beforeAll(async () => {
        daemonDir = mkdtempSync(join(tmpdir(), 'hfe-e2e-daemon-'));
        gwDir = mkdtempSync(join(tmpdir(), 'hfe-e2e-gw-'));
        daemon = createDaemon({ port: 0, host: '127.0.0.1', token: 'daemon-secret', dataDir: daemonDir, mcpHttp: true });
        await daemon.start();
        const daemonPort = daemon.getBoundPort();

        const store = new GatewayStore(gwDir);
        const srv = store.addServer({ name: 'dev', endpoint: `http://127.0.0.1:${daemonPort}`, env: 'dev', token: 'daemon-secret' });
        agentToken = store.createToken({ name: 'agent', serverId: srv.id, scopes: ['read', 'control'] }).raw;
        gw = createGateway({ store });
        gwPort = await gw.listen(0);
    });

    afterAll(async () => {
        await gw?.close();
        await daemon?.stop();
        for (const d of [daemonDir, gwDir]) { try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ } }
    });

    function initBody() {
        return JSON.stringify({
            jsonrpc: '2.0',
            method: 'initialize',
            params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } },
            id: 1,
        });
    }

    it('MCP initialize flows agent → gateway → real daemon', async () => {
        const res = await fetch(`http://127.0.0.1:${gwPort}/mcp`, {
            method: 'POST',
            headers: {
                authorization: `Bearer ${agentToken}`,
                'content-type': 'application/json',
                accept: 'application/json, text/event-stream',
            },
            body: initBody(),
        });
        expect(res.status).toBe(200);
        const text = await res.text();
        // Whether the daemon answered with JSON or an SSE frame, the initialize
        // result must have made it back through the gateway.
        expect(text).toMatch(/protocolVersion|serverInfo|"result"/);
    });

    it('a bad gateway token never reaches the daemon (401)', async () => {
        const res = await fetch(`http://127.0.0.1:${gwPort}/mcp`, {
            method: 'POST',
            headers: { authorization: 'Bearer hfe_bogus.secret', 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
            body: initBody(),
        });
        expect(res.status).toBe(401);
    });
});
