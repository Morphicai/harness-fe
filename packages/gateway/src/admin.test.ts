import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCoreClient, type CoreClient } from '@harness-fe/core';
import { GatewayStore } from './store.js';
import { createGateway, type GatewayHandle } from './server.js';
import { Policy } from './policy.js';

describe('gateway admin panel', () => {
    let dir: string;
    let store: GatewayStore;
    let core: CoreClient;
    let gw: GatewayHandle;
    let port: number;

    beforeEach(async () => {
        dir = mkdtempSync(join(tmpdir(), 'hfe-gw-admin-'));
        store = new GatewayStore(dir);
        store.addAdmin('root', 'pw');
        core = createCoreClient({ store: null, taskStore: null, autoPurge: { enabled: false } });
        gw = createGateway({ coreClient: core, policy: new Policy({ mode: 'governed', store }), store });
        port = await gw.listen(0);
    });
    afterEach(async () => {
        await gw.close();
        await core.stop();
        try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    });

    const url = (p: string) => `http://127.0.0.1:${port}${p}`;

    it('serves the login page', async () => {
        const r = await fetch(url('/admin/login'));
        expect(r.status).toBe(200);
        expect(await r.text()).toContain('gateway');
    });

    it('API requires auth (401 without session cookie)', async () => {
        const r = await fetch(url('/admin/api/servers'));
        expect(r.status).toBe(401);
    });

    it('unauthenticated /admin redirects to login', async () => {
        const r = await fetch(url('/admin'), { redirect: 'manual' });
        expect(r.status).toBe(303);
        expect(r.headers.get('location')).toBe('/admin/login');
    });

    it('bad credentials → 401', async () => {
        const r = await fetch(url('/admin/login'), {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: 'username=root&password=wrong',
            redirect: 'manual',
        });
        expect(r.status).toBe(401);
    });

    it('login → cookie → manage servers + tokens via API', async () => {
        const login = await fetch(url('/admin/login'), {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: 'username=root&password=pw',
            redirect: 'manual',
        });
        expect(login.status).toBe(303);
        const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
        expect(cookie).toMatch(/^hfe_gw_admin=/);

        const add = await fetch(url('/admin/api/servers'), {
            method: 'POST',
            headers: { 'content-type': 'application/json', cookie },
            body: JSON.stringify({ name: 'dev', endpoint: 'http://127.0.0.1:1', env: 'dev', token: 'd' }),
        });
        expect(add.status).toBe(200);
        const servers = (await (await fetch(url('/admin/api/servers'), { headers: { cookie } })).json()) as { id: string }[];
        expect(servers).toHaveLength(1);

        const tok = (await (
            await fetch(url('/admin/api/tokens'), {
                method: 'POST',
                headers: { 'content-type': 'application/json', cookie },
                body: JSON.stringify({ name: 'agent', serverId: servers[0].id, scopes: ['read', 'control'] }),
            })
        ).json()) as { id: string; raw: string };
        expect(tok.raw).toMatch(/^hfe_/);
        // The created token actually verifies against the store.
        expect(store.verifyToken(tok.raw)?.scopes).toEqual(['read', 'control']);

        // revoke it
        const rev = await fetch(url('/admin/api/tokens/revoke'), {
            method: 'POST',
            headers: { 'content-type': 'application/json', cookie },
            body: JSON.stringify({ id: tok.id }),
        });
        expect(rev.status).toBe(200);
        expect(store.verifyToken(tok.raw)).toBeNull();
    });
});
