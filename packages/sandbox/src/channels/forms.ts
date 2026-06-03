/**
 * Forms channel — intercepts HTML element APIs that affect form submission,
 * ensuring agent-injected files (via page.upload) actually reach the backend.
 *
 * Intercepted (agent-triggered only, via __hfe_agent_in_progress__ flag):
 *   HTMLInputElement.prototype.click  (file inputs → suppress native picker)
 *   window.FormData constructor       (inject __hfe_injected_files__ into FormData)
 *   HTMLFormElement.prototype.submit  (convert to fetch when injected files present)
 *
 * User-triggered calls always pass through unchanged.
 */

import type { FormsObservation } from '../types.js';
import { emit, registerPatch } from '../chain.js';

const PATCHED_FLAG = '__hfeSandboxFormsPatched__';
const FORM_PATCHED = '__hfeSandboxFormSubmitPatched__';

function isAgentInProgress(): boolean {
    return (window as unknown as Record<string, unknown>).__hfe_agent_in_progress__ === true;
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

function emitForms(data: FormsObservation): void {
    emit('forms', { ts: Date.now(), source: 'forms', kind: data.type, data });
}

function installFormsPatch(): () => void {
    if (typeof window === 'undefined') return () => {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((window as any)[PATCHED_FLAG]) return () => {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any)[PATCHED_FLAG] = true;

    // ── 1. HTMLInputElement.prototype.click (file inputs only) ───────────────

    const origInputClick = HTMLInputElement.prototype.click;

    const patchedInputClick = function (this: HTMLInputElement): void {
        if (this.type !== 'file' || !isAgentInProgress()) {
            origInputClick.call(this);
            return;
        }
        // Agent triggered a file-picker click — suppress the native dialog.
        const selector = deriveSelector(this);
        emitForms({ type: 'file_input_click', selector });
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

    // ── 2. window.FormData constructor override ───────────────────────────────

    const OrigFormData = window.FormData;

    const PatchedFormData = function FormData(
        this: globalThis.FormData,
        form?: HTMLFormElement | null,
        submitter?: HTMLElement | null,
    ): globalThis.FormData {
        // Create the native FormData first
        const fd: globalThis.FormData = form != null
            ? new OrigFormData(form, submitter as HTMLElement | undefined)
            : new OrigFormData();

        // Only patch when agent is in progress and form is provided
        if (form instanceof HTMLFormElement && isAgentInProgress()) {
            const fileInputs = form.querySelectorAll<HTMLInputElement>('input[type="file"]');
            fileInputs.forEach((input) => {
                const injected = (input as unknown as Record<string, unknown>).__hfe_injected_files__ as FileList | undefined;
                if (!injected || injected.length === 0) return;

                const name = input.name || 'file';
                // Remove the empty entry the browser added (internal C++ FileList is empty)
                fd.delete(name);
                // Append our real File objects
                for (let i = 0; i < injected.length; i++) {
                    fd.append(name, injected[i]);
                }
                emitForms({ type: 'formdata_patched', field: name, fileCount: injected.length });
            });
        }

        return fd;
    } as unknown as typeof FormData;

    // Copy static properties and prototype
    Object.setPrototypeOf(PatchedFormData, OrigFormData);
    PatchedFormData.prototype = OrigFormData.prototype;

    window.FormData = PatchedFormData;

    // ── 3. HTMLFormElement.prototype.submit override ──────────────────────────

    const origSubmit = HTMLFormElement.prototype.submit;

    if (!(HTMLFormElement.prototype as unknown as Record<string, unknown>)[FORM_PATCHED]) {
        (HTMLFormElement.prototype as unknown as Record<string, unknown>)[FORM_PATCHED] = true;

        HTMLFormElement.prototype.submit = function (this: HTMLFormElement): void {
            // Check if any file input in this form has injected files
            const fileInputs = Array.from(
                this.querySelectorAll<HTMLInputElement>('input[type="file"]'),
            );
            const hasInjected = fileInputs.some(
                (el) => ((el as unknown as Record<string, unknown>).__hfe_injected_files__ as FileList | undefined)?.length,
            );

            // User submit or no injected files → native behavior
            if (!hasInjected || !isAgentInProgress()) {
                return origSubmit.call(this);
            }

            // Convert to fetch using our patched FormData (which injects files)
            const action = this.action || window.location.href;
            const method = (this.method || 'POST').toUpperCase();
            const fd = new FormData(this); // uses our patched FormData

            emitForms({ type: 'form_submit_intercepted', action, method });

            fetch(action, {
                method,
                body: method === 'GET' ? undefined : fd,
            })
                .then((res) => {
                    if (res.redirected) window.location.href = res.url;
                })
                .catch(() => {
                    // Fallback: let the browser handle it natively
                    origSubmit.call(this);
                });
        };
    }

    // ── Uninstall ─────────────────────────────────────────────────────────────

    return function uninstall(): void {
        try {
            HTMLInputElement.prototype.click = origInputClick;
        } catch { /* ignore */ }
        if (window.FormData === PatchedFormData) {
            window.FormData = OrigFormData;
        }
        HTMLFormElement.prototype.submit = origSubmit;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        delete (window as any)[PATCHED_FLAG];
        delete (HTMLFormElement.prototype as unknown as Record<string, unknown>)[FORM_PATCHED];
        delete (window as unknown as Record<string, unknown>).__hfe_pending_file_input__;
    };
}

registerPatch('forms', installFormsPatch);
