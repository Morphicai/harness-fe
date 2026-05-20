/**
 * @harnessa-fe/next/script — `<HarnessaScript />`
 *
 * Server Component wrapper. Place once in your root layout (`app/layout.tsx`)
 * inside <body>:
 *
 *   import { HarnessaScript } from '@harnessa-fe/next/script';
 *   <HarnessaScript projectId="my-app" />
 *
 * What this does in dev:
 *   1. Calls `getSessionId()` (React `cache()`-backed) to allocate a
 *      deterministic per-request UUID on the server.
 *   2. Inlines a tiny <script> that writes the sessionId into
 *      `window.__HARNESSA_FE_SEED__` before any React hydration runs.
 *   3. Renders `<HarnessaScriptClient>` (the `'use client'` component)
 *      which boots the runtime and adopts the seed sessionId.
 *
 * Result: server-side events emitted by `@harnessa-fe/node-runtime` and
 * client-side events emitted by the RuntimeClient share the SAME sessionId.
 * One refresh = one `~/.harnessa/data/sessions/{id}/timeline.jsonl`.
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

export async function HarnessaScript(props: HarnessaScriptProps): Promise<React.ReactElement | null> {
    if (!IS_DEV) return null;

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
