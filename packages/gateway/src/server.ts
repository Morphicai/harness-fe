/**
 * Gateway HTTP front door — the only thing browsers, agents, and operators
 * talk to. It embeds an in-process core (via {@link CoreClient}) and exposes:
 *
 *   /mcp       agent MCP (RBAC + scoped manifest + audit) → core capabilities
 *   /ws        runtime WebSocket (write scope) → core.acceptPeer (upgrade)
 *   /events    HTTP-batch ingest (node/Edge runtime) → core.handleHttpBatch
 *   /replay/*  rrweb replay viewer
 *   /console*  back-office SPA + data API
 *   /admin/*   governance panel (servers / tokens / audit) — governed mode
 *
 * The {@link Policy} (Open | Governed) decides how each caller's identity is
 * resolved; core enforces scope + visibility from the Principal it's handed.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { InProcessCoreClient, type CoreClient, type IStore } from '@harness-fe/core';
import { createMcpHttpHandler } from './mcpHttp.js';
import { attachRuntimeWs } from './runtimeWs.js';
import { createConsoleHandler } from './console.js';
import { createAdminHandler } from './admin.js';
import type { Policy } from './policy.js';
import type { GatewayStore } from './store.js';
import type { McpServerOptions } from './mcp.js';

export interface GatewayOptions {
    coreClient: CoreClient;
    policy: Policy;
    /** Governance store (servers / tokens / audit). Required for the admin panel. */
    store?: GatewayStore;
    /** MCP endpoint path. Default `/mcp`. */
    mcpPath?: string;
    /** Built console-ui dist directory (served at `/console`). */
    consoleDir?: string;
    /** Experimental-tool gate env var name. Omit → on. */
    experimentalEnvVar?: string;
}

export interface GatewayHandle {
    server: Server;
    listen(port: number, host?: string): Promise<number>;
    close(): Promise<void>;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
    res.statusCode = status;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
    const chunks: Buffer[] = [];
    let total = 0;
    const MAX = 8 * 1024 * 1024;
    for await (const c of req) {
        total += (c as Buffer).length;
        if (total > MAX) throw new Error('body too large');
        chunks.push(c as Buffer);
    }
    return Buffer.concat(chunks);
}

/** Best-effort store of the in-process core (for replay viewer + console data). */
function coreStore(coreClient: CoreClient): IStore | null {
    return coreClient instanceof InProcessCoreClient ? coreClient.bridge.store : null;
}

export function createGateway(opts: GatewayOptions): GatewayHandle {
    const mcpPath = opts.mcpPath ?? '/mcp';
    let baseUrl: string | undefined;

    const mcpHttp = createMcpHttpHandler({
        coreClient: opts.coreClient,
        policy: opts.policy,
        mcp: {
            experimentalEnvVar: opts.experimentalEnvVar,
            consoleUrl: (sessionId?: string) =>
                baseUrl ? `${baseUrl}/console${sessionId ? `/session/${encodeURIComponent(sessionId)}` : ''}` : undefined,
        },
        onAudit:
            opts.policy.audit && opts.store
                ? (e) => opts.store!.appendAudit({ ts: Date.now(), tokenId: e.tokenId, tool: e.tool, ip: e.ip })
                : undefined,
    });

    const consoleHandler = createConsoleHandler({
        coreClient: opts.coreClient,
        store: coreStore(opts.coreClient),
        consoleDir: opts.consoleDir,
        mode: opts.policy.mode,
    });

    // The admin panel manages governance entities; only meaningful in governed
    // mode (it gates on admin credentials in the store).
    const adminHandler = opts.store ? createAdminHandler(opts.store) : null;

    const server = createServer((req, res) => {
        handle(req, res).catch(() => {
            if (!res.headersSent) sendJson(res, 500, { error: 'gateway_error' });
        });
    });

    async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
        const path = (req.url ?? '').split('?')[0];

        if (path === mcpPath) {
            await mcpHttp.handle(req, res);
            return;
        }
        if (path === '/events' && req.method === 'POST') {
            await handleEvents(req, res);
            return;
        }
        if (path === '/events/ping') {
            sendJson(res, 200, { ok: true, protocolVersion: undefined });
            return;
        }
        if (adminHandler && (path === '/admin' || path.startsWith('/admin/'))) {
            if (await adminHandler(req, res)) return;
        }
        if (await consoleHandler(req, res)) return;

        sendJson(res, 404, { error: 'not_found' });
    }

    async function handleEvents(req: IncomingMessage, res: ServerResponse): Promise<void> {
        // The runtime/node-runtime may carry a write token; Open accepts anyone.
        const resolved = opts.policy.resolveRuntime(req);
        if (!resolved) return sendJson(res, 401, { error: 'unauthorized' });
        let body: { hello?: unknown; events?: unknown };
        try {
            body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
        } catch {
            return sendJson(res, 400, { error: 'bad_json' });
        }
        const hello = body.hello as Parameters<CoreClient['handleHttpBatch']>[0] | undefined;
        const events = (Array.isArray(body.events) ? body.events : []) as Parameters<CoreClient['handleHttpBatch']>[1];
        if (!hello || typeof (hello as { projectId?: unknown }).projectId !== 'string') {
            return sendJson(res, 400, { error: 'hello.projectId required' });
        }
        opts.coreClient.handleHttpBatch(hello, events);
        sendJson(res, 200, { ok: true, accepted: events.length });
    }

    const runtimeWs = attachRuntimeWs(server, { coreClient: opts.coreClient, policy: opts.policy });

    return {
        server,
        listen: (port, host = '127.0.0.1') =>
            new Promise<number>((resolve) => {
                server.listen(port, host, () => {
                    const addr = server.address();
                    const boundPort = typeof addr === 'object' && addr ? addr.port : port;
                    baseUrl = `http://${host}:${boundPort}`;
                    resolve(boundPort);
                });
            }),
        close: () =>
            new Promise<void>((resolve) => {
                runtimeWs.close();
                void mcpHttp.close();
                server.close(() => resolve());
            }),
    };
}

export type { McpServerOptions };
