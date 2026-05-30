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
import type { Bridge, IBridge } from '@harness-fe/daemon';
import { createMcpServer } from './mcp.js';
import { identifyPrincipal } from '@harness-fe/daemon';
import { runWithCaller } from '@harness-fe/daemon';
import { MemoryEventStore } from '@harness-fe/daemon';
import type { EventStore } from '@harness-fe/daemon';

export interface McpHttpOptions {
    /** URL path the transport listens on. Default `/mcp`. */
    path?: string;
    /**
     * Whether to use stateful sessions (sessionId in headers) or stateless
     * one-shot requests. Stateful is the spec default and matches what
     * Claude Code expects.
     */
    stateful?: boolean;
    /**
     * EventStore for SSE resumability via `Last-Event-ID`. If a client
     * reconnects after a transient disconnect, the transport replays the
     * events it missed. Defaults to a `MemoryEventStore` with conservative
     * caps (1000 events / 5 minutes / 50 MiB total). Pass `null` to
     * disable resumability entirely.
     */
    eventStore?: EventStore | null;
    /**
     * Name of the environment variable that gates experimental tools.
     * Forwarded to `createMcpServer`. Omit for fully-on (no gate).
     */
    experimentalEnvVar?: string;
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
    const eventStore =
        opts.eventStore === null
            ? undefined
            : opts.eventStore ?? new MemoryEventStore();

    // Pass the daemon's auth so MCP tools can identify the per-call principal
    // from request headers (4.0 · P4). stdio (startMcpStdioServer) omits this,
    // so stdio calls resolve to the local principal.
    const server = createMcpServer(bridge, {
        experimentalEnvVar: opts.experimentalEnvVar,
        auth: (bridge as Bridge).getAuthOptions(),
    });
    const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: stateful ? () => randomUUID() : undefined,
        eventStore,
    });
    await server.connect(transport);

    const b = bridge as Bridge;
    if (typeof b.prependHttpHandler !== 'function') {
        throw new Error(
            'mcpHttp: bridge does not support prependHttpHandler (need a Bridge instance with HTTP server)',
        );
    }

    const auth = b.getAuthOptions();
    b.prependHttpHandler(async (req: IncomingMessage, res: ServerResponse) => {
        const url = req.url ?? '';
        const qi = url.indexOf('?');
        const reqPath = qi < 0 ? url : url.slice(0, qi);
        if (reqPath !== path) return false;
        // Establish the per-call caller for command-target scoping (4.0 · A):
        // every sendCommand within this request reads it via currentCaller().
        const principal = identifyPrincipal(req.headers, auth);
        await runWithCaller(principal, () => transport.handleRequest(req, res));
        return true;
    });

    return {
        path,
        async close() {
            await server.close();
        },
    };
}
