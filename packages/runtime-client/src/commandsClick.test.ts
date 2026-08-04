// @vitest-environment happy-dom
/**
 * PAGE_CLICK must dispatch the full pointerdown -> mousedown -> pointerup ->
 * mouseup -> click sequence, not a lone 'click'. Portal-based menus (Radix UI
 * Popover/DropdownMenu and similar) gate their open logic on 'pointerdown',
 * so a single 'click' event never opens them (harness-fe#203).
 */

import { afterEach, describe, expect, it } from 'vitest';
import { Window } from 'happy-dom';
import { COMMAND, type ClickArgs } from '@harness-fe/protocol';

function setupDom(): void {
    const win = new Window();
    globalThis.window = win as unknown as typeof globalThis.window;
    globalThis.document = win.document as unknown as typeof globalThis.document;
    globalThis.HTMLElement = win.HTMLElement as unknown as typeof HTMLElement;
    globalThis.MouseEvent = win.MouseEvent as unknown as typeof MouseEvent;
    globalThis.PointerEvent = win.PointerEvent as unknown as typeof PointerEvent;
}

describe('PAGE_CLICK', () => {
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

    it('dispatches pointerdown before click, so Radix-style portal menus open', async () => {
        setupDom();
        const handlers = await loadHandlers();
        const button = document.createElement('button');
        button.id = 'trigger';
        document.body.appendChild(button);

        const order: string[] = [];
        for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
            button.addEventListener(type, () => order.push(type));
        }

        const args: ClickArgs = { selector: { css: '#trigger' } };
        await handlers[COMMAND.PAGE_CLICK](args, fakeCtx());

        expect(order).toEqual(['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']);
    });

    it('opens a Radix-style menu that only listens for pointerdown', async () => {
        setupDom();
        const handlers = await loadHandlers();
        const button = document.createElement('button');
        button.id = 'trigger';
        document.body.appendChild(button);

        let menuOpen = false;
        button.addEventListener('pointerdown', () => {
            menuOpen = true;
        });

        const args: ClickArgs = { selector: { css: '#trigger' } };
        await handlers[COMMAND.PAGE_CLICK](args, fakeCtx());

        expect(menuOpen).toBe(true);
    });
});
