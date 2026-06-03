'use client';

/**
 * HarnessScriptClient — client-side boot component.
 *
 * Rendered by the server-side `<HarnessScript>` wrapper. Seeds
 * `window.__HARNESS_FE__` (including the per-request sessionId injected
 * by the server via `window.__HARNESS_FE_SEED__`) and dynamically imports
 * the runtime client.
 *
 * This component is intentionally separate from `script.tsx` so that the
 * `'use client'` boundary lives here while `<HarnessScript>` remains a
 * Server Component that can call `getSessionId()` via React `cache()`.
 */

import { useEffect } from 'react';
import type { HarnessScriptProps } from './script.js';

declare global {
    interface Window {
        __HARNESS_FE__?: {
            projectId: string;
            parentProjectId?: string;
            displayName?: string;
            mcpUrl?: string;
            buildId?: string;
            userId?: string;
            sessionId?: string;
            overlay?: boolean;
            consent?: string;
        };
        __HARNESS_FE_SEED__?: {
            sessionId: string;
        };
        __HARNESS_FE_NEXT_BOOTED__?: boolean;
    }
}

export function HarnessScriptClient(props: HarnessScriptProps): null {
    useEffect(() => {
        if (typeof window === 'undefined') return;
        if (window.__HARNESS_FE_NEXT_BOOTED__) return;
        window.__HARNESS_FE_NEXT_BOOTED__ = true;

        // Adopt the server-seeded sessionId if present; the runtime client
        // reads it from window.__HARNESS_FE__.sessionId via tryAdoptServerSeed().
        const seed = window.__HARNESS_FE_SEED__;
        window.__HARNESS_FE__ = {
            projectId: props.projectId,
            parentProjectId: props.parentProjectId,
            displayName: props.displayName ?? props.projectId,
            mcpUrl: props.mcpUrl ?? 'ws://127.0.0.1:47729',
            buildId: props.buildId,
            userId: props.userId,
            sessionId: seed?.sessionId,
            overlay: props.overlay ?? true,
            consent: props.consent,
        };

        import('@harness-fe/runtime').catch((err: unknown) => {
            // Dev tool — swallow, don't break the app.
            // eslint-disable-next-line no-console
            console.warn('[harness-fe] runtime load failed:', err);
        });
    }, [
        props.projectId,
        props.parentProjectId,
        props.displayName,
        props.mcpUrl,
        props.buildId,
        props.userId,
        props.overlay,
        props.consent,
    ]);
    return null;
}
