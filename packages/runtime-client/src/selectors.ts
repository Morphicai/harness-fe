/**
 * Selector resolution in the page. Phase A: CSS / role+text / ariaLabel /
 * compile-time data-morphix-comp attribute (set by future vite-plugin AST
 * transform — Phase B). file:line + runtime fiber lookup land in Phase B/C.
 */

import type { Selector } from '@harness-fe/protocol';
import { resolveRef } from './refs.js';

export interface ResolveResult {
    element: Element | null;
    /** Index used when multiple matched (for diagnostics). */
    index: number;
    /** How we found it (for diagnostics). */
    via: 'ref' | 'css' | 'aria' | 'role-text' | 'component-attr' | 'file' | 'none';
}

export function resolveSelector(selector: Selector): ResolveResult {
    const nth = selector.nth ?? 0;

    if (selector.ref) {
        const el = resolveRef(selector.ref);
        if (el) return { element: el, index: 0, via: 'ref' };
        return { element: null, index: -1, via: 'none' };
    }

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
    const roleOk = (el: HTMLElement): boolean => {
        if (!role) return true;
        const elRole = el.getAttribute('role') ?? implicitRole(el);
        return elRole === role;
    };
    if (!text) return all.filter(roleOk);

    const directTextOf = (el: HTMLElement): string =>
        Array.from(el.childNodes)
            .filter((n) => n.nodeType === Node.TEXT_NODE)
            .map((n) => n.textContent ?? '')
            .join('')
            .trim();

    // Rank by how specifically the element itself owns the text. Ancestors of a
    // match trivially "contain" the string via textContent, so an unranked
    // document-order scan resolves {text:'Save'} to <html> — every ancestor up
    // to the root qualifies and the root comes first. Tiering + dropping
    // ancestors of same-or-better matches is what makes the deepest real target
    // win, which is what a caller writing {text:'Save'} means.
    const tiers: HTMLElement[][] = [[], [], []];
    for (const el of all) {
        if (!roleOk(el)) continue;
        const directText = directTextOf(el);
        const fullText = (el.textContent ?? '').trim();
        if (directText === text) tiers[0].push(el);
        else if (fullText === text) tiers[1].push(el);
        else if (directText.includes(text) || fullText.includes(text)) tiers[2].push(el);
    }

    const out: Element[] = [];
    for (const tier of tiers) {
        // Within a tier, an element that contains another match is the outer
        // wrapper — the inner one is the better answer.
        for (const el of tier) {
            if (tier.some((other) => other !== el && el.contains(other))) continue;
            out.push(el);
        }
    }
    return out;
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
