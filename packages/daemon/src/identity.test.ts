import { describe, expect, it } from 'vitest';
import type { IncomingMessage } from 'node:http';
import {
    HOST_PRINCIPAL,
    LOCAL_PRINCIPAL,
    canSee,
    canSeeProject,
    projectGrant,
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

    it('trusted upstream: forwarded caller honoured when auth is enabled', () => {
        const p = identifyPrincipal(
            { authorization: 'Bearer gw', 'x-harness-caller': 'token:real' },
            { token: 'gw' },
        );
        expect(p).toEqual({ id: 'token:real', kind: 'forwarded' });
    });

    it('forwarded caller wins over the connection token identity', () => {
        const p = identifyPrincipal(
            { authorization: 'Bearer gw', 'x-harness-caller': 'agent-7' },
            { token: 'gw' },
        );
        expect(p.id).toBe('agent-7');
        expect(p.kind).toBe('forwarded');
    });

    it('loopback (no auth) IGNORES forwarded caller — no spoofing', () => {
        expect(identifyPrincipal({ 'x-harness-caller': 'token:evil' }, {})).toBe(LOCAL_PRINCIPAL);
    });
});

describe('identity: canSee (P3 tenant visibility)', () => {
    const tokenA = { id: 'token:aaa', kind: 'token' as const };
    const tokenB = { id: 'token:bbb', kind: 'token' as const };

    it('local sees everything (zero behaviour change for solo dev)', () => {
        expect(canSee(LOCAL_PRINCIPAL, 'token:aaa')).toBe(true);
        expect(canSee(LOCAL_PRINCIPAL, undefined)).toBe(true);
        expect(canSee(LOCAL_PRINCIPAL, null)).toBe(true);
    });

    it('unowned data (no createdBy) is visible to everyone', () => {
        expect(canSee(tokenA, undefined)).toBe(true);
        expect(canSee(tokenA, null)).toBe(true);
    });

    it('named principal sees only its own owned data', () => {
        expect(canSee(tokenA, 'token:aaa')).toBe(true);
        expect(canSee(tokenA, 'token:bbb')).toBe(false);
        expect(canSee(tokenB, 'token:aaa')).toBe(false);
    });
});

describe('identity: canSeeProject (P3/A — project ownership + host subtree)', () => {
    const tokenA = { id: 'token:aaa', kind: 'token' as const };
    const tokenB = { id: 'token:bbb', kind: 'token' as const };

    // These exercise the creator-based FALLBACK (principals carry no project
    // grants, so projectGrant returns null and ownership decides). The projectId
    // arg is irrelevant on this path; use a fixed 'p'.
    it('local sees any project', () => {
        expect(canSeeProject(LOCAL_PRINCIPAL, 'p', ['token:bbb'])).toBe(true);
        expect(canSeeProject(LOCAL_PRINCIPAL, 'p', [])).toBe(true);
    });

    it('owner of the project itself sees it', () => {
        expect(canSeeProject(tokenA, 'p', ['token:aaa'])).toBe(true);
    });

    it('host owner sees a sub-app (owns an ancestor in the chain)', () => {
        expect(canSeeProject(tokenA, 'p', ['token:bbb', 'token:aaa'])).toBe(true);
    });

    it('sub-app owner does NOT see up the tree (only owns the leaf)', () => {
        expect(canSeeProject(tokenB, 'p', ['token:aaa'])).toBe(false);
    });

    it('no ownership anywhere in the chain → not visible', () => {
        expect(canSeeProject(tokenA, 'p', ['token:bbb', 'token:ccc'])).toBe(false);
    });

    it('unowned link in the chain → visible (backward compat)', () => {
        expect(canSeeProject(tokenA, 'p', [undefined])).toBe(true);
    });

    it('empty chain (unknown project) → not visible to named principal', () => {
        expect(canSeeProject(tokenA, 'p', [])).toBe(false);
    });
});

describe('identity: project→agent binding (5.0 — explicit grants)', () => {
    const bound = { id: 'forwarded:agentA', kind: 'forwarded' as const, projects: ['react-demo', 'vue-demo'] };
    const wildcard = { id: 'forwarded:admin', kind: 'forwarded' as const, projects: ['*'] };
    const unbound = { id: 'token:aaa', kind: 'token' as const }; // no grants → fallback

    it('granted project is visible regardless of who created the data (creator≠consumer)', () => {
        // createdBy is a runtime principal the agent never matches — still visible.
        expect(canSeeProject(bound, 'react-demo', ['token:runtime-xyz'])).toBe(true);
    });

    it('ungranted project is NOT visible even when other grants are present', () => {
        expect(canSeeProject(bound, 'other-app', ['token:runtime-xyz'])).toBe(false);
    });

    it('wildcard grant sees any project', () => {
        expect(canSeeProject(wildcard, 'anything', ['token:whoever'])).toBe(true);
    });

    it('projectGrant: membership / wildcard / unbound(null) / local(true)', () => {
        expect(projectGrant(bound, 'react-demo')).toBe(true);
        expect(projectGrant(bound, 'nope')).toBe(false);
        expect(projectGrant(wildcard, 'whatever')).toBe(true);
        expect(projectGrant(unbound, 'x')).toBe(null);
        expect(projectGrant(LOCAL_PRINCIPAL, 'x')).toBe(true);
    });
});
