import { describe, expect, it } from 'vitest';
import type { IncomingMessage } from 'node:http';
import {
    HOST_PRINCIPAL,
    LOCAL_PRINCIPAL,
    identifyPrincipal,
    resolvePrincipal,
    tokenPrincipalId,
} from './identity.js';

function fakeReq(init: { headers?: Record<string, string>; url?: string } = {}): IncomingMessage {
    return {
        headers: init.headers ?? {},
        url: init.url ?? '/',
    } as unknown as IncomingMessage;
}

describe('identity: tokenPrincipalId', () => {
    it('is stable + prefixed + hashed (never the raw token)', () => {
        const id = tokenPrincipalId('super-secret');
        expect(id).toMatch(/^token:[0-9a-f]{12}$/);
        expect(id).toBe(tokenPrincipalId('super-secret'));
        expect(id).not.toContain('super-secret');
    });
    it('different tokens → different ids', () => {
        expect(tokenPrincipalId('a')).not.toBe(tokenPrincipalId('b'));
    });
});

describe('identity: resolvePrincipal', () => {
    it('loopback (auth disabled) → LOCAL_PRINCIPAL', () => {
        expect(resolvePrincipal(fakeReq(), {})).toBe(LOCAL_PRINCIPAL);
        expect(resolvePrincipal(fakeReq(), { token: '' })).toBe(LOCAL_PRINCIPAL);
    });

    it('token mode: matching token → token principal', () => {
        const req = fakeReq({ headers: { authorization: 'Bearer s3cr3t' } });
        const p = resolvePrincipal(req, { token: 's3cr3t' });
        expect(p).toEqual({ id: tokenPrincipalId('s3cr3t'), kind: 'token' });
    });

    it('token mode: missing/wrong token → null (mirrors deny)', () => {
        expect(resolvePrincipal(fakeReq(), { token: 's3cr3t' })).toBeNull();
        expect(
            resolvePrincipal(fakeReq({ headers: { authorization: 'Bearer nope' } }), { token: 's3cr3t' }),
        ).toBeNull();
    });

    it('custom authorize: accept → HOST_PRINCIPAL, reject → null', () => {
        expect(resolvePrincipal(fakeReq(), { authorize: () => true })).toBe(HOST_PRINCIPAL);
        expect(resolvePrincipal(fakeReq(), { authorize: () => false })).toBeNull();
    });

    it('authorize wins over token (same precedence as isAuthorized)', () => {
        const req = fakeReq({ headers: { authorization: 'Bearer wrong' } });
        expect(resolvePrincipal(req, { token: 'right', authorize: () => true })).toBe(HOST_PRINCIPAL);
    });
});

describe('identity: identifyPrincipal (P4 — identify, not authorize)', () => {
    it('no auth → local', () => {
        expect(identifyPrincipal({ authorization: 'Bearer x' }, {})).toBe(LOCAL_PRINCIPAL);
    });

    it('stdio (no headers) → local even when a token is configured', () => {
        expect(identifyPrincipal(undefined, { token: 's3cr3t' })).toBe(LOCAL_PRINCIPAL);
    });

    it('token mode: names the caller from the Authorization header', () => {
        const p = identifyPrincipal({ authorization: 'Bearer s3cr3t' }, { token: 's3cr3t' });
        expect(p).toEqual({ id: tokenPrincipalId('s3cr3t'), kind: 'token' });
    });

    it('token mode: handles array-valued headers', () => {
        const p = identifyPrincipal({ authorization: ['Bearer s3cr3t'] }, { token: 's3cr3t' });
        expect(p.id).toBe(tokenPrincipalId('s3cr3t'));
    });

    it('token mode without a bearer header → local (already past auth wrapper)', () => {
        expect(identifyPrincipal({}, { token: 's3cr3t' })).toBe(LOCAL_PRINCIPAL);
    });

    it('authorize mode → host', () => {
        expect(identifyPrincipal({ authorization: 'Bearer x' }, { authorize: () => true })).toBe(HOST_PRINCIPAL);
    });
});
