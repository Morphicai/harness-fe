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

import { afterEach, describe, expect, it, vi } from 'vitest';
import { Window } from 'happy-dom';
import { COMMAND, type ScreenshotArgs } from '@harness-fe/protocol';

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
