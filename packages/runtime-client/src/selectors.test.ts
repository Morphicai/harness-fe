// @vitest-environment happy-dom
import { describe, expect, it, beforeEach } from 'vitest';
import { resolveSelector } from './selectors.js';

beforeEach(() => {
    document.body.innerHTML = `
    <div>
      <button class="primary" aria-label="submit">Submit</button>
      <a href="/x">Link</a>
      <input type="text" />
      <span data-morphix-comp="SubmitButton" data-morphix-loc="src/Login.tsx:42:8">component target</span>
    </div>
  `;
});

describe('resolveSelector', () => {
    it('resolves by css', () => {
        const r = resolveSelector({ css: 'button.primary' });
        expect(r.via).toBe('css');
        expect((r.element as HTMLElement).textContent).toBe('Submit');
    });

    it('resolves by aria-label', () => {
        const r = resolveSelector({ ariaLabel: 'submit' });
        expect(r.via).toBe('aria');
        expect((r.element as HTMLElement).tagName.toLowerCase()).toBe('button');
    });

    it('resolves by role + text', () => {
        const r = resolveSelector({ role: 'button', text: 'Submit' });
        expect(r.via).toBe('role-text');
    });

    it('resolves by component data attribute', () => {
        const r = resolveSelector({ component: 'SubmitButton' });
        expect(r.via).toBe('component-attr');
        expect((r.element as HTMLElement).textContent).toBe('component target');
    });

    it('resolves by file:line', () => {
        const r = resolveSelector({ file: 'src/Login.tsx', line: 42 });
        expect(r.via).toBe('file');
    });

    it('returns null for no match', () => {
        const r = resolveSelector({ css: '.does-not-exist' });
        expect(r.element).toBeNull();
        expect(r.via).toBe('none');
    });

    // Text-only selectors used to resolve to <html>: every ancestor of the real
    // target "contains" the string via textContent and the root sorts first in
    // document order, so page.click({text:'…'}) clicked the whole document.
    // Found while driving a real app with 4.5.1.
    describe('text-only selectors resolve the deepest owner, not an ancestor', () => {
        it('picks the element that owns the text, not <html>/<body>', () => {
            const r = resolveSelector({ text: 'Submit' });
            expect(r.via).toBe('role-text');
            expect((r.element as HTMLElement).tagName.toLowerCase()).toBe('button');
        });

        it('prefers the innermost element when matches are nested', () => {
            document.body.innerHTML = `
              <div id="outer"><div id="mid"><span id="inner">Save changes</span></div></div>
            `;
            const r = resolveSelector({ text: 'Save changes' });
            expect((r.element as HTMLElement).id).toBe('inner');
        });

        it('prefers an exact text owner over a substring container', () => {
            document.body.innerHTML = `
              <div id="wrap">Please press Go now</div>
              <button id="go">Go</button>
            `;
            const r = resolveSelector({ text: 'Go' });
            expect((r.element as HTMLElement).id).toBe('go');
        });

        it('still supports substring matching when nothing matches exactly', () => {
            document.body.innerHTML = `<p id="p">a long sentence with needle inside</p>`;
            const r = resolveSelector({ text: 'needle' });
            expect((r.element as HTMLElement).id).toBe('p');
        });

        it('nth still indexes among sibling matches', () => {
            document.body.innerHTML = `
              <button id="b1">Open</button><button id="b2">Open</button>
            `;
            const r = resolveSelector({ text: 'Open', nth: 1 });
            expect((r.element as HTMLElement).id).toBe('b2');
        });
    });
});
