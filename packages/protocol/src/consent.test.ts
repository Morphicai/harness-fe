import { describe, expect, it } from 'vitest';
import { COMMAND, requiresConsent } from './messages.js';

describe('requiresConsent (4.0 · P2)', () => {
    it('off mode never prompts', () => {
        expect(requiresConsent(COMMAND.PAGE_CLICK, 'off', false)).toBe(false);
        expect(requiresConsent(COMMAND.PAGE_EVALUATE, 'off', false)).toBe(false);
    });

    it('read-only commands never prompt', () => {
        for (const cmd of [COMMAND.CONSOLE_TAIL, COMMAND.NETWORK_TAIL, COMMAND.PAGE_SCREENSHOT, COMMAND.PAGE_DOM_QUERY, COMMAND.PROJECT_SOURCE]) {
            expect(requiresConsent(cmd, 'session', false)).toBe(false);
            expect(requiresConsent(cmd, 'always', false)).toBe(false);
        }
    });

    it('session mode: control prompts until granted, then stops', () => {
        expect(requiresConsent(COMMAND.PAGE_CLICK, 'session', false)).toBe(true);
        expect(requiresConsent(COMMAND.PAGE_CLICK, 'session', true)).toBe(false);
    });

    it('always mode: control prompts even after a grant', () => {
        expect(requiresConsent(COMMAND.PAGE_CLICK, 'always', true)).toBe(true);
    });

    it('page.evaluate always prompts, ignoring session grant', () => {
        expect(requiresConsent(COMMAND.PAGE_EVALUATE, 'session', true)).toBe(true);
        expect(requiresConsent(COMMAND.PAGE_EVALUATE, 'always', true)).toBe(true);
    });

    it('all mutating page.* commands are gated under session mode', () => {
        for (const cmd of [
            COMMAND.PAGE_CLICK, COMMAND.PAGE_TYPE, COMMAND.PAGE_SCROLL, COMMAND.PAGE_NAVIGATE,
            COMMAND.PAGE_RELOAD, COMMAND.PAGE_SET_HTML, COMMAND.PAGE_SET_STYLE, COMMAND.PAGE_WAIT_FOR,
        ]) {
            expect(requiresConsent(cmd, 'session', false)).toBe(true);
        }
    });
});
