import { describe, expect, it } from 'vitest';
import {
    HOST_PRINCIPAL,
    LOCAL_PRINCIPAL,
    canSee,
    canSeeProject,
    principalCan,
    projectGrant,
    tokenPrincipalId,
    type Principal,
} from './identity.js';

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

describe('identity: principalCan (scope gate — write-only deny)', () => {
    const writeOnly: Principal = { id: 'token:runtime', kind: 'token', scopes: { write: true } };
    const reader: Principal = { id: 'token:r', kind: 'token', scopes: { read: true } };
    const agent: Principal = { id: 'token:a', kind: 'token', scopes: { read: true, control: true } };

    it('unrestricted principal (no scopes: local/host) holds every scope', () => {
        for (const s of ['write', 'read', 'control'] as const) {
            expect(principalCan(LOCAL_PRINCIPAL, s)).toBe(true);
            expect(principalCan(HOST_PRINCIPAL, s)).toBe(true);
        }
    });

    it('write-only runtime client is denied read and control', () => {
        expect(principalCan(writeOnly, 'write')).toBe(true);
        expect(principalCan(writeOnly, 'read')).toBe(false);
        expect(principalCan(writeOnly, 'control')).toBe(false);
    });

    it('read-only agent may read but not control', () => {
        expect(principalCan(reader, 'read')).toBe(true);
        expect(principalCan(reader, 'control')).toBe(false);
        expect(principalCan(reader, 'write')).toBe(false);
    });

    it('full agent may read and control', () => {
        expect(principalCan(agent, 'read')).toBe(true);
        expect(principalCan(agent, 'control')).toBe(true);
    });
});

describe('identity: canSee (tenant visibility)', () => {
    const tokenA: Principal = { id: 'token:aaa', kind: 'token' };
    const tokenB: Principal = { id: 'token:bbb', kind: 'token' };

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

describe('identity: canSeeProject (project ownership + host subtree)', () => {
    const tokenA: Principal = { id: 'token:aaa', kind: 'token' };
    const tokenB: Principal = { id: 'token:bbb', kind: 'token' };

    // These exercise the creator-based FALLBACK (principals carry no project
    // grants, so projectGrant returns null and ownership decides).
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

    it('scoped token does NOT see a project via an unowned link (enumeration fix)', () => {
        // Was visible under the old backward-compat rule; default-deny closes it.
        expect(canSeeProject(tokenA, 'p', [undefined])).toBe(false);
        expect(canSeeProject(tokenA, 'p', [undefined, 'token:ccc'])).toBe(false);
    });

    it('local / host still see an unowned project (lenient fallback unchanged)', () => {
        expect(canSeeProject(LOCAL_PRINCIPAL, 'p', [undefined])).toBe(true);
        expect(canSeeProject(HOST_PRINCIPAL, 'p', [undefined])).toBe(true);
    });

    it('empty chain (unknown project) → not visible to named principal', () => {
        expect(canSeeProject(tokenA, 'p', [])).toBe(false);
    });
});

describe('identity: project→agent binding (explicit grants)', () => {
    const bound: Principal = { id: 'forwarded:agentA', kind: 'forwarded', projects: ['react-demo', 'vue-demo'] };
    const wildcard: Principal = { id: 'forwarded:admin', kind: 'forwarded', projects: ['*'] };
    const unbound: Principal = { id: 'token:aaa', kind: 'token' }; // no grants → fallback

    it('granted project is visible regardless of who created the data (creator≠consumer)', () => {
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
