# `@harness-fe/next` — Long-term Integration Design

## Why a dedicated package

Next.js is **not just webpack**. It owns four things our existing plugin can't reach:

| Aspect | Why webpack plugin fails | What we need |
|---|---|---|
| **JSX transform** | Next's SWC loader is inside `module.rules[].oneOf[]`. Only one loader per `oneOf` runs; SWC always wins. Our `enforce: 'pre'` rule at the top level is bypassed. | Run inside SWC's transform pass |
| **HTML injection** | App Router renders HTML via React Server Components — no static `.html` files for `processAssets` to find | Server-component-aware injection |
| **Runtime loading** | `EntryPlugin` adds to a "default" chunk that doesn't exist in Next's multi-chunk model (server / edge / per-route client) | Client-only loader via `<Script>` |
| **Turbopack** | `next dev --turbo` skips webpack entirely. Plugins ignored. Loaders ignored. | Native Turbopack support via `experimental.swcPlugins` |

Short-term hacks (loader-injection inside `oneOf`, monkey-patching Next internals) all break on Next minor versions. The **canonical** path is:

1. SWC plugin for transform (works for both webpack AND Turbopack)
2. HoC + React component for runtime + HTML injection (works for App Router AND Pages Router)

This mirrors how Sentry, Vercel Analytics, PostHog all do Next.js integration.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  user's next.config.mjs                                          │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  withHarness({ projectId }, nextConfig)                   │  │
│  │     ├─ adds experimental.swcPlugins entry  ───┐            │  │
│  │     ├─ patches webpack hook (client-dev only) │            │  │
│  │     ├─ env.NEXT_PUBLIC_HARNESS_FE_PROJECT_ID │            │  │
│  │     ├─ env.NEXT_PUBLIC_HARNESS_FE_BUILD_ID   │            │  │
│  │     └─ adds @harness-fe/runtime as resolve.alias        │   │
│  └────────────────────────────────────────────────┼──────────┘  │
│                                                   │             │
│  ┌─────────────────────────────────────────────────▼──────────┐  │
│  │  @harness-fe/next-swc (Rust → wasm)                       │  │
│  │     • Same AST walk as @harness-fe/unplugin/transform.ts  │  │
│  │     • Tags JSXOpeningElement with data-morphix-loc/comp    │  │
│  │     • Runs ONCE inside Next's SWC pass (no SWC duplication)│  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│  user's app/layout.tsx                                           │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  <HarnessScript />  (from '@harness-fe/next/script')     │  │
│  │     • Reads NEXT_PUBLIC_HARNESS_FE_* env at render time   │  │
│  │     • Inline <script>window.__HARNESS_FE__ = {...}</script>│ │
│  │     • <Script src="..." strategy="afterInteractive" />     │  │
│  │     • Auto no-op in production                             │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

---

## Pillar 1: SWC plugin

### New crate `crates/harness-fe-swc`

Rust crate, builds to `.wasm`. Functionality mirrors `packages/unplugin/src/transform.ts`:

- Walk JSX AST via `swc_core::ecma::visit`
- For each `JSXOpeningElement`, inject two attributes:
  - `data-morphix-loc="<file>:<line>:<col>"`
  - `data-morphix-comp="<inferred-component-name>"`
- Skip if attrs already present (idempotent)
- Resolve component name from enclosing `FunctionDeclaration` / `VariableDeclarator` / `ClassDeclaration`
- Source location from SWC's `Span`

Configuration via plugin's `serde_json::Value` config:

```rust
struct Config {
    project_root: PathBuf,
    include: Vec<Regex>,
    exclude: Vec<Regex>,
}
```

Published as `@harness-fe/next-swc` with pre-built `.wasm` (single artifact, no platform-specific binaries — `.wasm` is portable).

**Estimated effort**: 4-6 days for a senior dev with SWC familiarity. Reference: Sentry's SWC plugin is ~600 LOC Rust.

### Why not just port the TypeScript version?

We can't. Next's SWC pass is a Rust binary — JS plugins aren't supported in the SWC plugin slot. Babel plugins are accepted via `babel.config.js`, but using Babel disables SWC project-wide, slowing every build 5-10×. Unacceptable.

### Compatibility matrix

| Next.js | Bundler | SWC plugin | Source tagging works |
|---|---|---|---|
| 13+ webpack | webpack 5 | ✅ via `experimental.swcPlugins` | ✅ |
| 13+ turbopack (`--turbo`) | turbopack | ✅ via `experimental.swcPlugins` | ✅ |
| 15+ app router | either | same | ✅ |
| Pages router | either | same | ✅ |

One implementation, every Next.js mode.

---

## Pillar 2: Runtime + HTML injection

### `withHarness()` HoC

```ts
// packages/next/src/index.ts
import type { NextConfig } from 'next';

export interface HarnessNextOptions {
    projectId: string;
    parentProjectId?: string;
    displayName?: string;
    mcpUrl?: string;       // override default ws://127.0.0.1:47729
    buildId?: string;      // override auto-resolved
    disabled?: boolean;    // for prod / CI
}

export function withHarness(
    opts: HarnessNextOptions,
    nextConfig: NextConfig = {},
): NextConfig {
    if (opts.disabled || process.env.NODE_ENV !== 'development') {
        return nextConfig;
    }

    const buildId = opts.buildId ?? resolveBuildId({ root: process.cwd() }).buildId;

    return {
        ...nextConfig,
        experimental: {
            ...nextConfig.experimental,
            swcPlugins: [
                ...(nextConfig.experimental?.swcPlugins ?? []),
                ['@harness-fe/next-swc', { projectId: opts.projectId }],
            ],
        },
        env: {
            ...nextConfig.env,
            NEXT_PUBLIC_HARNESS_FE_PROJECT_ID: opts.projectId,
            NEXT_PUBLIC_HARNESS_FE_PARENT_ID: opts.parentProjectId ?? '',
            NEXT_PUBLIC_HARNESS_FE_DISPLAY: opts.displayName ?? '',
            NEXT_PUBLIC_HARNESS_FE_BUILD_ID: buildId,
            NEXT_PUBLIC_HARNESS_FE_MCP_URL:
                opts.mcpUrl ??
                process.env.HARNESS_FE_URL ??
                'ws://127.0.0.1:47729',
        },
    };
}
```

### `<HarnessScript />` component

```tsx
// packages/next/src/script.tsx
import Script from 'next/script';

export function HarnessScript() {
    if (process.env.NODE_ENV !== 'development') return null;
    const projectId = process.env.NEXT_PUBLIC_HARNESS_FE_PROJECT_ID;
    if (!projectId) return null;

    const config = JSON.stringify({
        projectId,
        parentProjectId: process.env.NEXT_PUBLIC_HARNESS_FE_PARENT_ID || undefined,
        displayName: process.env.NEXT_PUBLIC_HARNESS_FE_DISPLAY || undefined,
        buildId: process.env.NEXT_PUBLIC_HARNESS_FE_BUILD_ID,
        mcpUrl: process.env.NEXT_PUBLIC_HARNESS_FE_MCP_URL,
    });

    return (
        <>
            <Script
                id="harness-fe-config"
                strategy="beforeInteractive"
                dangerouslySetInnerHTML={{
                    __html: `window.__HARNESS_FE__ = ${config};`,
                }}
            />
            <Script
                id="harness-fe-runtime"
                strategy="afterInteractive"
                src="https://unpkg.com/@harness-fe/runtime@latest/dist/index.js"
            />
        </>
    );
}
```

(For dev, fetching from unpkg is fine. For prod-like behavior, ship the runtime as a static asset under `/public/`.)

### User-facing API

```ts
// next.config.mjs
import { withHarness } from '@harness-fe/next';

export default withHarness(
    { projectId: 'my-app', displayName: 'My App' },
    {
        /* user's existing Next config */
    },
);
```

```tsx
// app/layout.tsx
import { HarnessScript } from '@harness-fe/next/script';

export default function RootLayout({ children }) {
    return (
        <html>
            <body>
                <HarnessScript />
                {children}
            </body>
        </html>
    );
}
```

Two lines of user config. No webpack hooks to write. Same pattern Sentry / PostHog / Vercel Analytics use.

---

## Pillar 3: Server/client boundaries

- `<HarnessScript />` is a **server component** that renders client `<Script>` tags. Server bundle never imports the runtime.
- Runtime client (`@harness-fe/runtime`) only touches `window` at the **module-top level** — already client-safe because it's loaded via `<Script>` not via `import` in RSC.
- SWC plugin runs on **all** components (server + client), but the injected `data-morphix-*` attributes are static strings — they harmlessly serialize through RSC.

---

## Pillar 4: Turbopack support

Turbopack reads the SAME `experimental.swcPlugins` config that webpack mode reads. So once the SWC plugin works, Turbopack mode works for free.

Runtime injection: turbopack still renders HTML through Next.js's React pipeline — `<HarnessScript />` works identically.

One caveat: Turbopack currently has known instability with SWC plugins as of Next 15.5. We document the workaround:

```
HARNESS_FE_TURBOPACK_FALLBACK=1 → withHarness() forces dev to webpack mode
```

This is a release valve, not a permanent answer. Track Turbopack stability in Next.js issues.

---

## Package layout

```
packages/next/
├── package.json                  @harness-fe/next
├── src/
│   ├── index.ts                  withHarness() HoC
│   ├── script.tsx                <HarnessScript /> component
│   └── runtime-loader.ts         dynamic runtime loader
├── README.md
└── tsconfig.json

crates/harness-fe-swc/
├── Cargo.toml                    @harness-fe/next-swc (built to wasm)
├── src/
│   ├── lib.rs                    SWC plugin entry
│   ├── visitor.rs                JSX visitor (mirrors TS transform)
│   └── component_name.rs         enclosing-function detection
└── build.sh                      cross-compile → wasm32-wasi
```

Two npm packages, separate releases:

- `@harness-fe/next` — pure JS / React, fast iteration
- `@harness-fe/next-swc` — Rust → `.wasm`, slower release cadence

---

## Implementation phases

### Phase 1 — Foundation (2-3 days)

- [ ] Scaffold `packages/next/` with TypeScript build
- [ ] Implement `withHarness()` HoC (NO SWC plugin yet — leave that slot empty)
- [ ] Implement `<HarnessScript />` component
- [ ] Add `examples/next-demo/` (App Router minimal app)
- [ ] e2e test: headless Chromium loads page, asserts `window.__harness_fe_client__` registered, WebSocket OPEN

**Outcome**: early adopters can plug in and get rrweb + console + network capture + agent commands. **No source-aware selectors yet** — agents must use CSS selectors as fallback.

### Phase 2 — Source intelligence (4-6 days)

- [ ] Scaffold `crates/harness-fe-swc/`
- [ ] Port `packages/unplugin/src/transform.ts` logic to Rust
- [ ] Build pipeline: `cargo build --target wasm32-wasi --release` → `.wasm` artifact
- [ ] Publish `@harness-fe/next-swc@0.1.0` with the `.wasm`
- [ ] Wire `withHarness()` to add the plugin to `experimental.swcPlugins`
- [ ] Validation tests against React 18 / React 19 / Next 13 / 14 / 15 fixtures

**Outcome**: full feature parity with Vite/Webpack. `project.where_is` works. `data-morphix-*` attrs on rendered DOM.

### Phase 3 — Turbopack polish (2 days)

- [ ] Test Phase 2 on `next dev --turbo`
- [ ] Document any caveats / known issues
- [ ] Add `HARNESS_FE_TURBOPACK_FALLBACK` escape hatch

**Outcome**: feature parity across all Next.js modes.

### Phase 4 — Hardening (1-2 days)

- [ ] Pages Router compatibility (`pages/_app.tsx` injection point)
- [ ] React 19 RSC compat tests
- [ ] Performance benchmark: with vs without plugin, build time delta
- [ ] Source maps preserved through transform
- [ ] CI matrix: Next 13.5 / 14.x / 15.x × node 18 / 20 / 22

---

## What we deliver at the end

```bash
pnpm add -D @harness-fe/next @harness-fe/next-swc @harness-fe/runtime
```

```ts
// next.config.mjs
import { withHarness } from '@harness-fe/next';
export default withHarness({ projectId: 'my-app' }, {});
```

```tsx
// app/layout.tsx
import { HarnessScript } from '@harness-fe/next/script';
// ... <body><HarnessScript />{children}</body>
```

That's it. Works in dev (webpack and Turbopack), no-op in prod, supports App Router + Pages Router, gives full source-aware tagging + runtime.

---

## Time + cost

| Phase | Effort | What ships |
|---|---|---|
| 1: Foundation | 2-3 days | Runtime + HTML injection (no source intel) |
| 2: SWC plugin | 4-6 days | Source intelligence; canonical implementation |
| 3: Turbopack | 2 days | All Next modes covered |
| 4: Hardening | 1-2 days | Production-grade with version matrix |
| **Total** | **9-13 days** | `@harness-fe/next` + `@harness-fe/next-swc` |

This is a real piece of work. The alternative — patching Next's `oneOf` rules at runtime — works for ~3 months until Next 16 ships and breaks it.

---

## Decision points before starting

1. **Are we OK writing + maintaining a Rust crate?** SWC plugins must be Rust. If no Rust ownership long-term, fallback is Babel mode (build slowdown trade-off).
2. **What's the support floor?** Next 13.5? 14? 15-only? Older versions have different SWC plugin APIs.
3. **Pages Router support yes/no?** Most new apps are App Router; Pages Router adds maintenance.
4. **CDN runtime vs bundled?** Phase 1 uses unpkg for simplicity. Phase 4 should ship `/public/harness-runtime.js` so users without internet still work.
