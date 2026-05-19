/**
 * @harnessa-fe/react-jsx/jsx-dev-runtime
 *
 * Wraps React's `jsxDEV` to inject a `data-morphix-loc` attribute on every
 * host element (`div`, `button`, etc.). The agent uses these attributes to
 * map any DOM node back to file:line:col without a bundler plugin.
 *
 * How it gets called:
 *   - TypeScript / SWC / Babel transform `<Foo bar />` to
 *     `jsxDEV(Foo, { bar }, key, isStaticChildren, source, self)`
 *     when `jsxImportSource` is set to a package that exports this file.
 *   - `source` here is React's built-in debug info:
 *     { fileName: 'src/App.tsx', lineNumber: 42, columnNumber: 8 }
 *
 * No bundler config required. Works in Vite, Webpack, Next.js (App
 * Router + Pages Router + Turbopack), Remix, Astro, anything that
 * respects the standard `jsxImportSource` compiler option.
 *
 * Production builds use `jsx` (no DEV) and don't pass `source`, so this
 * file is auto-irrelevant outside dev mode.
 */
import {
    jsxDEV as origJsxDEV,
    Fragment as ReactFragment,
} from 'react/jsx-dev-runtime';

export const Fragment = ReactFragment;

interface SourceInfo {
    fileName?: string;
    lineNumber?: number;
    columnNumber?: number;
}

type JsxProps = Record<string, unknown> | null | undefined;

function withLoc(props: JsxProps, source: SourceInfo): Record<string, unknown> {
    if (!source.fileName || source.lineNumber == null) {
        return (props ?? {}) as Record<string, unknown>;
    }
    const loc = `${source.fileName}:${source.lineNumber}:${source.columnNumber ?? 0}`;
    return { ...(props ?? {}), 'data-morphix-loc': loc };
}

// React's jsxDEV signature is internal; we treat it as any so we don't have
// to mirror its evolving generics across React 17/18/19.
const realJsxDEV = origJsxDEV as unknown as (...args: unknown[]) => unknown;

export function jsxDEV(
    type: unknown,
    props: JsxProps,
    key: unknown,
    isStaticChildren: boolean,
    source: SourceInfo | undefined,
    self: unknown,
): unknown {
    // Only tag host elements (lowercase tag names like 'div', 'button').
    // React components (capitalised function/class) get tagged via the
    // host elements they render — adding attrs to a component instance
    // would not appear in the DOM anyway.
    if (typeof type === 'string' && source) {
        return realJsxDEV(type, withLoc(props, source), key, isStaticChildren, source, self);
    }
    return realJsxDEV(type, props, key, isStaticChildren, source, self);
}
