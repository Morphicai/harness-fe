// @vitest-environment happy-dom
/**
 * Behavior tests for PAGE_SCREENSHOT — focused on the two recent bug fixes:
 * 1. The overlay host must be hidden during capture so it never bleeds into
 *    the resulting image.
 * 2. The screenshot must end up with an opaque background by default so a
 *    transparent page doesn't render a visually blank result.
 *
 * We stub `@zumer/snapdom` (the underlying capture library) since it pulls
 * in DOM canvas APIs that aren't well-modeled in happy-dom.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Window } from 'happy-dom';
import { COMMAND, CONTROL_COMMANDS, type ScreenshotArgs } from '@harness-fe/protocol';

const snapdomCalls: Array<{ target: unknown; options: { backgroundColor?: string } }> = [];
const overlayVisibilityDuringSnapdom: string[] = [];

vi.mock('@zumer/snapdom', () => ({
    snapdom: vi.fn(async (target: unknown, options: { backgroundColor?: string }) => {
        snapdomCalls.push({ target, options });
        const host = document.getElementById('__harness_fe_overlay__') as HTMLElement | null;
        overlayVisibilityDuringSnapdom.push(host?.style.visibility ?? '<no overlay host>');
        return {
            toCanvas: async () => {
                const canvas = document.createElement('canvas');
                canvas.width = 200;
                canvas.height = 100;
                return canvas;
            },
        };
    }),
}));

function setupDom(): void {
    const win = new Window();
    globalThis.window = win as unknown as typeof globalThis.window;
    globalThis.document = win.document as unknown as typeof globalThis.document;
    globalThis.HTMLElement = win.HTMLElement as unknown as typeof HTMLElement;
}

describe('PAGE_SCREENSHOT', () => {
    afterEach(() => {
        snapdomCalls.length = 0;
        overlayVisibilityDuringSnapdom.length = 0;
        document.getElementById('__harness_fe_overlay__')?.remove();
    });

    async function loadHandlers() {
        const mod = await import('./commands.js');
        return mod.commandHandlers;
    }

    function fakeCtx() {
        return {
            capture: {
                console: { push: () => {} },
                errors: { push: () => {} },
                network: { push: () => {} },
            },
        } as unknown as Parameters<Awaited<ReturnType<typeof loadHandlers>>[typeof COMMAND.PAGE_SCREENSHOT]>[1];
    }

    it('uses an opaque white background by default (transparent pages no longer render blank)', async () => {
        setupDom();
        const handlers = await loadHandlers();
        await handlers[COMMAND.PAGE_SCREENSHOT]({ format: 'webp' } satisfies ScreenshotArgs, fakeCtx());
        expect(snapdomCalls).toHaveLength(1);
        expect(snapdomCalls[0].options.backgroundColor).toBe('#ffffff');
    });

    it('preserves transparency when backgroundColor: null is explicitly passed', async () => {
        setupDom();
        const handlers = await loadHandlers();
        await handlers[COMMAND.PAGE_SCREENSHOT](
            { format: 'png', backgroundColor: null } satisfies ScreenshotArgs,
            fakeCtx(),
        );
        expect(snapdomCalls[0].options.backgroundColor).toBeUndefined();
    });

    it('honors a custom backgroundColor', async () => {
        setupDom();
        const handlers = await loadHandlers();
        await handlers[COMMAND.PAGE_SCREENSHOT](
            { format: 'png', backgroundColor: '#0a0a0f' } satisfies ScreenshotArgs,
            fakeCtx(),
        );
        expect(snapdomCalls[0].options.backgroundColor).toBe('#0a0a0f');
    });

    it('hides the overlay host during capture and restores its visibility afterwards', async () => {
        setupDom();
        const host = document.createElement('div');
        host.id = '__harness_fe_overlay__';
        host.style.visibility = ''; // start visible
        document.body.appendChild(host);

        const handlers = await loadHandlers();
        await handlers[COMMAND.PAGE_SCREENSHOT]({ format: 'webp' } satisfies ScreenshotArgs, fakeCtx());

        // During the snapdom call we captured the overlay's current visibility.
        expect(overlayVisibilityDuringSnapdom).toHaveLength(1);
        expect(overlayVisibilityDuringSnapdom[0]).toBe('hidden');
        // After the handler returned, the overlay is visible again.
        expect(host.style.visibility).toBe('');
    });

    it('restores overlay visibility even if snapdom throws (try/finally)', async () => {
        setupDom();
        const host = document.createElement('div');
        host.id = '__harness_fe_overlay__';
        host.style.visibility = '';
        document.body.appendChild(host);

        // Make snapdom reject for this single call.
        const { snapdom } = await import('@zumer/snapdom');
        (snapdom as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('boom'));

        const handlers = await loadHandlers();
        await expect(
            handlers[COMMAND.PAGE_SCREENSHOT]({ format: 'webp' } satisfies ScreenshotArgs, fakeCtx()),
        ).rejects.toThrow(/boom/);
        // Overlay must be restored regardless.
        expect(host.style.visibility).toBe('');
    });
});

// ─── New interaction commands ────────────────────────────────────────────────

describe('new interaction commands', () => {
    async function loadHandlers() {
        const mod = await import('./commands.js');
        return mod.commandHandlers;
    }

    function fakeCtx() {
        return {
            capture: {
                console: { push: () => {} },
                errors: { push: () => {} },
                network: { push: () => {} },
            },
        } as unknown as Parameters<Awaited<ReturnType<typeof loadHandlers>>[typeof COMMAND.PAGE_SCREENSHOT]>[1];
    }

    beforeEach(() => {
        setupDom();
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    // ── page.select ──────────────────────────────────────────────────────────

    describe('page.select', () => {
        it('sets <select> value and fires change + input events', async () => {
            const sel = document.createElement('select');
            sel.id = 'my-select';
            const optA = document.createElement('option');
            optA.value = 'a';
            optA.textContent = 'Option A';
            const optB = document.createElement('option');
            optB.value = 'b';
            optB.textContent = 'Option B';
            sel.appendChild(optA);
            sel.appendChild(optB);
            document.body.appendChild(sel);

            const fired: string[] = [];
            sel.addEventListener('change', () => fired.push('change'));
            sel.addEventListener('input', () => fired.push('input'));

            const handlers = await loadHandlers();
            await handlers[COMMAND.PAGE_SELECT]({ selector: { css: '#my-select' }, value: 'b' }, fakeCtx());

            expect(sel.value).toBe('b');
            expect(fired).toContain('change');
            expect(fired).toContain('input');
        });

        it('throws if element not found', async () => {
            const handlers = await loadHandlers();
            await expect(
                handlers[COMMAND.PAGE_SELECT]({ selector: { css: '#does-not-exist' }, value: 'x' }, fakeCtx()),
            ).rejects.toThrow(/not found/);
        });
    });

    // ── page.check ───────────────────────────────────────────────────────────

    describe('page.check', () => {
        it('sets checkbox checked=true and fires change + input events', async () => {
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.id = 'cb';
            document.body.appendChild(cb);

            const fired: string[] = [];
            cb.addEventListener('change', () => fired.push('change'));
            cb.addEventListener('input', () => fired.push('input'));

            const handlers = await loadHandlers();
            await handlers[COMMAND.PAGE_CHECK]({ selector: { css: '#cb' }, checked: true }, fakeCtx());

            expect(cb.checked).toBe(true);
            expect(fired).toContain('change');
            expect(fired).toContain('input');
        });

        it('sets radio button checked state', async () => {
            const rb = document.createElement('input');
            rb.type = 'radio';
            rb.id = 'rb';
            document.body.appendChild(rb);

            const handlers = await loadHandlers();
            await handlers[COMMAND.PAGE_CHECK]({ selector: { css: '#rb' }, checked: true }, fakeCtx());

            expect(rb.checked).toBe(true);
        });

        it('throws for non-checkbox/radio input', async () => {
            const input = document.createElement('input');
            input.type = 'text';
            input.id = 'txt';
            document.body.appendChild(input);

            const handlers = await loadHandlers();
            await expect(
                handlers[COMMAND.PAGE_CHECK]({ selector: { css: '#txt' }, checked: true }, fakeCtx()),
            ).rejects.toThrow(/checkbox|radio/);
        });
    });

    // ── page.upload ──────────────────────────────────────────────────────────

    describe('page.upload', () => {
        it('injects files into file input and fires change event', async () => {
            const fi = document.createElement('input');
            fi.type = 'file';
            fi.id = 'fi';
            document.body.appendChild(fi);

            const fired: string[] = [];
            fi.addEventListener('change', () => fired.push('change'));

            const handlers = await loadHandlers();
            await handlers[COMMAND.PAGE_UPLOAD](
                {
                    selector: { css: '#fi' },
                    files: [{ name: 'test.txt', content: btoa('hello'), mimeType: 'text/plain' }],
                },
                fakeCtx(),
            );

            expect(fi.files).not.toBeNull();
            expect(fi.files!.length).toBe(1);
            expect(fi.files![0].name).toBe('test.txt');
            expect(fired).toContain('change');
        });

        it('throws for non-file input', async () => {
            const input = document.createElement('input');
            input.type = 'text';
            input.id = 'not-file';
            document.body.appendChild(input);

            const handlers = await loadHandlers();
            await expect(
                handlers[COMMAND.PAGE_UPLOAD](
                    { selector: { css: '#not-file' }, files: [{ name: 'x.txt', content: btoa('x') }] },
                    fakeCtx(),
                ),
            ).rejects.toThrow(/file/);
        });

        it('returns fileCount in result', async () => {
            const fi = document.createElement('input');
            fi.type = 'file';
            fi.id = 'fi2';
            document.body.appendChild(fi);

            const handlers = await loadHandlers();
            const result = await handlers[COMMAND.PAGE_UPLOAD](
                {
                    selector: { css: '#fi2' },
                    files: [{ name: 'a.txt', content: btoa('hello'), mimeType: 'text/plain' }],
                },
                fakeCtx(),
            ) as { fileCount: number };

            expect(result.fileCount).toBe(1);
        });
    });

    // ── page.paste ───────────────────────────────────────────────────────────

    describe('page.paste', () => {
        it('dispatches ClipboardEvent with text/plain content', async () => {
            const editor = document.createElement('div');
            editor.id = 'editor';
            editor.contentEditable = 'true';
            document.body.appendChild(editor);

            let capturedText: string | null = null;
            editor.addEventListener('paste', (e) => {
                capturedText = (e as ClipboardEvent).clipboardData?.getData('text/plain') ?? null;
            });

            const handlers = await loadHandlers();
            await handlers[COMMAND.PAGE_PASTE](
                { selector: { css: '#editor' }, content: 'hello world' },
                fakeCtx(),
            );

            expect(capturedText).toBe('hello world');
        });

        it('includes text/html when html option provided', async () => {
            const editor = document.createElement('div');
            editor.id = 'editor2';
            editor.contentEditable = 'true';
            document.body.appendChild(editor);

            let capturedHtml: string | null = null;
            editor.addEventListener('paste', (e) => {
                capturedHtml = (e as ClipboardEvent).clipboardData?.getData('text/html') ?? null;
            });

            const handlers = await loadHandlers();
            await handlers[COMMAND.PAGE_PASTE](
                { selector: { css: '#editor2' }, content: 'plain', html: '<b>bold</b>' },
                fakeCtx(),
            );

            expect(capturedHtml).toBe('<b>bold</b>');
        });

        it('is fire-and-forget — resolves immediately with { length: N }', async () => {
            const editor = document.createElement('div');
            editor.id = 'editor3';
            editor.contentEditable = 'true';
            document.body.appendChild(editor);

            const handlers = await loadHandlers();
            const result = await handlers[COMMAND.PAGE_PASTE](
                { selector: { css: '#editor3' }, content: 'abc' },
                fakeCtx(),
            ) as { length: number };

            expect(result.length).toBe(3);
        });
    });

    // ── page.set_dialog_handler ──────────────────────────────────────────────

    describe('page.set_dialog_handler', () => {
        it('sets a preset for confirm type', async () => {
            const { dialogPresets } = await import('./commands.js');
            dialogPresets.clear();

            const handlers = await loadHandlers();
            await handlers[COMMAND.SET_DIALOG_HANDLER]({ type: 'confirm', value: true }, fakeCtx());

            expect(dialogPresets.get('confirm')).toBe(true);
        });

        it('clears preset when value is undefined', async () => {
            const { dialogPresets } = await import('./commands.js');
            dialogPresets.set('confirm', true);

            const handlers = await loadHandlers();
            await handlers[COMMAND.SET_DIALOG_HANDLER]({ type: 'confirm' }, fakeCtx());

            expect(dialogPresets.get('confirm')).toBeUndefined();
        });

        it('does not require consent (is not in CONTROL_COMMANDS)', () => {
            expect(CONTROL_COMMANDS.has(COMMAND.SET_DIALOG_HANDLER)).toBe(false);
        });
    });
});
