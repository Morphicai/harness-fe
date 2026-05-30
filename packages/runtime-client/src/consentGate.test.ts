// @vitest-environment happy-dom
/**
 * Browser-consent gate (4.0 · P2) in RuntimeClient.handleCommand. We drive
 * handleCommand directly with a stubbed `send` and a mocked command-handler
 * table, so the test isolates the consent decision wiring from real DOM ops.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

beforeEach(() => {
    handlerCalls.length = 0;
    getCaptureStore().dispose();
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
