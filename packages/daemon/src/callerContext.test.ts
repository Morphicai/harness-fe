import { describe, expect, it } from 'vitest';
import { currentCaller, runWithCaller } from './callerContext.js';
import { LOCAL_PRINCIPAL, type Principal } from './identity.js';

describe('callerContext (4.0 · A)', () => {
    it('currentCaller is undefined outside any run (stdio path)', () => {
        expect(currentCaller()).toBeUndefined();
    });

    it('runWithCaller makes the principal ambient', () => {
        const p: Principal = { id: 'token:x', kind: 'token' };
        const seen = runWithCaller(p, () => currentCaller());
        expect(seen).toBe(p);
    });

    it('propagates across awaits', async () => {
        const result = await runWithCaller(LOCAL_PRINCIPAL, async () => {
            await Promise.resolve();
            return currentCaller();
        });
        expect(result).toBe(LOCAL_PRINCIPAL);
    });

    it('does not leak outside the run', async () => {
        await runWithCaller({ id: 'token:y', kind: 'token' }, async () => {
            await Promise.resolve();
        });
        expect(currentCaller()).toBeUndefined();
    });
});
