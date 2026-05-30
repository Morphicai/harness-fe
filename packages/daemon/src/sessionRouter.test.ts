import { describe, expect, it } from 'vitest';
import { SessionRouter } from './sessionRouter.js';
import { LOCAL_PRINCIPAL, type Principal } from './identity.js';

const tokenA: Principal = { id: 'token:aaa', kind: 'token' };
const tokenB: Principal = { id: 'token:bbb', kind: 'token' };

function router() {
    const r = new SessionRouter();
    r.register({ role: 'runtime-client', projectId: 'p', tabId: 'tA', connectionId: 'c1', principal: tokenA });
    r.register({ role: 'runtime-client', projectId: 'p', tabId: 'tB', connectionId: 'c2', principal: tokenB });
    return r;
}

describe('sessionRouter.findTab — command-target scoping (4.0 · A)', () => {
    it('no principal → original global behaviour (most-recent)', () => {
        expect(router().findTab()?.tabId).toBe('tB'); // tB registered last
    });

    it('local principal drives anything (zero behaviour change)', () => {
        expect(router().findTab(undefined, LOCAL_PRINCIPAL)?.tabId).toBe('tB');
    });

    it('named principal only gets its own tab when none specified', () => {
        expect(router().findTab(undefined, tokenA)?.tabId).toBe('tA');
        expect(router().findTab(undefined, tokenB)?.tabId).toBe('tB');
    });

    it('explicit tabId cannot target someone else’s tab', () => {
        expect(router().findTab('tB', tokenA)).toBeUndefined();
        expect(router().findTab('tA', tokenA)?.tabId).toBe('tA');
    });

    it('unowned tab (no principal on peer) is drivable by anyone', () => {
        const r = new SessionRouter();
        r.register({ role: 'runtime-client', projectId: 'p', tabId: 'tU', connectionId: 'c3' });
        expect(r.findTab(undefined, tokenA)?.tabId).toBe('tU');
        expect(r.findTab('tU', tokenA)?.tabId).toBe('tU');
    });

    it('named principal with no visible tab → undefined', () => {
        const r = new SessionRouter();
        r.register({ role: 'runtime-client', projectId: 'p', tabId: 'tA', connectionId: 'c1', principal: tokenA });
        expect(r.findTab(undefined, tokenB)).toBeUndefined();
    });
});
