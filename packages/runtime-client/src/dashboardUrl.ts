/**
 * Convert the runtime's `mcpUrl` (the gateway WebSocket URL the plugin gave us)
 * into the console URL the same gateway serves.
 *
 * The gateway binds one HTTP+WS port; the console lives at
 * `<http-scheme>://<host>:<port>/console`. The token, if any, is carried in the
 * query string so the browser is pre-authenticated on first hit.
 *
 * Optionally deep-links into a session's detail page when `sessionId` is
 * provided (`/console/session/:id`).
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
        ? `/console/session/${encodeURIComponent(input.sessionId)}`
        : '/console';
    const token = url.searchParams.get('token');
    const search = token ? `?token=${encodeURIComponent(token)}` : '';
    // Build manually so we don't leak any extra query/hash from the WS URL.
    return `${httpScheme}//${url.host}${path}${search}`;
}
