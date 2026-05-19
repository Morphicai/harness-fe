# `webpack-demo`

Webpack 5 + React demo. Promoted to **stable** in v0.2 once the runtime injection moved from a bare-specifier `<script>` to `webpack.EntryPlugin`.

## What it shows

- Source-aware JSX tagging in a webpack pipeline (babel-loader runs after the harnessa transform)
- Runtime client bundled into the user's main chunk via `webpack.EntryPlugin` — no bare-specifier `<script>` to 404 on
- HTML config injection via `html-webpack-plugin` (with a `processAssets` fallback for projects that don't use it)

## Run

```bash
pnpm install
pnpm --filter harnessa-fe-webpack-demo dev   # http://localhost:3001
```

Override the daemon URL with `HARNESSA_FE_URL` if needed.

## Build for inspection

```bash
pnpm --filter harnessa-fe-webpack-demo build
grep -oE 'data-morphix-loc"[^"]+' dist/bundle.js | head    # see tagged locations
```

## Source of truth

- App: `src/App.jsx` / `src/index.jsx`
- webpack config: `webpack.config.js`
