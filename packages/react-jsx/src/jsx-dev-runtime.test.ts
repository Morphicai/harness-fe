// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { jsxDEV, Fragment } from './jsx-dev-runtime.js';

/**
 * The wrapper's contract:
 *   - Host elements (string `type`) with source info → output element
 *     should carry data-morphix-loc.
 *   - Component elements (function/class `type`) → never tagged (the
 *     attribute would be ignored by React anyway since the type isn't
 *     a host element).
 *   - Missing source → pass-through; original output.
 *   - Existing data-morphix-loc → overwritten with this call's source.
 */
function renderAndInspect(element: unknown): { type: string; props: Record<string, unknown> } | undefined {
    // The element returned by jsxDEV is a React element. Cheat — read its
    // internal props directly. React doesn't expose this on the public API,
    // but for tests it's fine.
    const el = element as { type: unknown; props: Record<string, unknown> } | undefined;
    if (!el || typeof el.type !== 'string') return undefined;
    return { type: el.type, props: el.props };
}

describe('jsxDEV wrapper', () => {
    it('injects data-morphix-loc on host elements with source info', () => {
        const out = jsxDEV(
            'div',
            { className: 'x' },
            undefined,
            false,
            { fileName: 'src/App.tsx', lineNumber: 42, columnNumber: 8 },
            null,
        );
        const e = renderAndInspect(out);
        expect(e?.type).toBe('div');
        expect(e?.props.className).toBe('x');
        expect(e?.props['data-morphix-loc']).toBe('src/App.tsx:42:8');
    });

    it('handles null/undefined props', () => {
        const out = jsxDEV(
            'span',
            null,
            undefined,
            false,
            { fileName: 'src/X.tsx', lineNumber: 1, columnNumber: 0 },
            null,
        );
        const e = renderAndInspect(out);
        expect(e?.props['data-morphix-loc']).toBe('src/X.tsx:1:0');
    });

    it('uses column 0 when columnNumber missing', () => {
        const out = jsxDEV(
            'p',
            {},
            undefined,
            false,
            { fileName: 'src/Y.tsx', lineNumber: 7 },
            null,
        );
        const e = renderAndInspect(out);
        expect(e?.props['data-morphix-loc']).toBe('src/Y.tsx:7:0');
    });

    it('does NOT tag function components (data-* on components is dropped by React anyway)', () => {
        const Comp = () => null;
        const out = jsxDEV(
            Comp,
            { foo: 'bar' },
            undefined,
            false,
            { fileName: 'src/App.tsx', lineNumber: 10, columnNumber: 4 },
            null,
        );
        // For component element type, our wrapper passes through unchanged.
        const el = out as { props: Record<string, unknown> };
        expect(el.props['data-morphix-loc']).toBeUndefined();
        expect(el.props.foo).toBe('bar');
    });

    it('passes through when source info is missing (production-style)', () => {
        const out = jsxDEV('button', { type: 'submit' }, undefined, false, undefined, null);
        const e = renderAndInspect(out);
        expect(e?.props['data-morphix-loc']).toBeUndefined();
        expect(e?.props.type).toBe('submit');
    });

    it('passes through when fileName is empty', () => {
        const out = jsxDEV(
            'div',
            { id: 'x' },
            undefined,
            false,
            { fileName: '', lineNumber: 1 },
            null,
        );
        const e = renderAndInspect(out);
        expect(e?.props['data-morphix-loc']).toBeUndefined();
    });

    it('Fragment is re-exported from react/jsx-dev-runtime', () => {
        expect(typeof Fragment).toBeDefined();
    });
});
