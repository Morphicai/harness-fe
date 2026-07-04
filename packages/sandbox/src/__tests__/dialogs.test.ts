// @vitest-environment happy-dom
/**
 * Unit tests for the dialogs sandbox channel.
 *
 * Key mechanism under test: `window.__hfe_agent_in_progress__` flag
 * distinguishes agent-triggered calls (intercepted/suppressed) from
 * user-triggered calls (passed through to native).
 *
 * Note: happy-dom does not implement window.alert / confirm / prompt / print.
 * We install no-op stubs in beforeEach so the channel's `.bind(window)` calls
 * succeed and the patch is active. Individual tests replace these stubs with
 * spies as needed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installSandbox } from '../index.js';
import { _resetForTesting } from '../chain.js';
import type { SandboxEvent, SandboxHandle } from '../types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function setAgentInProgress(value: boolean | undefined): void {
    if (value === undefined) {
        delete (window as unknown as Record<string, unknown>).__hfe_agent_in_progress__;
    } else {
        (window as unknown as Record<string, unknown>).__hfe_agent_in_progress__ = value;
    }
}

function setDialogPresets(map: Map<string, boolean | string> | undefined): void {
    if (map === undefined) {
        delete (window as unknown as Record<string, unknown>).__hfe_dialog_presets__;
    } else {
        (window as unknown as Record<string, unknown>).__hfe_dialog_presets__ = map;
    }
}

function dialogEvents(events: SandboxEvent[]): Array<SandboxEvent & { source: 'dialogs' }> {
    return events.filter((e): e is SandboxEvent & { source: 'dialogs' } => e.source === 'dialogs');
}

// ─── Global stubs ─────────────────────────────────────────────────────────────
// happy-dom does not provide alert/confirm/prompt/print. The dialogs channel
// calls `.bind(window)` on them at install time, which throws on undefined.
// We install minimal stubs so the channel patch can be applied cleanly.

const STUB_ALERT = vi.fn();
const STUB_CONFIRM = vi.fn().mockReturnValue(false);
const STUB_PROMPT = vi.fn().mockReturnValue(null);
const STUB_PRINT = vi.fn();

beforeEach(() => {
    STUB_ALERT.mockReset();
    STUB_CONFIRM.mockReset().mockReturnValue(false);
    STUB_PROMPT.mockReset().mockReturnValue(null);
    STUB_PRINT.mockReset();

    // Install stubs so installDialogsPatch can bind them successfully.
    // Each test can then replace window.alert etc. with a fresh spy — but only
    // BEFORE calling installSandbox (the patch captures the value at install time).
    (window as unknown as Record<string, unknown>).alert = STUB_ALERT;
    (window as unknown as Record<string, unknown>).confirm = STUB_CONFIRM;
    (window as unknown as Record<string, unknown>).prompt = STUB_PROMPT;
    (window as unknown as Record<string, unknown>).print = STUB_PRINT;
});

afterEach(() => {
    _resetForTesting();
    setAgentInProgress(undefined);
    setDialogPresets(undefined);
    delete (window as unknown as Record<string, unknown>).__hfe_pending_file_input__;
    // Restore stubs (uninstall reverts to the stubs; clean up for next test)
    (window as unknown as Record<string, unknown>).alert = STUB_ALERT;
    (window as unknown as Record<string, unknown>).confirm = STUB_CONFIRM;
    (window as unknown as Record<string, unknown>).prompt = STUB_PROMPT;
    (window as unknown as Record<string, unknown>).print = STUB_PRINT;
});

// ─── window.alert ─────────────────────────────────────────────────────────────

describe('window.alert', () => {
    it('user-triggered: passes to original alert', () => {
        // Replace stub with spy BEFORE installSandbox — the patch will capture it.
        const origAlert = vi.fn();
        (window as unknown as Record<string, unknown>).alert = origAlert;

        const handle = installSandbox({ only: ['dialogs'] });
        // No agent flag set — user-triggered path
        window.alert('hello');

        expect(origAlert).toHaveBeenCalledWith('hello');
        handle.dispose();
    });

    it('agent-triggered: suppresses native alert and emits dialog event', () => {
        const origAlert = vi.fn();
        (window as unknown as Record<string, unknown>).alert = origAlert;

        const events: SandboxEvent[] = [];
        const handle = installSandbox({ only: ['dialogs'], onEvent: (e) => events.push(e) });

        setAgentInProgress(true);
        window.alert('test message');

        // Original must NOT be called
        expect(origAlert).not.toHaveBeenCalled();

        // Event must be emitted with correct shape
        const dialogEvts = dialogEvents(events);
        expect(dialogEvts).toHaveLength(1);
        expect(dialogEvts[0].kind).toBe('alert');
        expect(dialogEvts[0].data).toMatchObject({ type: 'alert', message: 'test message' });

        handle.dispose();
    });

    it('agent-triggered with undefined message: coerces to empty string', () => {
        const events: SandboxEvent[] = [];
        const handle = installSandbox({ only: ['dialogs'], onEvent: (e) => events.push(e) });

        setAgentInProgress(true);
        window.alert(undefined as unknown as string);

        const dialogEvts = dialogEvents(events);
        expect(dialogEvts).toHaveLength(1);
        expect(dialogEvts[0].data).toMatchObject({ type: 'alert', message: '' });

        handle.dispose();
    });
});

// ─── window.confirm ───────────────────────────────────────────────────────────

describe('window.confirm', () => {
    it('user-triggered: calls original confirm', () => {
        const origConfirm = vi.fn().mockReturnValue(true);
        (window as unknown as Record<string, unknown>).confirm = origConfirm;

        const handle = installSandbox({ only: ['dialogs'] });
        // No agent flag — should pass through to native
        const result = window.confirm('are you sure?');

        expect(origConfirm).toHaveBeenCalled();
        expect(result).toBe(true);
        handle.dispose();
    });

    it('agent-triggered with preset: returns preset value and consumes it', () => {
        const events: SandboxEvent[] = [];
        const handle = installSandbox({ only: ['dialogs'], onEvent: (e) => events.push(e) });

        const presets = new Map<string, boolean | string>([['confirm', true]]);
        setDialogPresets(presets);
        setAgentInProgress(true);

        const result = window.confirm('delete?');

        expect(result).toBe(true);
        // Preset must be consumed (removed from the map)
        expect(presets.has('confirm')).toBe(false);

        const dialogEvts = dialogEvents(events);
        expect(dialogEvts).toHaveLength(1);
        expect(dialogEvts[0].kind).toBe('confirm');
        expect(dialogEvts[0].data).toMatchObject({ type: 'confirm', message: 'delete?', returnValue: true });

        handle.dispose();
    });

    it('agent-triggered without preset: returns false', () => {
        const events: SandboxEvent[] = [];
        const handle = installSandbox({ only: ['dialogs'], onEvent: (e) => events.push(e) });

        setAgentInProgress(true);
        const result = window.confirm('delete?');

        expect(result).toBe(false);

        const dialogEvts = dialogEvents(events);
        expect(dialogEvts).toHaveLength(1);
        expect(dialogEvts[0].data).toMatchObject({ type: 'confirm', returnValue: false });

        handle.dispose();
    });

    it('agent-triggered with false preset: returns false', () => {
        const handle = installSandbox({ only: ['dialogs'] });

        setDialogPresets(new Map<string, boolean | string>([['confirm', false]]));
        setAgentInProgress(true);

        expect(window.confirm('sure?')).toBe(false);
        handle.dispose();
    });
});

// ─── window.prompt ────────────────────────────────────────────────────────────

describe('window.prompt', () => {
    it('user-triggered: calls original prompt', () => {
        const origPrompt = vi.fn().mockReturnValue('user-typed');
        (window as unknown as Record<string, unknown>).prompt = origPrompt;

        const handle = installSandbox({ only: ['dialogs'] });
        const result = window.prompt('Enter name');

        expect(origPrompt).toHaveBeenCalled();
        expect(result).toBe('user-typed');
        handle.dispose();
    });

    it('agent-triggered with string preset: returns preset string', () => {
        const events: SandboxEvent[] = [];
        const handle = installSandbox({ only: ['dialogs'], onEvent: (e) => events.push(e) });

        setDialogPresets(new Map<string, boolean | string>([['prompt', 'my-answer']]));
        setAgentInProgress(true);

        const result = window.prompt('Enter name');

        expect(result).toBe('my-answer');

        const dialogEvts = dialogEvents(events);
        expect(dialogEvts).toHaveLength(1);
        expect(dialogEvts[0].kind).toBe('prompt');
        expect(dialogEvts[0].data).toMatchObject({ type: 'prompt', message: 'Enter name', returnValue: 'my-answer' });

        handle.dispose();
    });

    it('agent-triggered without preset: returns null', () => {
        const events: SandboxEvent[] = [];
        const handle = installSandbox({ only: ['dialogs'], onEvent: (e) => events.push(e) });

        setAgentInProgress(true);
        const result = window.prompt('Enter');

        expect(result).toBeNull();

        const dialogEvts = dialogEvents(events);
        expect(dialogEvts).toHaveLength(1);
        expect(dialogEvts[0].data).toMatchObject({ type: 'prompt', returnValue: null });

        handle.dispose();
    });
});

// ─── HTMLInputElement.prototype.click — file input ────────────────────────────
// Note: file input click interception has been moved to the `forms` channel.
// These tests now install the `forms` channel (not `dialogs`) and filter for
// `source: 'forms'` events.

describe('HTMLInputElement.prototype.click — file input', () => {
    let savedOrigClick: () => void;

    beforeEach(() => {
        // Snapshot the real prototype method before any test spy may replace it.
        savedOrigClick = HTMLInputElement.prototype.click;
    });

    afterEach(() => {
        // Ensure prototype is always restored between tests in this describe block.
        HTMLInputElement.prototype.click = savedOrigClick;
    });

    it('user-triggered file input click: calls native click', () => {
        const clickSpy = vi.fn();
        // Replace BEFORE installSandbox so the patch captures the spy as origInputClick.
        HTMLInputElement.prototype.click = clickSpy;

        const handle = installSandbox({ only: ['forms'] });

        const input = document.createElement('input');
        input.type = 'file';
        // No agent flag — user-triggered
        input.click();

        expect(clickSpy).toHaveBeenCalled();
        handle.dispose();
    });

    it('agent-triggered file input click: suppresses native and emits event', () => {
        const clickSpy = vi.fn();
        HTMLInputElement.prototype.click = clickSpy;

        const events: SandboxEvent[] = [];
        const handle = installSandbox({ only: ['forms'], onEvent: (e) => events.push(e) });

        const input = document.createElement('input');
        input.type = 'file';
        input.id = 'test-file';
        document.body.appendChild(input);

        setAgentInProgress(true);
        input.click();

        // Native click must be suppressed
        expect(clickSpy).not.toHaveBeenCalled();

        // Event must be emitted on the forms channel
        const formsEvts = events.filter((e): e is SandboxEvent & { source: 'forms' } => e.source === 'forms');
        expect(formsEvts).toHaveLength(1);
        expect(formsEvts[0].kind).toBe('file_input_click');
        expect(formsEvts[0].data).toMatchObject({ type: 'file_input_click' });

        // Selector derived from id
        expect((formsEvts[0].data as { selector?: string }).selector).toBe('#test-file');

        // Pending reference must be parked
        expect((window as unknown as Record<string, unknown>).__hfe_pending_file_input__).toBe(input);

        document.body.removeChild(input);
        handle.dispose();
    });

    it('agent-triggered file input without id: derives tag-based selector containing "input"', () => {
        const clickSpy = vi.fn();
        HTMLInputElement.prototype.click = clickSpy;

        const events: SandboxEvent[] = [];
        const handle = installSandbox({ only: ['forms'], onEvent: (e) => events.push(e) });

        const input = document.createElement('input');
        input.type = 'file';
        // No id — selector should fall back to tag name

        setAgentInProgress(true);
        input.click();

        const formsEvts = events.filter((e): e is SandboxEvent & { source: 'forms' } => e.source === 'forms');
        expect(formsEvts).toHaveLength(1);
        const selector = (formsEvts[0].data as { selector?: string }).selector ?? '';
        expect(selector).toContain('input');

        handle.dispose();
    });

    it('non-file input click always passes through (even when agent flag is set)', () => {
        const clickSpy = vi.fn();
        HTMLInputElement.prototype.click = clickSpy;

        const handle = installSandbox({ only: ['forms'] });

        const input = document.createElement('input');
        input.type = 'text';

        setAgentInProgress(true);
        input.click();

        // type !== 'file' must always call native
        expect(clickSpy).toHaveBeenCalled();
        handle.dispose();
    });
});

// ─── window.print ─────────────────────────────────────────────────────────────

describe('window.print', () => {
    it('user-triggered: passes to original print', () => {
        const origPrint = vi.fn();
        (window as unknown as Record<string, unknown>).print = origPrint;

        const handle = installSandbox({ only: ['dialogs'] });
        window.print();

        expect(origPrint).toHaveBeenCalled();
        handle.dispose();
    });

    it('agent-triggered: suppresses native print and emits event', () => {
        const origPrint = vi.fn();
        (window as unknown as Record<string, unknown>).print = origPrint;

        const events: SandboxEvent[] = [];
        const handle = installSandbox({ only: ['dialogs'], onEvent: (e) => events.push(e) });

        setAgentInProgress(true);
        window.print();

        expect(origPrint).not.toHaveBeenCalled();

        const dialogEvts = dialogEvents(events);
        expect(dialogEvts).toHaveLength(1);
        expect(dialogEvts[0].kind).toBe('print');
        expect(dialogEvts[0].data).toMatchObject({ type: 'print' });

        handle.dispose();
    });
});

// ─── beforeunload ──────────────────────────────────────────────────────────

describe('beforeunload', () => {
    it('agent-triggered: does NOT preventDefault (no native dialog) and still emits event', () => {
        const events: SandboxEvent[] = [];
        const handle = installSandbox({ only: ['dialogs'], onEvent: (e) => events.push(e) });

        setAgentInProgress(true);
        const event = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(event);

        // Regression guard for the inverted-logic bug: harness-fe must never
        // be the reason a native "Leave site?" dialog is shown.
        expect(event.defaultPrevented).toBe(false);

        const dialogEvts = dialogEvents(events);
        expect(dialogEvts).toHaveLength(1);
        expect(dialogEvts[0].kind).toBe('beforeunload');
        expect(dialogEvts[0].data).toMatchObject({ type: 'beforeunload' });

        handle.dispose();
    });

    it('user-triggered (no agent flag): does not preventDefault and does not emit', () => {
        const events: SandboxEvent[] = [];
        const handle = installSandbox({ only: ['dialogs'], onEvent: (e) => events.push(e) });

        const event = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(event);

        expect(event.defaultPrevented).toBe(false);
        expect(dialogEvents(events)).toHaveLength(0);

        handle.dispose();
    });
});

// ─── Uninstall (dispose) ──────────────────────────────────────────────────────

describe('uninstall', () => {
    it('after dispose, alert reverts to original', () => {
        const origAlert = vi.fn();
        (window as unknown as Record<string, unknown>).alert = origAlert;

        const handle = installSandbox({ only: ['dialogs'] });
        handle.dispose();

        // Even with agent flag set, original must be called after dispose
        setAgentInProgress(true);
        window.alert('after dispose');

        expect(origAlert).toHaveBeenCalledWith('after dispose');
    });

    it('after dispose, confirm reverts to original', () => {
        const origConfirm = vi.fn().mockReturnValue(false);
        (window as unknown as Record<string, unknown>).confirm = origConfirm;

        const handle = installSandbox({ only: ['dialogs'] });
        handle.dispose();

        setAgentInProgress(true);
        window.confirm('after dispose?');

        expect(origConfirm).toHaveBeenCalled();
    });

    it('after dispose, prompt reverts to original', () => {
        const origPrompt = vi.fn().mockReturnValue(null);
        (window as unknown as Record<string, unknown>).prompt = origPrompt;

        const handle = installSandbox({ only: ['dialogs'] });
        handle.dispose();

        setAgentInProgress(true);
        window.prompt('after dispose');

        expect(origPrompt).toHaveBeenCalled();
    });

    it('after dispose, no more dialog events are emitted', () => {
        const origAlert = vi.fn();
        (window as unknown as Record<string, unknown>).alert = origAlert;

        const events: SandboxEvent[] = [];
        const handle = installSandbox({ only: ['dialogs'], onEvent: (e) => events.push(e) });
        handle.dispose();

        setAgentInProgress(true);
        window.alert('silent');

        expect(dialogEvents(events)).toHaveLength(0);
    });

    it('dispose is idempotent', () => {
        const handle: SandboxHandle = installSandbox({ only: ['dialogs'] });
        handle.dispose();
        expect(() => handle.dispose()).not.toThrow();
    });
});

// ─── Event shape ──────────────────────────────────────────────────────────────

describe('event shape', () => {
    it('emitted event has ts (number), source="dialogs", kind matching type, and data', () => {
        const events: SandboxEvent[] = [];
        const handle = installSandbox({ only: ['dialogs'], onEvent: (e) => events.push(e) });

        setAgentInProgress(true);
        window.alert('shape-check');

        const evt = dialogEvents(events)[0];
        expect(typeof evt.ts).toBe('number');
        expect(evt.source).toBe('dialogs');
        expect(evt.kind).toBe('alert');
        expect(evt.data).toBeDefined();
        expect((evt.data as { type: string }).type).toBe('alert');

        handle.dispose();
    });
});

// ─── Preset map ───────────────────────────────────────────────────────────────

describe('dialog presets', () => {
    it('presets map missing or non-Map: getAndConsumeDialogPreset returns undefined → uses default', () => {
        const handle = installSandbox({ only: ['dialogs'] });

        // Set a non-Map value — should degrade gracefully
        (window as unknown as Record<string, unknown>).__hfe_dialog_presets__ = { confirm: true };
        setAgentInProgress(true);

        // Should fall back to default (false) not throw
        expect(() => window.confirm('oops?')).not.toThrow();
        expect(window.confirm('oops?')).toBe(false);

        handle.dispose();
    });

    it('confirm and prompt presets are independent slots', () => {
        const handle = installSandbox({ only: ['dialogs'] });

        setDialogPresets(new Map<string, boolean | string>([
            ['confirm', true],
            ['prompt', 'hello'],
        ]));
        setAgentInProgress(true);

        expect(window.confirm('confirm?')).toBe(true);
        expect(window.prompt('prompt?')).toBe('hello');

        handle.dispose();
    });
});
