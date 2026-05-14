/**
 * Selector resolution in the page. Phase A: CSS / role+text / ariaLabel /
 * compile-time data-morphix-comp attribute (set by future vite-plugin AST
 * transform — Phase B). file:line + runtime fiber lookup land in Phase B/C.
 */

import type { Selector } from '@morphixai/harnessa-fe.protocol';

export interface ResolveResult {
    element: Element | null;
    /** Index used when multiple matched (for diagnostics). */
    index: number;
    /** How we found it (for diagnostics). */
    via: 'css' | 'aria' | 'role-text' | 'component-attr' | 'file' | 'none';
}

export function resolveSelector(selector: Selector): ResolveResult {
    const nth = selector.nth ?? 0;

    if (selector.css) {
        const list = document.querySelectorAll(selector.css);
        if (list[nth]) return { element: list[nth] as Element, index: nth, via: 'css' };
    }

    if (selector.ariaLabel) {
        const list = document.querySelectorAll(`[aria-label="${escapeCss(selector.ariaLabel)}"]`);
        if (list[nth]) return { element: list[nth] as Element, index: nth, via: 'aria' };
    }

    if (selector.role || selector.text) {
        const candidates = matchByRoleText(selector.role, selector.text);
        if (candidates[nth]) {
            return { element: candidates[nth], index: nth, via: 'role-text' };
        }
    }

    if (selector.component) {
        const list = document.querySelectorAll(
            `[data-morphix-comp="${escapeCss(selector.component)}"]`,
        );
        if (list[nth]) {
            return { element: list[nth] as Element, index: nth, via: 'component-attr' };
        }
    }

    if (selector.file) {
        const lineSuffix = selector.line ? `:${selector.line}` : '';
        const list = document.querySelectorAll(
            `[data-morphix-loc^="${escapeCss(selector.file)}${lineSuffix}"]`,
        );
        if (list[nth]) return { element: list[nth] as Element, index: nth, via: 'file' };
    }

    return { element: null, index: -1, via: 'none' };
}

function escapeCss(value: string): string {
    return value.replace(/(["\\])/g, '\\$1');
}

function matchByRoleText(role?: string, text?: string): Element[] {
    const all = Array.from(document.querySelectorAll<HTMLElement>('*'));
    return all.filter((el) => {
        if (role) {
            const elRole = el.getAttribute('role') ?? implicitRole(el);
            if (elRole !== role) return false;
        }
        if (text) {
            const elText = (el.textContent ?? '').trim();
            if (elText !== text && !elText.includes(text)) return false;
        }
        return true;
    });
}

function implicitRole(el: HTMLElement): string | undefined {
    const tag = el.tagName.toLowerCase();
    if (tag === 'button') return 'button';
    if (tag === 'a' && el.hasAttribute('href')) return 'link';
    if (tag === 'input') {
        const type = (el as HTMLInputElement).type;
        if (type === 'checkbox') return 'checkbox';
        if (type === 'radio') return 'radio';
        if (type === 'button' || type === 'submit') return 'button';
        return 'textbox';
    }
    if (tag === 'textarea') return 'textbox';
    if (tag === 'select') return 'combobox';
    return undefined;
}
