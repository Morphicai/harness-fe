/**
 * Dialogs channel — intercepts blocking browser APIs when triggered by an
 * agent command, letting them pass through unchanged for user interactions.
 *
 * Intercepted (agent-triggered only):
 *   window.alert / confirm / prompt / print
 *   beforeunload event (never suppressed by this channel; agent-triggered
 *   navigations pass through untouched so no native "Leave site?" dialog is
 *   shown — see channel section 2 below for rationale)
 *
 * User-triggered calls: always passed to the native implementation.
 *
 * Agent vs user distinction: all agent command handlers set
 * `window.__hfe_agent_in_progress__ = true` for the duration of the command
 * (see RuntimeClient.handleCommand). This flag is read synchronously here.
 *
 * Dialog presets (for confirm/prompt return values) are written by the
 * SET_DIALOG_HANDLER command into `window.__hfe_dialog_presets__`, which is
 * populated by runtime-client/index.ts from the `dialogPresets` Map.
 *
 * Note: HTMLInputElement.prototype.click (file inputs) has been moved to the
 * `forms` channel (channels/forms.ts).
 */

import type { DialogsObservation } from '../types.js';
import { emit, registerPatch } from '../chain.js';

const PATCHED_FLAG = '__hfeSandboxDialogsPatched__';

function isAgentInProgress(): boolean {
    return (window as unknown as Record<string, unknown>).__hfe_agent_in_progress__ === true;
}

/** Read and consume a dialog preset written by SET_DIALOG_HANDLER. */
function getAndConsumeDialogPreset(type: string): boolean | string | undefined {
    const presets = (window as unknown as Record<string, unknown>).__hfe_dialog_presets__;
    if (!presets || !(presets instanceof Map)) return undefined;
    const value = (presets as Map<string, boolean | string>).get(type);
    if (value !== undefined) (presets as Map<string, boolean | string>).delete(type);
    return value;
}

function emitDialog(data: DialogsObservation): void {
    emit('dialogs', { ts: Date.now(), source: 'dialogs', kind: data.type, data });
}

function installDialogsPatch(): () => void {
    if (typeof window === 'undefined') return () => {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((window as any)[PATCHED_FLAG]) return () => {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any)[PATCHED_FLAG] = true;

    // ── 1. alert / confirm / prompt / print ──────────────────────────────────

    const origAlert = window.alert.bind(window);
    const origConfirm = window.confirm.bind(window);
    const origPrompt = window.prompt.bind(window);
    const origPrint = window.print.bind(window);

    window.alert = function (msg?: unknown): void {
        if (!isAgentInProgress()) { origAlert(msg); return; }
        emitDialog({ type: 'alert', message: String(msg ?? '') });
        // Agent-triggered alert is silently suppressed.
    };

    window.confirm = function (msg?: string): boolean {
        if (!isAgentInProgress()) return origConfirm(msg);
        const preset = getAndConsumeDialogPreset('confirm');
        const returnValue = (preset as boolean | undefined) ?? false;
        emitDialog({ type: 'confirm', message: String(msg ?? ''), returnValue });
        return returnValue;
    };

    window.prompt = function (msg?: string, _default?: string): string | null {
        if (!isAgentInProgress()) return origPrompt(msg, _default);
        const preset = getAndConsumeDialogPreset('prompt');
        const returnValue = (preset as string | null | undefined) ?? null;
        emitDialog({ type: 'prompt', message: String(msg ?? ''), returnValue });
        return returnValue;
    };

    window.print = function (): void {
        if (!isAgentInProgress()) { origPrint(); return; }
        emitDialog({ type: 'print' });
        // Agent-triggered print is silently suppressed.
    };

    // ── 2. beforeunload — never call preventDefault(); a page can only ASK the
    //      browser to show its native "unsaved changes" dialog by calling
    //      preventDefault()/setting returnValue, and once shown that dialog
    //      cannot be suppressed by JS (spec, anti-abuse). So when an agent
    //      command triggers navigation, this listener must leave the event
    //      completely untouched — it only observes/emits for telemetry.

    const beforeunloadHandler = (e: BeforeUnloadEvent): void => {
        if (!isAgentInProgress()) return;
        emitDialog({ type: 'beforeunload' });
        // Deliberately do NOT call e.preventDefault() / set e.returnValue.
        // This channel only observes; it must never be the reason the native
        // "leave site?" dialog appears during an agent-triggered navigation.
    };
    window.addEventListener('beforeunload', beforeunloadHandler, true);

    // ── Uninstall ─────────────────────────────────────────────────────────────

    return function uninstall(): void {
        window.alert = origAlert;
        window.confirm = origConfirm;
        window.prompt = origPrompt;
        window.print = origPrint;
        window.removeEventListener('beforeunload', beforeunloadHandler, true);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        delete (window as any)[PATCHED_FLAG];
    };
}

registerPatch('dialogs', installDialogsPatch);
