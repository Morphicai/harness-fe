/**
 * Convert the runtime's `mcpUrl` (a WebSocket URL the plugin gave us) into
 * the dashboard URL the same daemon serves.
 *
 * The daemon binds one HTTP+WS port; the dashboard lives at
 * `<http-scheme>://<host>:<port>/dashboard/`. The token, if any, is
 * carried in the query string so the browser is pre-authenticated on
 * first hit (after which mcp-server hands it off to a cookie — see
 * `packages/mcp-server/src/dashboardSpa.ts`).
 *
 * Optionally deep-links into a session's detail page when `sessionId` is
 * provided.
 */
export interface DashboardUrlInput {
    mcpUrl: string;
    sessionId?: string;
}

export function deriveDashboardUrl(input: DashboardUrlInput): string | undefined {
    if (!input.mcpUrl) return undefined;
    let url: URL;
    try {
        url = new URL(input.mcpUrl);
    } catch {
        return undefined;
    }
    const httpScheme = url.protocol === 'wss:' ? 'https:' : 'http:';
    const path = input.sessionId
        ? `/dashboard/sessions/${encodeURIComponent(input.sessionId)}`
        : '/dashboard/';
    const token = url.searchParams.get('token');
    const search = token ? `?token=${encodeURIComponent(token)}` : '';
    // Build manually so we don't leak any extra query/hash from the WS URL
    // (rare, but be defensive — the agent only ever sees what we hand it).
    return `${httpScheme}//${url.host}${path}${search}`;
}
