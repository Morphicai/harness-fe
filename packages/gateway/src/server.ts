/**
 * Gateway HTTP proxy (5.0 · P6 · C3) — the front door for team/public use.
 *
 * Agent → gateway (gateway token) → verify → route by `serverId` → forward the
 * MCP request to the target daemon, authenticating with the daemon's own token
 * and injecting the real caller via `x-harness-caller` (the daemon trusts a
 * forwarded identity only on auth-enabled requests, P6·C1). Every call is
 * audited. RBAC (scope gating) + dynamic manifest land in C4; admin in C5.
 */
import {
    createServer,
    request as httpRequest,
    type IncomingMessage,
    type Server,
    type ServerResponse,
} from 'node:http';
import { GatewayStore, type ServerRecord, type VerifiedCaller } from './store.js';
import { allowsTool, filterManifest, requiredScope } from './scope.js';

/** Header contract with the daemon (kept in sync with daemon's FORWARDED_CALLER_HEADER, P6·C1). */
const FORWARDED_CALLER_HEADER = 'x-harness-caller';

export interface GatewayOptions {
    store: GatewayStore;
    /** Path the MCP endpoint is served on. Default `/mcp`. */
    mcpPath?: string;
}

export interface GatewayHandle {
    server: Server;
    listen(port: number, host?: string): Promise<number>;
    close(): Promise<void>;
}

function bearer(req: IncomingMessage): string | undefined {
    const a = req.headers.authorization;
    if (typeof a === 'string' && a.startsWith('Bearer ')) return a.slice(7).trim() || undefined;
    return undefined;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
    res.statusCode = status;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    return Buffer.concat(chunks);
}

/** Best-effort tool/method name from a JSON-RPC MCP body, for the audit log. */
function toolName(body: Buffer): string {
    try {
        const p = JSON.parse(body.toString('utf8')) as { method?: string; params?: { name?: string } };
        return p?.params?.name ?? p?.method ?? 'mcp';
    } catch {
        return 'mcp';
    }
}

export function createGateway(opts: GatewayOptions): GatewayHandle {
    const path = opts.mcpPath ?? '/mcp';
    const server = createServer((req, res) => {
        handle(req, res).catch(() => {
            if (!res.headersSent) sendJson(res, 500, { error: 'gateway_error' });
        });
    });

    async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
        const reqPath = (req.url ?? '').split('?')[0];
        if (reqPath !== path) return sendJson(res, 404, { error: 'not_found' });

        const raw = bearer(req);
        const caller = raw ? opts.store.verifyToken(raw) : null;
        if (!caller) return sendJson(res, 401, { error: 'unauthorized' });

        const target = opts.store.getServer(caller.serverId);
        if (!target) return sendJson(res, 502, { error: 'no_server', serverId: caller.serverId });

        const body = req.method === 'GET' || req.method === 'HEAD' ? Buffer.alloc(0) : await readBody(req);
        opts.store.appendAudit({
            ts: Date.now(),
            tokenId: caller.tokenId,
            tool: toolName(body),
            serverId: caller.serverId,
            ip: req.socket.remoteAddress ?? undefined,
        });

        const rpc = parseRpc(body);
        // Scope gate (RBAC): deny a tools/call the caller has no scope for.
        if (rpc?.method === 'tools/call' && typeof rpc.tool === 'string' && !allowsTool(caller.scopes, rpc.tool)) {
            return sendJson(res, 200, {
                jsonrpc: '2.0',
                id: rpc.id ?? null,
                error: {
                    code: -32001,
                    message: `scope denied: "${rpc.tool}" requires "${requiredScope(rpc.tool)}" scope`,
                },
            });
        }
        // Dynamic manifest: filter tools/list to what the caller may use.
        if (rpc?.method === 'tools/list') {
            return forwardAndFilter(target, caller, body, res);
        }
        forward(target.endpoint, target.token, caller, req, body, res);
    }

    function parseRpc(body: Buffer): { method?: string; tool?: string; id?: unknown } | null {
        try {
            const p = JSON.parse(body.toString('utf8')) as {
                method?: string;
                params?: { name?: string };
                id?: unknown;
            };
            return { method: p.method, tool: p.params?.name, id: p.id };
        } catch {
            return null;
        }
    }

    /** Forward a tools/list, buffer the JSON response, and drop out-of-scope tools. */
    function forwardAndFilter(
        target: ServerRecord,
        caller: VerifiedCaller,
        body: Buffer,
        res: ServerResponse,
    ): void {
        let base: URL;
        try {
            base = new URL(target.endpoint);
        } catch {
            return sendJson(res, 502, { error: 'bad_server_endpoint' });
        }
        const headers: Record<string, string> = {
            'content-type': 'application/json',
            accept: 'application/json', // force JSON (not SSE) so we can filter
            [FORWARDED_CALLER_HEADER]: caller.tokenId,
        };
        if (target.token) headers.authorization = `Bearer ${target.token}`;
        const proxy = httpRequest(
            {
                protocol: base.protocol,
                hostname: base.hostname,
                port: base.port,
                path,
                method: 'POST',
                headers,
            },
            (dres) => {
                const chunks: Buffer[] = [];
                dres.on('data', (c) => chunks.push(c as Buffer));
                dres.on('end', () => {
                    let out = Buffer.concat(chunks);
                    try {
                        const parsed = JSON.parse(out.toString('utf8')) as { result?: { tools?: unknown } };
                        if (parsed?.result) {
                            parsed.result = filterManifest(parsed.result, caller.scopes);
                            out = Buffer.from(JSON.stringify(parsed), 'utf8');
                        }
                    } catch {
                        /* not JSON (SSE) — pass through unfiltered */
                    }
                    res.statusCode = dres.statusCode ?? 502;
                    res.setHeader('content-type', 'application/json');
                    res.end(out);
                });
            },
        );
        proxy.on('error', () => {
            if (!res.headersSent) sendJson(res, 502, { error: 'daemon_unreachable' });
        });
        proxy.end(body);
    }

    function forward(
        endpoint: string,
        daemonToken: string | undefined,
        caller: VerifiedCaller,
        req: IncomingMessage,
        body: Buffer,
        res: ServerResponse,
    ): void {
        let base: URL;
        try {
            base = new URL(endpoint);
        } catch {
            return sendJson(res, 502, { error: 'bad_server_endpoint' });
        }
        const headers: Record<string, string> = {
            accept: (req.headers.accept as string) ?? 'application/json, text/event-stream',
            [FORWARDED_CALLER_HEADER]: caller.tokenId,
        };
        const ct = req.headers['content-type'];
        if (typeof ct === 'string') headers['content-type'] = ct;
        if (daemonToken) headers.authorization = `Bearer ${daemonToken}`;

        const proxy = httpRequest(
            {
                protocol: base.protocol,
                hostname: base.hostname,
                port: base.port,
                path,
                method: req.method ?? 'POST',
                headers,
            },
            (dres) => {
                res.statusCode = dres.statusCode ?? 502;
                for (const [k, v] of Object.entries(dres.headers)) {
                    if (v !== undefined) res.setHeader(k, v as string | string[]);
                }
                dres.pipe(res);
            },
        );
        proxy.on('error', () => {
            if (!res.headersSent) sendJson(res, 502, { error: 'daemon_unreachable' });
        });
        if (body.length) proxy.write(body);
        proxy.end();
    }

    return {
        server,
        listen: (port, host = '127.0.0.1') =>
            new Promise<number>((resolve) => {
                server.listen(port, host, () => {
                    const addr = server.address();
                    resolve(typeof addr === 'object' && addr ? addr.port : port);
                });
            }),
        close: () => new Promise<void>((r) => server.close(() => r())),
    };
}
