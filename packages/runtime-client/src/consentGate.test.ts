// @vitest-environment happy-dom
/**
 * Browser-consent gate (4.0 · P2) in RuntimeClient.handleCommand. We drive
 * handleCommand directly with a stubbed `send` and a mocked command-handler
 * table, so the test isolates the consent decision wiring from real DOM ops.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// rrweb has CJS/ESM interop issues under happy-dom; stub it (same as the e2e).
vi.mock('rrweb', () => ({ record: () => () => {}, EventType: { Custom: 5 } }));

const handlerCalls: string[] = [];
vi.mock('./commands.js', () => ({
    commandHandlers: new Proxy(
        {},
        {
            get: (_t, prop) =>
                typeof prop === 'string'
                    ? async () => {
                          handlerCalls.push(prop);
                          return { ran: prop };
                      }
                    : undefined,
        },
    ),
}));

import { COMMAND, type ConsentDecision, type ConsentMode } from '@harness-fe/protocol';
import { RuntimeClient } from './client.js';
import { getCaptureStore } from './capture.js';

type Sent = { type: string; ok?: boolean; error?: { code?: string } };

function makeClient(mode: ConsentMode) {
    const c = new RuntimeClient({ projectId: 'p' });
    (c as unknown as { consentMode: ConsentMode }).consentMode = mode;
    const sent: Sent[] = [];
    (c as unknown as { send: (f: Sent) => void }).send = (f) => sent.push(f);
    return { c, sent };
}

const command = (cmd: string, id = 'id-1') => ({ type: 'command' as const, id, command: cmd, args: { selector: '.x' } });
const run = (c: RuntimeClient, frame: ReturnType<typeof command>) =>
    (c as unknown as { handleCommand: (f: unknown) => Promise<void> }).handleCommand(frame);

const PERMANENT_GRANT_KEY = '__hfe_consent_grant__:p';

beforeEach(() => {
    handlerCalls.length = 0;
    getCaptureStore().dispose();
    try { localStorage.removeItem(PERMANENT_GRANT_KEY); } catch { /* noop */ }
});

afterEach(() => {
    try { localStorage.removeItem(PERMANENT_GRANT_KEY); } catch { /* noop */ }
});

describe('consent gate', () => {
    it('off mode: control command runs without prompting', async () => {
        const { c, sent } = makeClient('off');
        const prompter = vi.fn();
        c.setConsentPrompter(prompter);
        await run(c, command(COMMAND.PAGE_CLICK));
        expect(prompter).not.toHaveBeenCalled();
        expect(handlerCalls).toEqual([COMMAND.PAGE_CLICK]);
        expect(sent[0].ok).toBe(true);
    });

    it('deny → CONSENT_DENIED, handler never runs', async () => {
        const { c, sent } = makeClient('session');
        c.setConsentPrompter(async () => 'deny' as ConsentDecision);
        await run(c, command(COMMAND.PAGE_CLICK));
        expect(handlerCalls).toEqual([]);
        expect(sent[0].ok).toBe(false);
        expect(sent[0].error?.code).toBe('CONSENT_DENIED');
    });

    it('fail-safe: consent on but no prompter registered → deny', async () => {
        const { c, sent } = makeClient('session');
        await run(c, command(COMMAND.PAGE_CLICK));
        expect(handlerCalls).toEqual([]);
        expect(sent[0].error?.code).toBe('CONSENT_DENIED');
    });

    it('once: runs this command but does not grant the session', async () => {
        const { c } = makeClient('session');
        const prompter = vi.fn(async () => 'once' as ConsentDecision);
        c.setConsentPrompter(prompter);
        await run(c, command(COMMAND.PAGE_CLICK, 'a'));
        await run(c, command(COMMAND.PAGE_CLICK, 'b'));
        expect(prompter).toHaveBeenCalledTimes(2); // prompted each time
        expect(handlerCalls).toEqual([COMMAND.PAGE_CLICK, COMMAND.PAGE_CLICK]);
    });

    it('session: first prompt grants blanket control for the rest of the session', async () => {
        const { c } = makeClient('session');
        const prompter = vi.fn(async () => 'session' as ConsentDecision);
        c.setConsentPrompter(prompter);
        await run(c, command(COMMAND.PAGE_CLICK, 'a'));
        await run(c, command(COMMAND.PAGE_TYPE, 'b'));
        expect(prompter).toHaveBeenCalledTimes(1); // second command not prompted
        expect(handlerCalls).toEqual([COMMAND.PAGE_CLICK, COMMAND.PAGE_TYPE]);
    });

    it('page.evaluate always prompts even after a session grant', async () => {
        const { c } = makeClient('session');
        const prompter = vi.fn(async () => 'session' as ConsentDecision);
        c.setConsentPrompter(prompter);
        await run(c, command(COMMAND.PAGE_CLICK, 'a')); // grants session
        await run(c, command(COMMAND.PAGE_EVALUATE, 'b')); // still prompts
        expect(prompter).toHaveBeenCalledTimes(2);
    });

    it('read-only command is never gated', async () => {
        const { c } = makeClient('session');
        const prompter = vi.fn();
        c.setConsentPrompter(prompter);
        await run(c, command(COMMAND.CONSOLE_TAIL));
        expect(prompter).not.toHaveBeenCalled();
        expect(handlerCalls).toEqual([COMMAND.CONSOLE_TAIL]);
    });
});

describe('permanent grant', () => {
    it('permanent decision: saves to localStorage and grants session', async () => {
        const { c } = makeClient('session');
        c.setConsentPrompter(async () => 'permanent' as ConsentDecision);
        await run(c, command(COMMAND.PAGE_CLICK));
        expect(handlerCalls).toContain(COMMAND.PAGE_CLICK);
        expect(localStorage.getItem(PERMANENT_GRANT_KEY)).not.toBeNull();
    });

    it('loadPermanentGrant: if localStorage has a grant, session is pre-granted', async () => {
        localStorage.setItem(PERMANENT_GRANT_KEY, JSON.stringify({ grantedAt: Date.now() }));
        const { c } = makeClient('session');
        // Call loadPermanentGrant to simulate what start() does.
        (c as unknown as { loadPermanentGrant: () => void }).loadPermanentGrant();
        // Prompter throws if called — must never be reached.
        c.setConsentPrompter(() => { throw new Error('should not prompt'); });
        await run(c, command(COMMAND.PAGE_CLICK));
        expect(handlerCalls).toContain(COMMAND.PAGE_CLICK);
    });

    it('permanent grant skips prompting on subsequent commands', async () => {
        const { c } = makeClient('session');
        const prompter = vi.fn(async () => 'permanent' as ConsentDecision);
        c.setConsentPrompter(prompter);
        await run(c, command(COMMAND.PAGE_CLICK, 'a'));
        await run(c, command(COMMAND.PAGE_CLICK, 'b'));
        // Second command must reuse the session grant, not call the prompter again.
        expect(prompter).toHaveBeenCalledTimes(1);
        expect(handlerCalls).toEqual([COMMAND.PAGE_CLICK, COMMAND.PAGE_CLICK]);
    });
});

describe('plugin consent priority', () => {
    it('opts.consent takes priority over hello.ack mode', () => {
        // Create client with explicit consent: 'off'.
        const c = new RuntimeClient({ projectId: 'p', consent: 'off' });
        // Simulate daemon sending hello.ack with consent: { mode: 'session' }.
        (c as unknown as { onHelloAck: (f: unknown) => void }).onHelloAck({
            type: 'hello.ack',
            id: 'ack-1',
            serverVersion: '4.0.0',
            consent: { mode: 'session' },
        });
        // Plugin option wins: consentMode stays 'off'.
        expect((c as unknown as { consentMode: ConsentMode }).consentMode).toBe('off');
    });

    it('falls back to hello.ack when no plugin consent set', () => {
        // Create client without a consent option.
        const c = new RuntimeClient({ projectId: 'p' });
        // Simulate daemon sending hello.ack with consent: { mode: 'session' }.
        (c as unknown as { onHelloAck: (f: unknown) => void }).onHelloAck({
            type: 'hello.ack',
            id: 'ack-2',
            serverVersion: '4.0.0',
            consent: { mode: 'session' },
        });
        // No plugin override: gateway mode is adopted.
        expect((c as unknown as { consentMode: ConsentMode }).consentMode).toBe('session');
    });
});

describe('runtime opt-in: user control override', () => {
    const RC_KEY = '__hfe_runtime_control__:p';
    const mk = (consent?: ConsentMode) => {
        const c = new RuntimeClient({ projectId: 'p', consent });
        const sent: Sent[] = [];
        (c as unknown as { send: (f: Sent) => void }).send = (f) => sent.push(f);
        return { c, sent };
    };
    beforeEach(() => { try { localStorage.removeItem(RC_KEY); } catch { /* noop */ } });
    afterEach(() => { try { localStorage.removeItem(RC_KEY); } catch { /* noop */ } });

    it('user "deny" overrides an app consent of off → control blocked', async () => {
        const { c, sent } = mk('off');
        c.setRuntimeControl('deny');
        expect(c.getRuntimeControl()).toBe('deny');
        await run(c, command(COMMAND.PAGE_CLICK));
        expect(handlerCalls).toEqual([]);
        expect(sent[0].error?.code).toBe('CONSENT_DENIED');
    });

    it('user "allow" overrides an app consent of deny → control runs', async () => {
        const { c, sent } = mk('deny');
        c.setRuntimeControl('allow');
        expect(c.getRuntimeControl()).toBe('allow');
        await run(c, command(COMMAND.PAGE_CLICK));
        expect(handlerCalls).toEqual([COMMAND.PAGE_CLICK]);
        expect(sent[0].ok).toBe(true);
    });

    it('persists the user choice to localStorage', () => {
        const { c } = mk();
        c.setRuntimeControl('deny');
        expect(localStorage.getItem(RC_KEY)).toBe('deny');
    });

    it('getRuntimeControl reflects the app default when the user has not chosen', () => {
        expect(mk('deny').c.getRuntimeControl()).toBe('deny');
        expect(mk('off').c.getRuntimeControl()).toBe('ask');
    });
});
