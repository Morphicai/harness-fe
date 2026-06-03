/**
 * Dialogs channel — intercepts blocking browser APIs when triggered by an
 * agent command, letting them pass through unchanged for user interactions.
 *
 * Intercepted (agent-triggered only):
 *   window.alert / confirm / prompt / print
 *   HTMLInputElement.prototype.click (file inputs only)
 *   beforeunload event (suppressed while agent command is in flight)
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

/** Derive a best-effort CSS selector string from a DOM element. */
function deriveSelector(el: Element): string {
    if (el.id) return `#${CSS.escape(el.id)}`;
    const tag = el.tagName.toLowerCase();
    const cls = Array.from(el.classList)
        .slice(0, 2)
        .map((c) => `.${CSS.escape(c)}`)
        .join('');
    return `${tag}${cls}`;
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

    // ── 2. HTMLInputElement.prototype.click (file inputs only) ───────────────

    const origInputClick = HTMLInputElement.prototype.click;

    const patchedInputClick = function (this: HTMLInputElement): void {
        if (this.type !== 'file' || !isAgentInProgress()) {
            origInputClick.call(this);
            return;
        }
        // Agent triggered a file-picker click — suppress the native dialog.
        const selector = deriveSelector(this);
        emitDialog({ type: 'file_input_click', selector });
        // Park a reference so page.upload can find the element without a selector.
        (window as unknown as Record<string, unknown>).__hfe_pending_file_input__ = this;
        // Auto-clear after 30 s if the agent never responds.
        const ref = this;
        setTimeout(() => {
            const w = window as unknown as Record<string, unknown>;
            if (w.__hfe_pending_file_input__ === ref) {
                w.__hfe_pending_file_input__ = null;
            }
        }, 30_000);
    };

    try {
        HTMLInputElement.prototype.click = patchedInputClick;
    } catch {
        // Non-configurable prototype in some hardened environments — degrade silently.
    }

    // ── 3. beforeunload — suppress when agent command is in progress ──────────

    const beforeunloadHandler = (e: BeforeUnloadEvent): void => {
        if (!isAgentInProgress()) return;
        e.preventDefault();
        emitDialog({ type: 'beforeunload' });
    };
    window.addEventListener('beforeunload', beforeunloadHandler, true);

    // ── Uninstall ─────────────────────────────────────────────────────────────

    return function uninstall(): void {
        window.alert = origAlert;
        window.confirm = origConfirm;
        window.prompt = origPrompt;
        window.print = origPrint;
        try {
            HTMLInputElement.prototype.click = origInputClick;
        } catch { /* ignore */ }
        window.removeEventListener('beforeunload', beforeunloadHandler, true);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        delete (window as any)[PATCHED_FLAG];
        delete (window as unknown as Record<string, unknown>).__hfe_pending_file_input__;
    };
}

registerPatch('dialogs', installDialogsPatch);
