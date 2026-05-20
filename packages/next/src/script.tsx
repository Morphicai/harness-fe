'use client';

/**
 * @harnessa-fe/next/script — `<HarnessaScript />`
 *
 * Place once in your root layout (`app/layout.tsx`) inside <body>. In dev:
 *   - Seeds `window.__HARNESSA_FE__` with the project config.
 *   - Dynamically imports `@harnessa-fe/runtime`, which auto-connects to
 *     the MCP daemon and starts capturing events.
 *   - Subsequent renders are idempotent (guarded via window flag).
 *
 * In production builds this component renders nothing (no imports
 * pulled into client bundles either, thanks to the env check at module top).
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
     * App-supplied user identifier (e.g. `user.id` from supabase /
     * NextAuth / Auth0). Attached to the visitor record on the daemon
     * side. Empty / undefined for anonymous traffic — the daemon still
     * stitches the journey via the localStorage-based `visitorId`.
     *
     * Privacy reminder: this is sent to your local daemon. Don't pass
     * raw emails unless you understand who can read `~/.harnessa/data/`.
     */
    userId?: string;
    /**
     * Build artifact id — stamped on every event so agents can answer
     * "which code version was running when this happened?". Optional.
     *
     * Recommended sources:
     *   - Production: your git SHA injected at build time
     *       e.g. `process.env.NEXT_PUBLIC_GIT_SHA`
     *   - Self-hosted with Next.js build id:
     *       e.g. `process.env.__NEXT_BUILD_ID` (server side; pass through props)
     *   - Dev: leave undefined; every refresh is "current source" anyway.
     *
     * Without it, the daemon still works — it just can't slice timelines by
     * build (`build.timeline` returns nothing for this project).
     */
    buildId?: string;
}

const IS_DEV = process.env.NODE_ENV === 'development';

declare global {
    interface Window {
        __HARNESSA_FE__?: {
            projectId: string;
            parentProjectId?: string;
            displayName?: string;
            mcpUrl?: string;
            buildId?: string;
            userId?: string;
        };
        __HARNESSA_FE_NEXT_BOOTED__?: boolean;
    }
}

export function HarnessaScript(props: HarnessaScriptProps): null {
    if (!IS_DEV) return null;
    if (typeof window === 'undefined') return null;

    // Run only once per page load. Re-renders / route changes are no-ops.
    if (!window.__HARNESSA_FE_NEXT_BOOTED__) {
        window.__HARNESSA_FE_NEXT_BOOTED__ = true;
        window.__HARNESSA_FE__ = {
            projectId: props.projectId,
            parentProjectId: props.parentProjectId,
            displayName: props.displayName ?? props.projectId,
            mcpUrl: props.mcpUrl ?? 'ws://127.0.0.1:47729',
            buildId: props.buildId,
            userId: props.userId,
        };
        // Dynamic import: bundles the runtime into client chunks because
        // this whole file is 'use client'. The import is async; first
        // events before resolution may be missed, which is acceptable for
        // a dev tool.
        import('@harnessa-fe/runtime').catch((err: unknown) => {
            // Swallow — dev tool, don't break the app on a network blip.
            // eslint-disable-next-line no-console
            console.warn('[harnessa-fe] runtime load failed:', err);
        });
    }
    return null;
}
