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
});
