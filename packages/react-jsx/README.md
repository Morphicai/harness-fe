# @harnessa-fe/react-jsx

> Drop-in JSX runtime that adds `data-morphix-loc` to every rendered DOM element in dev mode. Zero bundler plugins; one line in `tsconfig.json` makes it work everywhere — Next.js, Vite, Webpack, Remix, Astro, anywhere that respects the standard `jsxImportSource` compiler option.

This is the **simpler, framework-agnostic** alternative to `@harnessa-fe/vite` / `@harnessa-fe/webpack`. It works by wrapping React's `jsxDEV()` to read the source-location info React already passes through (`{ fileName, lineNumber, columnNumber }`) and stamp it onto the rendered element as a `data-morphix-loc` HTML attribute. The Harnessa-FE agent uses that attribute to map any DOM node back to its source file with `project_where_is` / `project_source`.

## Install

```bash
pnpm add -D @harnessa-fe/react-jsx
```

## Configure

```json
// tsconfig.json
{
    "compilerOptions": {
        "jsxImportSource": "@harnessa-fe/react-jsx"
    }
}
```

That's it. Run `pnpm dev` and every `<div>` / `<button>` / etc. now has a `data-morphix-loc="src/Foo.tsx:42:8"` attribute in DEV builds.

## What gets tagged

- ✅ Every host element (lowercase tag like `div`, `button`, `input`)
- ❌ React components (`<Foo />`) — but their rendered host elements ARE tagged, so `<Foo />` containing a `<div>` puts the loc on the div
- ❌ `data-morphix-loc` attributes are stripped automatically in production builds (React uses `jsx` not `jsxDEV` there, and our `jsx-runtime` is a stock re-export)

## How it works

When TypeScript / SWC / Babel see your JSX `<div className="x" />`, they transform it to:

```js
jsxDEV('div', { className: 'x' }, undefined, false,
       { fileName: 'src/App.tsx', lineNumber: 42, columnNumber: 8 },
       this);
```

The `source` (5th argument) is provided by React 17+ JSX runtime as standard. We just intercept it and inject the location string as a DOM attribute:

```js
jsxDEV('div', { className: 'x', 'data-morphix-loc': 'src/App.tsx:42:8' }, ...)
```

No bundler plugin needed because `jsxImportSource` is a first-class TS/SWC/Babel compiler option — it tells the compiler to import `jsx*` from your package instead of from `react`.

## Compatibility

| Framework | Status | Notes |
|---|---|---|
| Next.js 13+ (App Router + Pages Router) | ✅ | webpack and Turbopack both honor `jsxImportSource` |
| Vite + React | ✅ | reads from tsconfig automatically |
| Webpack 5 + React | ✅ | works via babel or swc loader |
| Remix / Astro / others | ✅ | any toolchain with standard JSX transform |
| React Native | not tested | should work in theory |
| React 17 / 18 / 19 | ✅ | jsxDEV signature stable across all three |

## When NOT to use this

- **Vue / Svelte projects** — they don't use React's JSX runtime; use `@harnessa-fe/vite` or `@harnessa-fe/webpack` instead.
- **Projects that need `data-morphix-comp` (component name) attributes** — this runtime only emits `data-morphix-loc`. Component-name attributes still require the build-time transform.

## License

MIT
