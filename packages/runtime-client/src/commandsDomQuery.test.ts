// @vitest-environment happy-dom
/**
 * PAGE_DOM_QUERY — regression coverage for the duplicate-match bug found while
 * driving a real app with 4.5.1: the css sweep and the resolveSelector fallback
 * both land on the same node, so a page with ONE textarea reported two matches
 * (and 14 buttons reported 15). `matches.length` is the number an agent asserts
 * on, so a phantom extra entry is a correctness bug, not cosmetics.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { Window } from 'happy-dom';
import { COMMAND } from '@harness-fe/protocol';

function setupDom(): void {
    const win = new Window();
    globalThis.window = win as unknown as typeof globalThis.window;
    globalThis.document = win.document as unknown as typeof globalThis.document;
    globalThis.HTMLElement = win.HTMLElement as unknown as typeof HTMLElement;
    globalThis.getComputedStyle = win.getComputedStyle.bind(win) as unknown as typeof getComputedStyle;
}

interface DomQueryResult {
    matches: Array<{ html: string; tag: string; via: string }>;
    total: number;
    truncated?: boolean;
}

describe('PAGE_DOM_QUERY', () => {
    afterEach(() => {
        document.body.innerHTML = '';
    });

    async function query(args: unknown): Promise<DomQueryResult> {
        const mod = await import('./commands.js');
        return (await mod.commandHandlers[COMMAND.PAGE_DOM_QUERY](args, { capture: {} } as never)) as DomQueryResult;
    }

    it('reports a single match for a single matching element', async () => {
        setupDom();
        document.body.innerHTML = `<textarea placeholder="ask"></textarea>`;

        const result = await query({ selector: { css: 'textarea' } });

        expect(result.matches).toHaveLength(1);
        expect(result.matches[0].tag).toBe('textarea');
    });

    it('match count equals the real element count (no phantom extra)', async () => {
        setupDom();
        document.body.innerHTML = `
            <button id="a">A</button>
            <button id="b">B</button>
            <button id="c">C</button>
        `;

        const result = await query({ selector: { css: 'button' }, limit: 50 });

        expect(result.matches).toHaveLength(document.querySelectorAll('button').length);
        expect(result.matches.map((m) => m.html.includes('id="a"'))).toContainEqual(true);
    });

    it('still honours limit when there are more elements than the cap', async () => {
        setupDom();
        document.body.innerHTML = `<p>1</p><p>2</p><p>3</p><p>4</p>`;

        const result = await query({ selector: { css: 'p' }, limit: 2 });

        expect(result.matches).toHaveLength(2);
    });

    it('falls back to resolveSelector when css matches nothing', async () => {
        setupDom();
        document.body.innerHTML = `<button>Save</button>`;

        const result = await query({ selector: { css: '.does-not-exist', text: 'Save' } });

        expect(result.matches).toHaveLength(1);
        expect(result.matches[0].via).not.toBe('css');
        expect(result.matches[0].tag).toBe('button');
    });
});

describe('PAGE_DOM_QUERY — counting past `limit`', () => {
    afterEach(() => {
        document.body.innerHTML = '';
    });

    async function query(args: unknown): Promise<DomQueryResult> {
        const mod = await import('./commands.js');
        return (await mod.commandHandlers[COMMAND.PAGE_DOM_QUERY](args, { capture: {} } as never)) as DomQueryResult;
    }

    it('reports the full match count even when `limit` clips the payload', async () => {
        setupDom();
        document.body.innerHTML = Array.from({ length: 14 }, (_, i) => `<button>b${i}</button>`).join('');

        const result = await query({ selector: { css: 'button' } });
        expect(result.matches).toHaveLength(5);   // default limit
        expect(result.total).toBe(14);            // what the assertion needs
        expect(result.truncated).toBe(true);
    });

    it('does not flag truncation when everything fits', async () => {
        setupDom();
        document.body.innerHTML = `<textarea></textarea>`;

        const result = await query({ selector: { css: 'textarea' } });
        expect(result.total).toBe(1);
        expect(result.matches).toHaveLength(1);
        expect(result.truncated).toBeUndefined();
    });
});
