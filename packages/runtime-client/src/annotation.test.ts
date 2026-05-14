// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { buildCssPath } from './annotation.js';

describe('buildCssPath', () => {
    it('short-circuits at the nearest id ancestor', () => {
        document.body.innerHTML =
            '<main id="root"><section><article><button class="t">x</button></article></section></main>';
        const el = document.querySelector('button.t')!;
        expect(buildCssPath(el)).toBe('main#root > section > article > button');
    });

    it('uses :nth-of-type when sibling tags collide', () => {
        document.body.innerHTML =
            '<main id="root"><button>a</button><button>b</button><button>c</button></main>';
        const buttons = document.querySelectorAll('button');
        expect(buildCssPath(buttons[1])).toBe('main#root > button:nth-of-type(2)');
        expect(buildCssPath(buttons[2])).toBe('main#root > button:nth-of-type(3)');
    });

    it('walks past the previous 6-level cap (now 12)', () => {
        const depth = 10;
        let html = '';
        for (let i = 0; i < depth; i++) html += '<div>';
        html += '<span class="t">x</span>';
        for (let i = 0; i < depth; i++) html += '</div>';
        document.body.innerHTML = `<main id="r">${html}</main>`;
        const el = document.querySelector('span.t')!;
        const path = buildCssPath(el);
        // Must reach the id anchor — old 6-level cap would have stopped early.
        expect(path.startsWith('main#r > ')).toBe(true);
        expect(path.endsWith('> span')).toBe(true);
    });

    it('crosses shadow DOM boundaries with a `>>>` marker', () => {
        document.body.innerHTML = '<main id="r"><my-card></my-card></main>';
        const host = document.querySelector('my-card')!;
        const shadow = host.attachShadow({ mode: 'open' });
        shadow.innerHTML = '<section><button class="inner">x</button></section>';
        const inner = shadow.querySelector('button.inner')!;
        const path = buildCssPath(inner);
        expect(path).toContain(' >>> ');
        // Host side ends at id anchor; shadow side reaches the button.
        expect(path).toMatch(/^main#r > my-card >>> section > button$/);
    });
});
