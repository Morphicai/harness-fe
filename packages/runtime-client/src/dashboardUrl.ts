/**
 * Convert the runtime's `mcpUrl` (the gateway WebSocket URL the plugin gave us)
 * into the console URL the same gateway serves: `<http>://<host>:<port>/console`,
 * deep-linking to `/console/sessions/:id` when a sessionId is given.
 *
 * This is a **pure shortcut** — it carries NO token. Opening it is plain
 * navigation; the console authorizes the viewer on its own (admin sign-in or a
 * pasted read token). The runtime's token is write-only and must never be used
 * as a console auth grant, so it's deliberately omitted.
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
        ? `/console/sessions/${encodeURIComponent(input.sessionId)}`
        : '/console';
    return `${httpScheme}//${url.host}${path}`;
}
