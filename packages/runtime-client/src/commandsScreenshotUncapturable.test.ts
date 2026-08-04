// @vitest-environment happy-dom
/**
 * page.screenshot (snapdom, a DOM-to-canvas walker) silently produces a blank
 * region for a tainted <canvas>, an unready/cross-origin <video> frame, or a
 * cross-origin <iframe> — indistinguishable from "genuinely empty" without
 * inspecting the DOM ourselves first (harness-fe#205). This tests the
 * `notCaptured` detection, independent of snapdom itself (mocked below).
 */

import { afterEach, describe, expect, it } from 'vitest';
import { Window } from 'happy-dom';
import { COMMAND, type ScreenshotArgs } from '@harness-fe/protocol';
import { vi } from 'vitest';

vi.mock('@zumer/snapdom', () => ({
    snapdom: vi.fn(async () => ({
        toCanvas: async () => {
            const canvas = document.createElement('canvas');
            canvas.width = 10;
            canvas.height = 10;
            return canvas;
        },
    })),
}));

function setupDom(): void {
    const win = new Window();
    globalThis.window = win as unknown as typeof globalThis.window;
    globalThis.document = win.document as unknown as typeof globalThis.document;
    globalThis.HTMLElement = win.HTMLElement as unknown as typeof HTMLElement;
    globalThis.HTMLCanvasElement = win.HTMLCanvasElement as unknown as typeof HTMLCanvasElement;
    globalThis.HTMLVideoElement = win.HTMLVideoElement as unknown as typeof HTMLVideoElement;
    globalThis.HTMLIFrameElement = win.HTMLIFrameElement as unknown as typeof HTMLIFrameElement;
}

describe('PAGE_SCREENSHOT — notCaptured detection', () => {
    afterEach(() => {
        document.body.innerHTML = '';
    });

    async function loadHandlers() {
        const mod = await import('./commands.js');
        return mod.commandHandlers;
    }

    function fakeCtx() {
        return { capture: {} } as never;
    }

    it('does not flag a normal (untainted) canvas', async () => {
        setupDom();
        const handlers = await loadHandlers();
        document.body.appendChild(document.createElement('canvas'));

        const result = (await handlers[COMMAND.PAGE_SCREENSHOT](
            { format: 'png' } satisfies ScreenshotArgs,
            fakeCtx(),
        )) as { notCaptured: Array<{ tag: string }> };
        expect(result.notCaptured).toEqual([]);
    });

    it('flags a tainted canvas (toDataURL throws)', async () => {
        setupDom();
        const handlers = await loadHandlers();
        const canvas = document.createElement('canvas');
        canvas.id = 'tainted';
        canvas.toDataURL = () => { throw new Error('SecurityError: tainted canvas'); };
        document.body.appendChild(canvas);

        const result = (await handlers[COMMAND.PAGE_SCREENSHOT](
            { format: 'png' } satisfies ScreenshotArgs,
            fakeCtx(),
        )) as { notCaptured: Array<{ tag: string; selector?: string }> };
        expect(result.notCaptured).toEqual([{ tag: 'canvas', selector: '#tainted' }]);
    });

    it('flags a <video> with no frame available yet (readyState < HAVE_CURRENT_DATA)', async () => {
        setupDom();
        const handlers = await loadHandlers();
        const video = document.createElement('video');
        video.id = 'not-ready';
        document.body.appendChild(video);

        const result = (await handlers[COMMAND.PAGE_SCREENSHOT](
            { format: 'png' } satisfies ScreenshotArgs,
            fakeCtx(),
        )) as { notCaptured: Array<{ tag: string; selector?: string }> };
        expect(result.notCaptured).toEqual([{ tag: 'video', selector: '#not-ready' }]);
    });

    it('does not flag a same-origin iframe', async () => {
        setupDom();
        const handlers = await loadHandlers();
        document.body.appendChild(document.createElement('iframe'));

        const result = (await handlers[COMMAND.PAGE_SCREENSHOT](
            { format: 'png' } satisfies ScreenshotArgs,
            fakeCtx(),
        )) as { notCaptured: Array<{ tag: string }> };
        expect(result.notCaptured).toEqual([]);
    });

    it('flags a cross-origin iframe (contentDocument access throws)', async () => {
        setupDom();
        const handlers = await loadHandlers();
        const iframe = document.createElement('iframe');
        iframe.id = 'cross-origin';
        document.body.appendChild(iframe);
        Object.defineProperty(iframe, 'contentDocument', {
            get() { throw new Error('SecurityError: cross-origin'); },
        });
        Object.defineProperty(iframe, 'contentWindow', {
            get() { throw new Error('SecurityError: cross-origin'); },
        });

        const result = (await handlers[COMMAND.PAGE_SCREENSHOT](
            { format: 'png' } satisfies ScreenshotArgs,
            fakeCtx(),
        )) as { notCaptured: Array<{ tag: string; selector?: string }> };
        expect(result.notCaptured).toEqual([{ tag: 'iframe', selector: '#cross-origin' }]);
    });
});
