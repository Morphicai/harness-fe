/**
 * MCP over HTTP transport mounted onto the bridge's existing HTTP server.
 *
 * Reuses the bridge's auth wrapper, so the same `--token` that protects
 * the dashboard also protects MCP tool calls. Remote agents talk to
 * `http://<host>:<port>/mcp` and authenticate via `Authorization: Bearer
 * <token>` like any other client.
 */

import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Bridge, IBridge } from './bridge.js';
import { createMcpServer } from './mcp.js';

export interface McpHttpOptions {
    /** URL path the transport listens on. Default `/mcp`. */
    path?: string;
    /**
     * Whether to use stateful sessions (sessionId in headers) or stateless
     * one-shot requests. Stateful is the spec default and matches what
     * Claude Code expects.
     */
    stateful?: boolean;
}

export interface McpHttpHandle {
    /** Close the MCP server and detach the transport. */
    close(): Promise<void>;
    path: string;
}

/**
 * Mount the MCP HTTP transport on the bridge's HTTP server. Bridge must
 * already have been started; calls `prependHttpHandler` so it runs before
 * the dashboard/replay/events handler chain.
 */
export async function startMcpHttpServer(
    bridge: IBridge,
    opts: McpHttpOptions = {},
): Promise<McpHttpHandle> {
    const path = opts.path ?? '/mcp';
    const stateful = opts.stateful !== false;

    const server = createMcpServer(bridge);
    const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: stateful ? () => randomUUID() : undefined,
    });
    await server.connect(transport);

    const b = bridge as Bridge;
    if (typeof b.prependHttpHandler !== 'function') {
        throw new Error(
            'mcpHttp: bridge does not support prependHttpHandler (need a Bridge instance with HTTP server)',
        );
    }

    b.prependHttpHandler(async (req: IncomingMessage, res: ServerResponse) => {
        const url = req.url ?? '';
        const qi = url.indexOf('?');
        const reqPath = qi < 0 ? url : url.slice(0, qi);
        if (reqPath !== path) return false;
        await transport.handleRequest(req, res);
        return true;
    });

    return {
        path,
        async close() {
            await server.close();
        },
    };
}
