/**
 * @morphixai/harnessa-fe.protocol — shared types + Zod schemas.
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
