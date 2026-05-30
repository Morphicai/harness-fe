/**
 * Compose dashboard URLs the user (or agent) should hit.
 *
 * Carries the configured auth token in the query string so the browser
 * lands pre-authenticated. On loopback hosts with no token configured,
 * the URL is left bare.
 */

import type { IBridge } from './bridge.js';

export interface DashboardUrlOptions {
    /** When provided, deep-link to a specific session detail page. */
    sessionId?: string;
}

export function buildDashboardUrl(
    bridge: IBridge,
    opts: DashboardUrlOptions = {},
): string | undefined {
    const base = bridge.getViewerBaseUrl();
    if (!base) return undefined;
    const path = opts.sessionId
        ? `/dashboard/sessions/${encodeURIComponent(opts.sessionId)}`
        : '/dashboard/';
    const token = bridge.getAuthToken();
    const qs = token ? `?token=${encodeURIComponent(token)}` : '';
    return `${base}${path}${qs}`;
}
