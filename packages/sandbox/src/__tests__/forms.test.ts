// @vitest-environment happy-dom
/**
 * Unit tests for the `forms` sandbox channel.
 *
 * Three interception points under test:
 *   1. HTMLInputElement.prototype.click (file inputs)
 *   2. window.FormData constructor — injects __hfe_injected_files__ into FormData
 *   3. HTMLFormElement.prototype.submit — converts to fetch when files injected
 *
 * Key invariant: user-triggered paths always pass through unchanged.
 * Agent-triggered paths (window.__hfe_agent_in_progress__ === true) are intercepted.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installSandbox } from '../index.js';
import { _resetForTesting } from '../chain.js';
import type { SandboxEvent } from '../types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function setAgent(value: boolean): void {
    (window as unknown as Record<string, unknown>).__hfe_agent_in_progress__ = value;
}

function clearAgent(): void {
    delete (window as unknown as Record<string, unknown>).__hfe_agent_in_progress__;
}

function makeFile(name: string, content = 'hello'): File {
    return new File([content], name, { type: 'text/plain' });
}

function injectFiles(input: HTMLInputElement, files: File[]): void {
    const dt = new DataTransfer();
    files.forEach((f) => dt.items.add(f));
    Object.defineProperty(input, 'files', { value: dt.files, writable: true, configurable: true });
    (input as unknown as Record<string, unknown>).__hfe_injected_files__ = dt.files;
}

afterEach(() => {
    _resetForTesting();
    clearAgent();
    delete (window as unknown as Record<string, unknown>).__hfe_pending_file_input__;
});

// ─── 1. file input click ──────────────────────────────────────────────────────

describe('HTMLInputElement.prototype.click — file input (forms channel)', () => {
    it('user-triggered: passes through to original click', () => {
        let nativeClicked = false;
        const origClick = HTMLInputElement.prototype.click;
        HTMLInputElement.prototype.click = function () { nativeClicked = true; };

        const handle = installSandbox({ only: ['forms'] });
        const input = document.createElement('input');
        input.type = 'file';

        // No agent flag
        input.click();

        expect(nativeClicked).toBe(true);
        handle.dispose();
        HTMLInputElement.prototype.click = origClick;
    });

    it('agent-triggered: suppresses native picker + emits event + parks reference', () => {
        let nativeClicked = false;
        const origClick = HTMLInputElement.prototype.click;
        HTMLInputElement.prototype.click = function () { nativeClicked = true; };

        const events: SandboxEvent[] = [];
        const handle = installSandbox({ only: ['forms'], onEvent: (e) => events.push(e) });

        const input = document.createElement('input');
        input.type = 'file';
        input.id = 'my-upload';
        document.body.appendChild(input);

        setAgent(true);
        input.click();

        expect(nativeClicked).toBe(false);
        const formsEvt = events.find((e) => e.source === 'forms');
        expect(formsEvt).toBeDefined();
        expect((formsEvt as any).kind).toBe('file_input_click');
        expect((window as any).__hfe_pending_file_input__).toBe(input);

        document.body.removeChild(input);
        handle.dispose();
        HTMLInputElement.prototype.click = origClick;
    });

    it('non-file input always passes through even with agent flag', () => {
        let nativeClicked = false;
        const origClick = HTMLInputElement.prototype.click;
        HTMLInputElement.prototype.click = function () { nativeClicked = true; };

        const handle = installSandbox({ only: ['forms'] });
        const input = document.createElement('input');
        input.type = 'text';

        setAgent(true);
        input.click();

        expect(nativeClicked).toBe(true);
        handle.dispose();
        HTMLInputElement.prototype.click = origClick;
    });
});

// ─── 2. FormData constructor ──────────────────────────────────────────────────

describe('window.FormData — file injection', () => {
    it('no injected files: FormData passes through unchanged', () => {
        const handle = installSandbox({ only: ['forms'] });

        const form = document.createElement('form');
        const textInput = document.createElement('input');
        textInput.name = 'username';
        textInput.value = 'alice';
        form.appendChild(textInput);
        document.body.appendChild(form);

        setAgent(true);
        const fd = new FormData(form);
        expect(fd.get('username')).toBe('alice');

        document.body.removeChild(form);
        handle.dispose();
    });

    it('agent + injected files: FormData replaces empty entry with real File', () => {
        const events: SandboxEvent[] = [];
        const handle = installSandbox({ only: ['forms'], onEvent: (e) => events.push(e) });

        const form = document.createElement('form');
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.name = 'attachment';
        form.appendChild(fileInput);
        document.body.appendChild(form);

        // Simulate what page.upload does
        injectFiles(fileInput, [makeFile('report.pdf', '%PDF-1.4')]);

        setAgent(true);
        const fd = new FormData(form);

        const entry = fd.get('attachment');
        expect(entry).toBeInstanceOf(File);
        expect((entry as File).name).toBe('report.pdf');

        // Event emitted
        const formsEvts = events.filter((e) => e.source === 'forms');
        expect(formsEvts.some((e) => (e as any).kind === 'formdata_patched')).toBe(true);

        document.body.removeChild(form);
        handle.dispose();
    });

    it('multiple injected files: all appended under the field name', () => {
        const handle = installSandbox({ only: ['forms'] });

        const form = document.createElement('form');
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.name = 'files';
        fileInput.setAttribute('multiple', '');
        form.appendChild(fileInput);
        document.body.appendChild(form);

        injectFiles(fileInput, [makeFile('a.txt'), makeFile('b.txt')]);

        setAgent(true);
        const fd = new FormData(form);
        const entries = fd.getAll('files');
        expect(entries).toHaveLength(2);
        expect((entries[0] as File).name).toBe('a.txt');
        expect((entries[1] as File).name).toBe('b.txt');

        document.body.removeChild(form);
        handle.dispose();
    });

    it('user-triggered (no agent flag): injected files NOT substituted', () => {
        const handle = installSandbox({ only: ['forms'] });

        const form = document.createElement('form');
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.name = 'doc';
        form.appendChild(fileInput);
        document.body.appendChild(form);

        injectFiles(fileInput, [makeFile('secret.pdf')]);

        // No agent flag — user is submitting, should NOT inject
        clearAgent();
        const fd = new FormData(form);

        // happy-dom's native FormData for a file input with no real selection = no entry
        // The key assertion: our patch did NOT inject the file
        const entry = fd.get('doc');
        expect(entry instanceof File && (entry as File).name === 'secret.pdf').toBe(false);

        document.body.removeChild(form);
        handle.dispose();
    });

    it('FormData() without form arg: works normally', () => {
        const handle = installSandbox({ only: ['forms'] });
        setAgent(true);

        const fd = new FormData();
        fd.append('key', 'value');
        expect(fd.get('key')).toBe('value');

        handle.dispose();
    });
});

// ─── 3. HTMLFormElement.prototype.submit ──────────────────────────────────────

describe('HTMLFormElement.prototype.submit — file interception', () => {
    it('no injected files: calls native submit unchanged', () => {
        let nativeSubmitCalled = false;
        const origSubmit = HTMLFormElement.prototype.submit;
        HTMLFormElement.prototype.submit = function () { nativeSubmitCalled = true; };

        const handle = installSandbox({ only: ['forms'] });

        const form = document.createElement('form');
        document.body.appendChild(form);

        setAgent(true);
        form.submit();

        expect(nativeSubmitCalled).toBe(true);

        document.body.removeChild(form);
        handle.dispose();
        HTMLFormElement.prototype.submit = origSubmit;
    });

    it('user-triggered (no agent flag): always calls native submit', () => {
        let nativeSubmitCalled = false;
        const origSubmit = HTMLFormElement.prototype.submit;
        HTMLFormElement.prototype.submit = function () { nativeSubmitCalled = true; };

        const handle = installSandbox({ only: ['forms'] });

        const form = document.createElement('form');
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.name = 'doc';
        form.appendChild(fileInput);
        document.body.appendChild(form);

        injectFiles(fileInput, [makeFile('x.pdf')]);

        clearAgent(); // user, not agent
        form.submit();

        expect(nativeSubmitCalled).toBe(true);

        document.body.removeChild(form);
        handle.dispose();
        HTMLFormElement.prototype.submit = origSubmit;
    });

    it('agent + injected files: converts to fetch instead of native submit', async () => {
        const fetchCalls: { url: string; method: string; body: FormData }[] = [];
        const origFetch = window.fetch;
        window.fetch = vi.fn(async (url, init) => {
            fetchCalls.push({ url: String(url), method: (init?.method ?? 'GET'), body: init?.body as FormData });
            return new Response(null, { status: 200 });
        });

        let nativeSubmitCalled = false;
        const origSubmit = HTMLFormElement.prototype.submit;
        HTMLFormElement.prototype.submit = function () { nativeSubmitCalled = true; };

        const events: SandboxEvent[] = [];
        const handle = installSandbox({ only: ['forms'], onEvent: (e) => events.push(e) });

        const form = document.createElement('form');
        form.action = '/api/upload';
        form.method = 'POST';
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.name = 'attachment';
        form.appendChild(fileInput);
        document.body.appendChild(form);

        injectFiles(fileInput, [makeFile('data.csv', 'a,b,c')]);

        setAgent(true);
        form.submit();

        // Give the async fetch a tick to be called
        await new Promise((r) => setTimeout(r, 0));

        expect(nativeSubmitCalled).toBe(false);
        expect(fetchCalls).toHaveLength(1);
        expect(fetchCalls[0].method).toBe('POST');

        // Event emitted
        const submitEvt = events.find(
            (e) => e.source === 'forms' && (e as any).kind === 'form_submit_intercepted',
        );
        expect(submitEvt).toBeDefined();

        document.body.removeChild(form);
        handle.dispose();
        HTMLFormElement.prototype.submit = origSubmit;
        window.fetch = origFetch;
    });

    it('fetch fails: falls back to native submit', async () => {
        window.fetch = vi.fn(async () => { throw new Error('network error'); });

        let nativeSubmitCalled = false;
        const origSubmit = HTMLFormElement.prototype.submit;
        HTMLFormElement.prototype.submit = function () { nativeSubmitCalled = true; };

        const handle = installSandbox({ only: ['forms'] });

        const form = document.createElement('form');
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.name = 'f';
        form.appendChild(fileInput);
        document.body.appendChild(form);

        injectFiles(fileInput, [makeFile('x.pdf')]);
        setAgent(true);
        form.submit();

        // Wait for fetch to fail and fallback to fire
        await new Promise((r) => setTimeout(r, 10));

        expect(nativeSubmitCalled).toBe(true);

        document.body.removeChild(form);
        handle.dispose();
        HTMLFormElement.prototype.submit = origSubmit;
        window.fetch = fetch;
    });
});

// ─── 4. dispose reverts all patches ──────────────────────────────────────────

describe('uninstall', () => {
    it('after dispose: FormData is the original constructor', () => {
        const OrigFD = window.FormData;
        const handle = installSandbox({ only: ['forms'] });
        expect(window.FormData).not.toBe(OrigFD);
        handle.dispose();
        expect(window.FormData).toBe(OrigFD);
    });

    it('after dispose: file input click passes to original', () => {
        let nativeClicked = false;
        const origClick = HTMLInputElement.prototype.click;
        HTMLInputElement.prototype.click = function () { nativeClicked = true; };

        const handle = installSandbox({ only: ['forms'] });
        handle.dispose();

        const input = document.createElement('input');
        input.type = 'file';
        setAgent(true);
        input.click(); // after dispose, no interception

        expect(nativeClicked).toBe(true);
        HTMLInputElement.prototype.click = origClick;
    });
});
