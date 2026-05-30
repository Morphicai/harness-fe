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
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
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
    const b = bridge as Bridge;
    if (typeof b.prependHttpHandler !== 'function') {
        throw new Error(
            'mcpHttp: bridge does not support prependHttpHandler (need a Bridge instance with HTTP server)',
        );
    }
    // Pass the daemon's auth so MCP tools can identify the per-call principal
    // from request headers (4.0 · P4). stdio (startMcpStdioServer) omits this,
    // so stdio calls resolve to the local principal.
    const auth = b.getAuthOptions();

    // Per-session transports (4.0) — the MCP HTTP spec's stateful model: each
    // client gets its own transport + server keyed by `mcp-session-id`, created
    // on `initialize`. The old shape shared ONE transport for the whole daemon,
    // which locked after the first initialize — a second agent (or any reconnect)
    // hit "Server already initialized". Per-session is what lets multiple agents
    // share one daemon through the gateway, and lets a client reconnect.
    type Session = { transport: StreamableHTTPServerTransport; server: ReturnType<typeof createMcpServer> };
    const sessions = new Map<string, Session>();

    function newSession(): Session {
        const server = createMcpServer(bridge, { experimentalEnvVar: opts.experimentalEnvVar, auth });
        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: stateful ? () => randomUUID() : undefined,
            // null → resumability off; an explicit store → use it; default → a
            // fresh per-session MemoryEventStore.
            eventStore: opts.eventStore === null ? undefined : (opts.eventStore ?? new MemoryEventStore()),
            onsessioninitialized: (sid: string) => {
                sessions.set(sid, { transport, server });
            },
        });
        transport.onclose = () => {
            const sid = transport.sessionId;
            if (sid) sessions.delete(sid);
        };
        return { transport, server };
    }

    b.prependHttpHandler(async (req: IncomingMessage, res: ServerResponse) => {
        const url = req.url ?? '';
        const qi = url.indexOf('?');
        const reqPath = qi < 0 ? url : url.slice(0, qi);
        if (reqPath !== path) return false;

        // Per-call caller for command-target scoping (4.0 · A): every sendCommand
        // within this request reads it via currentCaller().
        const principal = identifyPrincipal(req.headers, auth);
        const sid = req.headers['mcp-session-id'];

        // Established session — route by id (POST follow-ups, GET SSE, DELETE).
        if (typeof sid === 'string' && sessions.has(sid)) {
            const { transport } = sessions.get(sid)!;
            await runWithCaller(principal, () => transport.handleRequest(req, res));
            return true;
        }

        // No (known) session id. A POST `initialize` opens one; anything else is invalid.
        if (req.method === 'POST') {
            let body: unknown;
            try {
                body = await readJsonBody(req);
            } catch {
                sendMcpError(res, 400, -32700, 'Parse error');
                return true;
            }
            if (stateful && !isInitializeRequest(body)) {
                sendMcpError(res, 400, -32600, 'Bad Request: no valid mcp-session-id (initialize first)');
                return true;
            }
            const { server, transport } = newSession();
            await server.connect(transport);
            if (!stateful) {
                // Stateless one-shot: tear down when the response ends.
                res.on('close', () => {
                    void transport.close();
                    void server.close();
                });
            }
            await runWithCaller(principal, () => transport.handleRequest(req, res, body));
            return true;
        }

        // GET/DELETE without a known session — nothing to attach to.
        sendMcpError(res, 400, -32600, 'Bad Request: unknown or missing mcp-session-id');
        return true;
    });

    return {
        path,
        async close() {
            for (const { server } of sessions.values()) {
                await server.close().catch(() => undefined);
            }
            sessions.clear();
        },
    };
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = [];
    let total = 0;
    const MAX = 4 * 1024 * 1024; // 4 MiB cap — MCP requests are small
    for await (const c of req) {
        const buf = c as Buffer;
        total += buf.length;
        if (total > MAX) throw new Error('mcp body too large');
        chunks.push(buf);
    }
    const raw = Buffer.concat(chunks).toString('utf8');
    return raw ? (JSON.parse(raw) as unknown) : undefined;
}

function sendMcpError(res: ServerResponse, status: number, code: number, message: string): void {
    res.statusCode = status;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ jsonrpc: '2.0', error: { code, message }, id: null }));
}
