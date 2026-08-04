// @vitest-environment happy-dom
/**
 * PAGE_SNAPSHOT (harness-fe#202) — a compact, token-bounded index of visible
 * <a>/<button> elements with short-lived refs, so an agent doesn't have to
 * write a selector for every click. Refs from page.snapshot must resolve
 * through page.click via {selector: {ref}}, and go stale on the next snapshot.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { Window } from 'happy-dom';
import { COMMAND } from '@harness-fe/protocol';

function setupDom(): void {
    const win = new Window();
    globalThis.window = win as unknown as typeof globalThis.window;
    globalThis.document = win.document as unknown as typeof globalThis.document;
    globalThis.HTMLElement = win.HTMLElement as unknown as typeof HTMLElement;
    globalThis.MouseEvent = win.MouseEvent as unknown as typeof MouseEvent;
    globalThis.PointerEvent = win.PointerEvent as unknown as typeof PointerEvent;
    globalThis.getComputedStyle = win.getComputedStyle.bind(win) as unknown as typeof getComputedStyle;
}

describe('PAGE_SNAPSHOT', () => {
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

    it('lists only visible <a>/<button>, skipping hidden ones', async () => {
        setupDom();
        const handlers = await loadHandlers();
        document.body.innerHTML = `
            <button id="save">Save</button>
            <a id="home" href="/home">Home</a>
            <button id="hidden-attr" hidden>Nope</button>
            <button id="display-none" style="display:none">Nope</button>
            <div id="not-clickable">plain div</div>
        `;

        const result = (await handlers[COMMAND.PAGE_SNAPSHOT]({}, fakeCtx())) as {
            url?: string;
            elements: Array<{ ref: string; tag: string; text: string; href?: string }>;
            truncated: boolean;
            total: number;
        };

        expect(result.total).toBe(2);
        expect(result.truncated).toBe(false);
        const texts = result.elements.map((e) => e.text).sort();
        expect(texts).toEqual(['Home', 'Save']);
        const home = result.elements.find((e) => e.text === 'Home');
        expect(home?.tag).toBe('a');
        expect(home?.href).toBe('/home');
    });

    it('caps the list at `limit` and reports truncated', async () => {
        setupDom();
        const handlers = await loadHandlers();
        for (let i = 0; i < 5; i++) {
            const btn = document.createElement('button');
            btn.textContent = `btn-${i}`;
            document.body.appendChild(btn);
        }

        const result = (await handlers[COMMAND.PAGE_SNAPSHOT]({ limit: 3 }, fakeCtx())) as {
            elements: unknown[];
            truncated: boolean;
            total: number;
        };
        expect(result.elements).toHaveLength(3);
        expect(result.truncated).toBe(true);
        expect(result.total).toBe(5);
    });

    it('assigns a ref usable by page.click, and invalidates it on the next snapshot', async () => {
        setupDom();
        const handlers = await loadHandlers();
        const button = document.createElement('button');
        button.id = 'trigger';
        let clicked = false;
        button.addEventListener('click', () => { clicked = true; });
        document.body.appendChild(button);

        const snap = (await handlers[COMMAND.PAGE_SNAPSHOT]({}, fakeCtx())) as {
            elements: Array<{ ref: string }>;
        };
        const ref = snap.elements[0].ref;

        await handlers[COMMAND.PAGE_CLICK]({ selector: { ref } }, fakeCtx());
        expect(clicked).toBe(true);

        // A fresh snapshot resets the ref map — the old ref must not silently
        // keep resolving to whatever the counter happens to reassign it to.
        button.remove();
        await handlers[COMMAND.PAGE_SNAPSHOT]({}, fakeCtx());
        await expect(handlers[COMMAND.PAGE_CLICK]({ selector: { ref } }, fakeCtx())).rejects.toThrow();
    });
});
