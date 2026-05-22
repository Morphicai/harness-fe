# Harness-FE Brand Guidelines

## Logo

A rounded square plate carries a multi-color "harness ring" — indigo →
emerald → rose — wrapped around a near-black inset that displays a
geometric "H". The ring represents three sides of the harness: build
tooling, browser runtime, and the agents that drive them.

- **Primary logo:** [`logo.svg`](./logo.svg) — 128×128 viewBox, vector-scalable
- **Mark:** [`logo-mark.svg`](./logo-mark.svg) — 32×32, simplified for
  favicons and navbar avatars
- **Raster:** [`logo-128.png`](./logo-128.png) — 128×128 PNG export of
  the primary logo, for surfaces that don't render SVG (npm avatar,
  GitHub social preview)

The SPA dashboard, in-page overlay FAB, and documentation share the
same composition so the brand reads consistently from a 16px favicon
to a 256px hero block.

## Colors

The palette is the same set of tokens the dashboard SPA uses (see
`packages/dashboard-ui/tailwind.config.ts`). Keep it small and
semantic — a dev tool benefits from a tight vocabulary far more than
from a broad swatch.

### Surface (dark, the default canvas)

| Role            | Hex       | Tailwind alias       | Usage                                  |
|-----------------|-----------|----------------------|----------------------------------------|
| Base            | `#09090b` | `surface-base`       | Page background, logo inset            |
| Raised          | `#111114` | `surface-raised`     | Cards, table backgrounds               |
| Sunken          | `#050507` | `surface-sunken`     | Inset wells (timeline rows on hover)   |
| Border          | `#1f1f23` | `surface-border`     | Standard hairlines                     |
| Border strong   | `#2a2a30` | `surface-border-strong` | Hover / focus emphasis              |

### Ink (text)

| Role      | Hex       | Tailwind alias  | Usage                                |
|-----------|-----------|-----------------|--------------------------------------|
| Primary   | `#e4e4e7` | `ink-primary`   | Body text, primary headings          |
| Secondary | `#a1a1aa` | `ink-secondary` | Helper copy, descriptions            |
| Muted     | `#71717a` | `ink-muted`     | Tertiary text, timestamps            |

### Accent (the harness ring + state colors)

| Role      | Hex       | Tailwind alias  | Usage                                          |
|-----------|-----------|-----------------|------------------------------------------------|
| Indigo    | `#818cf8` | `accent-indigo` | Links, focus rings, primary action gradient    |
| Emerald   | `#34d399` | `accent-emerald`| Live / connected / success states              |
| Rose      | `#fb7185` | `accent-rose`   | Errors                                         |
| Amber     | `#fbbf24` | `accent-amber`  | Warnings, connecting state                     |

The three perimeter colors (indigo, emerald, rose) sweep the logo's
outer ring in that order along the diagonal. Treat them as a set: a
button that mixes only two of them reads as a partial logo and
disorients users.

## Typography

| Role     | Font Family       | Weight             | Usage                       |
|----------|-------------------|--------------------|-----------------------------|
| Heading  | Inter             | 600 (Semi-Bold)    | Headings, navigation        |
| Body     | Inter             | 400 (Regular)      | Body text, descriptions     |
| Code     | JetBrains Mono    | 400 (Regular)      | Code snippets, IDs, terminals |

Inter ships with cv11/ss01/ss03 stylistic alternates enabled in the
dashboard (`packages/dashboard-ui/src/styles.css`) — keep them on for
consistency: rounded `1` shoulder, single-story `a`, simplified `R`.

### Font Stack (CSS)

```css
--font-heading: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
--font-body:    'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
--font-code:    'JetBrains Mono', 'SF Mono', 'Menlo', 'Consolas', monospace;
```

## Usage Guidelines

- **Clear space.** Keep at least 1/8 of the logo's edge length as
  margin on every side. At 128px, that's 16px.
- **Don't stretch or recolor.** The harness ring's three accent stops
  are core to the brand. Don't substitute palette colors, don't make
  the ring monochromatic.
- **Dark backgrounds: use the logo as-is.** The inset plate already
  carries the dark color; surrounding negative space lifts it.
- **Light backgrounds: still use the logo as-is.** The dark plate
  reads cleanly against light backgrounds; we deliberately don't ship
  a "light variant" because two variants double the brand surface
  area without adding clarity.
- **Minimum display size.** 16×16 for the favicon mark, 24×24 for the
  primary logo. Below that, fall back to the mark.
