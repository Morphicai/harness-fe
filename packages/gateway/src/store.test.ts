import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GatewayStore } from './store.js';

describe('GatewayStore (5.0 · P6 · C2)', () => {
    let dir: string;
    let store: GatewayStore;
    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'hfe-gateway-test-'));
        store = new GatewayStore(dir);
    });
    afterEach(() => {
        try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    });

    it('servers: add / list / get / remove', () => {
        const s = store.addServer({ name: 'dev', endpoint: 'ws://localhost:47729', env: 'dev' });
        expect(store.getServer(s.id)).toMatchObject({ name: 'dev', env: 'dev' });
        expect(store.listServers()).toHaveLength(1);
        expect(store.removeServer(s.id)).toBe(true);
        expect(store.listServers()).toHaveLength(0);
        expect(store.removeServer('nope')).toBe(false);
    });

    it('createToken → verifyToken returns caller identity + scopes', () => {
        const { raw } = store.createToken({ name: 'agent', serverId: 'srv-1', scopes: ['read', 'control'] });
        const caller = store.verifyToken(raw);
        expect(caller).toMatchObject({ name: 'agent', serverId: 'srv-1', scopes: ['read', 'control'] });
    });

    it('verifyToken rejects unknown / malformed tokens', () => {
        expect(store.verifyToken('hfe_bogus.secret')).toBeNull();
        expect(store.verifyToken('garbage')).toBeNull();
    });

    it('listTokens omits secret material (hash/salt)', () => {
        store.createToken({ name: 'a', serverId: 's', scopes: ['read'] });
        const list = store.listTokens();
        expect(list).toHaveLength(1);
        expect(list[0]).not.toHaveProperty('hash');
        expect(list[0]).not.toHaveProperty('salt');
    });

    it('revoked token no longer verifies', () => {
        const { token, raw } = store.createToken({ name: 'a', serverId: 's', scopes: ['read'] });
        expect(store.verifyToken(raw)).not.toBeNull();
        expect(store.revokeToken(token.id)).toBe(true);
        expect(store.verifyToken(raw)).toBeNull();
    });

    it('expired token no longer verifies', () => {
        const { raw } = store.createToken({ name: 'a', serverId: 's', scopes: ['read'], expiresAt: Date.now() - 1 });
        expect(store.verifyToken(raw)).toBeNull();
    });

    it('a tampered secret on a valid tokenId is rejected', () => {
        const { raw } = store.createToken({ name: 'a', serverId: 's', scopes: ['read'] });
        const tokenId = raw.slice('hfe_'.length, raw.indexOf('.'));
        expect(store.verifyToken(`hfe_${tokenId}.tampered`)).toBeNull();
    });

    it('audit is append-only and tail-readable', () => {
        store.appendAudit({ ts: 1, tool: 'page.click', serverId: 's', tokenId: 't' });
        store.appendAudit({ ts: 2, tool: 'console.tail' });
        const entries = store.listAudit();
        expect(entries).toHaveLength(2);
        expect(entries[1].tool).toBe('console.tail');
    });

    it('persists across store instances (JSON files)', () => {
        const { raw } = store.createToken({ name: 'a', serverId: 's', scopes: ['write'] });
        const reopened = new GatewayStore(dir);
        expect(reopened.verifyToken(raw)?.scopes).toEqual(['write']);
    });

    it('admins: add / verify / hasAdmins / setAdminPassword', () => {
        expect(store.hasAdmins()).toBe(false);
        store.addAdmin('root', 'pw');
        expect(store.hasAdmins()).toBe(true);
        expect(store.verifyAdmin('root', 'pw')).toBe(true);
        expect(store.verifyAdmin('root', 'wrong')).toBe(false);
        expect(store.verifyAdmin('ghost', 'pw')).toBe(false);
        expect(store.setAdminPassword('root', 'pw2')).toBe(true);
        expect(store.verifyAdmin('root', 'pw2')).toBe(true);
        expect(store.verifyAdmin('root', 'pw')).toBe(false);
        expect(store.setAdminPassword('ghost', 'x')).toBe(false);
    });
});
