/**
 * @harnessa-fe/next/script — `<HarnessaScript />`
 *
 * Server Component wrapper. Place once in your root layout (`app/layout.tsx`)
 * inside <body>:
 *
 *   import { HarnessaScript } from '@harnessa-fe/next';
 *   <HarnessaScript projectId="my-app" />
 *
 * What this does in dev:
 *   1. **Auto-bootstraps the Node SDK on first server render** —
 *      `@harnessa-fe/node-runtime` is loaded and `register()` is called
 *      once per server process via a process-level singleton. This means
 *      users no longer need an `instrumentation.ts` file just to get
 *      server-side error capture; dropping `<HarnessaScript>` in the
 *      root layout is enough. Works with both webpack and Turbopack
 *      because it doesn't rely on bundler-plugin injection.
 *   2. Calls `getSessionId()` (React `cache()`-backed) to allocate a
 *      deterministic per-request UUID on the server.
 *   3. Inlines a tiny <script> that writes the sessionId into
 *      `window.__HARNESSA_FE_SEED__` before any React hydration runs.
 *   4. Renders `<HarnessaScriptClient>` (the `'use client'` component)
 *      which boots the browser runtime and adopts the seed sessionId.
 *
 * Result: server-side events emitted by `@harnessa-fe/node-runtime` and
 * client-side events emitted by the RuntimeClient share the SAME sessionId.
 * One refresh = one `~/.harnessa/data/sessions/{id}/timeline.jsonl`.
 *
 * `instrumentation.ts` is still supported (and preferred when you need
 * precise control over boot order — e.g. registering before any other
 * middleware), but it's no longer required.
 *
 * In production (`NODE_ENV !== 'development'`) this component renders nothing
 * and pulls no code into client bundles.
 */

export interface HarnessaScriptProps {
    /** Stable project id — typically matches the `name` in your package.json. */
    projectId: string;
    /**
     * Parent project's id when this app is hosted inside another via iframe /
     * module federation. Builds the project tree on the daemon side.
     */
    parentProjectId?: string;
    /** Human-readable name shown in agent UIs. Defaults to projectId. */
    displayName?: string;
    /** MCP daemon WebSocket URL. Defaults to `ws://127.0.0.1:47729`. */
    mcpUrl?: string;
    /**
     * App-supplied user identifier. Attached to the visitor record on the
     * daemon side. Empty / undefined for anonymous traffic.
     *
     * Privacy reminder: this is sent to your local daemon only.
     */
    userId?: string;
    /**
     * Build artifact id stamped on every event. Optional. Recommended sources:
     *   - Production: `process.env.NEXT_PUBLIC_GIT_SHA`
     *   - Dev: leave undefined.
     */
    buildId?: string;
}

import type React from 'react';

const IS_DEV = process.env.NODE_ENV === 'development';

/**
 * Process-level singleton: first call kicks off `@harnessa-fe/node-runtime`
 * `register()` and caches the in-flight promise. Every later call returns
 * the same promise without re-importing. Safe to call from inside React
 * render — `register()` itself only opens a WebSocket / HTTP transport
 * and installs `process.on` handlers; it doesn't block rendering.
 *
 * Why a `globalThis` slot (not just a module-level `let`): in dev, Next +
 * HMR may load the @harnessa-fe/next module multiple times into the same
 * process. A module-local cache would re-init on every reload. Stashing
 * on `globalThis` survives module reloads — exactly one node-runtime
 * client per Node process.
 */
type BootSlot = { promise: Promise<void> | null };
function bootSlot(): BootSlot {
    const g = globalThis as unknown as { __harnessa_fe_node_boot__?: BootSlot };
    if (!g.__harnessa_fe_node_boot__) g.__harnessa_fe_node_boot__ = { promise: null };
    return g.__harnessa_fe_node_boot__;
}

async function ensureNodeRuntimeBooted(opts: {
    projectId: string;
    buildId?: string;
    userId?: string;
    mcpUrl?: string;
}): Promise<void> {
    const slot = bootSlot();
    if (slot.promise) return slot.promise;
    // Only boot inside a real Next.js server process; skip in tests, builds,
    // or workers that don't set NEXT_RUNTIME.
    const runtime = process.env.NEXT_RUNTIME;
    if (runtime !== 'nodejs' && runtime !== 'edge') return;
    slot.promise = (async () => {
        try {
            if (runtime === 'edge') {
                // Edge: pull the HTTP-only entry. Doesn't ship `ws`, doesn't
                // call process.on. The auto module reads HARNESSA_FE_* env.
                await import('@harnessa-fe/node-runtime/auto-edge');
            } else {
                const mod = await import('@harnessa-fe/node-runtime');
                mod.register(opts);
            }
        } catch (err) {
            // Don't break SSR if the SDK fails to load (e.g. user removed
            // the package). Log once.
            // eslint-disable-next-line no-console
            console.warn('[harnessa-fe] node-runtime auto-boot failed:', err);
        }
    })();
    return slot.promise;
}

export async function HarnessaScript(props: HarnessaScriptProps): Promise<React.ReactElement | null> {
    if (!IS_DEV) return null;

    // Auto-boot the Node SDK on first server render (no instrumentation.ts
    // required). Fire-and-forget — we don't await, so the first request
    // isn't blocked on WS connect. Subsequent requests are no-ops (singleton).
    void ensureNodeRuntimeBooted({
        projectId: props.projectId,
        buildId: props.buildId,
        userId: props.userId,
        mcpUrl: props.mcpUrl,
    });

    // Lazy import so production bundles never pull this in.
    const { getSessionId } = await import('./sessionId.js');
    const { HarnessaScriptClient } = await import('./HarnessaScriptClient.js');

    const sessionId = getSessionId();

    // The seed script runs synchronously before React hydration so the
    // runtime client can read the sessionId immediately on DOMContentLoaded.
    const seedScript = `window.__HARNESSA_FE_SEED__=${JSON.stringify({ sessionId })};`;

    return (
        <>
            {/* eslint-disable-next-line react/no-danger */}
            <script id="__hfe_seed__" dangerouslySetInnerHTML={{ __html: seedScript }} />
            <HarnessaScriptClient {...props} />
        </>
    );
}
