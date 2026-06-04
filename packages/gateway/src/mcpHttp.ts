/**
 * MCP-over-HTTP transport, hosted by the gateway against the in-process core.
 *
 * Per-session: each client gets its own transport + MCP server keyed by
 * `mcp-session-id`, created on `initialize`. The session's {@link Principal} is
 * resolved from the initialize request through the {@link Policy} and baked into
 * the server — so the scoped manifest and every capability call use a stable
 * identity. A governed request with no/invalid token is rejected at init.
 */

import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { CoreClient } from '@harness-fe/core';
import { createMcpServer, type McpServerOptions } from './mcp.js';
import type { Policy } from './policy.js';

export interface McpHttpOptions {
    coreClient: CoreClient;
    policy: Policy;
    /** Tool-registration options (experimental gate, dashboard URL builder). */
    mcp?: McpServerOptions;
    /** Audit hook — called once per MCP request with the resolved caller. */
    onAudit?: (entry: { tokenId?: string; tool: string; ip?: string }) => void;
    /** Use stateful sessions (default true — what Claude Code / Cursor expect). */
    stateful?: boolean;
}

export interface McpHttpHandler {
    /** Handle a request already routed to the MCP path. Returns true when consumed. */
    handle(req: IncomingMessage, res: ServerResponse): Promise<boolean>;
    close(): Promise<void>;
}

type Session = {
    transport: StreamableHTTPServerTransport;
    server: ReturnType<typeof createMcpServer>;
    tokenId?: string;
};

export function createMcpHttpHandler(opts: McpHttpOptions): McpHttpHandler {
    const stateful = opts.stateful !== false;
    const caps = opts.coreClient.capabilities;
    const sessions = new Map<string, Session>();

    function audit(req: IncomingMessage, body: unknown, tokenId?: string): void {
        if (!opts.onAudit) return;
        opts.onAudit({ tokenId, tool: toolName(body), ip: req.socket.remoteAddress ?? undefined });
    }

    async function handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
        const sid = req.headers['mcp-session-id'];

        // Established session — route by id (POST follow-ups, GET SSE, DELETE).
        if (typeof sid === 'string' && sessions.has(sid)) {
            const session = sessions.get(sid)!;
            // Audit GET/DELETE here; POST bodies are audited in the init branch / below.
            await session.transport.handleRequest(req, res);
            return true;
        }

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

            // Resolve the caller for this new session. Governed + bad/missing token → 401.
            const resolved = opts.policy.resolveAgent(req);
            if (!resolved) {
                sendMcpError(res, 401, -32001, 'unauthorized: missing or invalid token');
                return true;
            }
            audit(req, body, resolved.caller?.tokenId);

            const server = createMcpServer(caps, resolved.principal, opts.mcp ?? {});
            const transport = new StreamableHTTPServerTransport({
                sessionIdGenerator: stateful ? () => randomUUID() : undefined,
                onsessioninitialized: (newSid: string) => {
                    sessions.set(newSid, { transport, server, tokenId: resolved.caller?.tokenId });
                },
            });
            transport.onclose = () => {
                const id = transport.sessionId;
                if (id) sessions.delete(id);
            };
            await server.connect(transport);
            if (!stateful) {
                res.on('close', () => {
                    void transport.close();
                    void server.close();
                });
            }
            await transport.handleRequest(req, res, body);
            return true;
        }

        sendMcpError(res, 400, -32600, 'Bad Request: unknown or missing mcp-session-id');
        return true;
    }

    return {
        handle,
        async close() {
            for (const { server } of sessions.values()) {
                await server.close().catch(() => undefined);
            }
            sessions.clear();
        },
    };
}

/** Best-effort tool/method name from a JSON-RPC MCP body, for the audit log. */
function toolName(body: unknown): string {
    const p = body as { method?: string; params?: { name?: string } } | undefined;
    return p?.params?.name ?? p?.method ?? 'mcp';
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = [];
    let total = 0;
    const MAX = 4 * 1024 * 1024;
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
