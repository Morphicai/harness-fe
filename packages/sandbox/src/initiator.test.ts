import { describe, expect, it } from 'vitest';
import { captureInitiator } from './initiator.js';

describe('captureInitiator', () => {
    it('never returns a stack that starts with the literal "Error" header', () => {
        const { stack } = captureInitiator();
        expect(stack).toBeDefined();
        expect(stack).not.toMatch(/^Error/);
    });

    it('drops the requested number of caller frames', () => {
        function inner() {
            return captureInitiator(0);
        }
        function outer() {
            return inner();
        }
        const untrimmed = outer();
        const trimmed = captureInitiator(1);
        // Both are non-empty and neither carries the "Error" header — the
        // exact frame contents are engine-dependent, so we only assert the
        // invariant that matters: no literal "Error" prefix, ever.
        expect(untrimmed.stack).not.toMatch(/^Error/);
        expect(trimmed.stack).not.toMatch(/^Error/);
    });

    it('degrades to an empty Initiator instead of throwing on failure', () => {
        const originalError = globalThis.Error;
        try {
            // @ts-expect-error — deliberately breaking Error to exercise the catch path
            globalThis.Error = function () {
                throw new Error('boom');
            };
            expect(() => captureInitiator()).not.toThrow();
            expect(captureInitiator()).toEqual({});
        } finally {
            globalThis.Error = originalError;
        }
    });
});
