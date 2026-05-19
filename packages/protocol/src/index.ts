/**
 * @harnessa-fe/protocol — shared types + Zod schemas.
 *
 * All three other packages (mcp-server / vite-plugin / runtime-client)
 * depend on this and nothing else from morphix. Keep it small and pure.
 */

export * from './selectors.js';
export * from './messages.js';
export * from './results.js';

export const PROTOCOL_VERSION = '0.0.1';

/** Default port for the local MCP server WebSocket bridge. */
export const DEFAULT_WS_PORT = 47729;

/** Default WebSocket URL — what every layer falls back to when no override is configured. */
export const DEFAULT_WS_URL = `ws://127.0.0.1:${DEFAULT_WS_PORT}`;

/**
 * Parse a `ws://host:port` (or `wss://host:port[/path]`) URL into host + port.
 * Used by mcp-server's CLI to listen on the URL the user requested. Falls
 * back to the default port when the URL doesn't include one.
 */
export function parseWsUrl(url: string): { host: string; port: number; pathname: string } {
    const u = new URL(url);
    if (u.protocol !== 'ws:' && u.protocol !== 'wss:') {
        throw new Error(`harnessa-fe: expected ws:// or wss:// URL, got ${u.protocol}`);
    }
    const port = u.port ? Number(u.port) : DEFAULT_WS_PORT;
    return { host: u.hostname, port, pathname: u.pathname || '/' };
}
