/**
 * `/console` — the unified back office.
 *
 * In the finished architecture this serves the React `@harness-fe/console-ui`
 * SPA (built in step ③) plus its data API. This step wires:
 *   - the **replay viewer** (`/replay/*`) so replay-export URLs resolve,
 *   - a JSON **data API** (`/console/api/*`) backed by the capability layer,
 *   - an SPA mount that serves a static `console-ui` dist when present, else a
 *     placeholder.
 *
 * Governance (servers / tokens / audit) is served separately by the admin
 * handler (kept until ③ folds it into the React console).
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { LOCAL_PRINCIPAL, type CoreClient } from '@harness-fe/core';
import { PROTOCOL_VERSION } from '@harness-fe/protocol';
import { createReplayHandler } from './replayViewer.js';

export interface ConsoleOptions {
    coreClient: CoreClient;
    /** Store for the replay viewer (in-process core's store). */
    store: import('@harness-fe/core').IStore | null;
    /** Directory holding the built console-ui SPA (index.html + assets). */
    consoleDir?: string;
    /** Reported gateway policy mode (for the meta endpoint). */
    mode: 'open' | 'governed';
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
    res.statusCode = status;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    res.end(JSON.stringify(body));
}

const PLACEHOLDER = `<!doctype html><html><head><meta charset="utf-8"><title>Harness console</title>
<style>body{font:14px/1.6 system-ui,sans-serif;max-width:680px;margin:64px auto;padding:0 16px;color:#1a1a1a}code{background:#f3f4f6;padding:2px 6px;border-radius:4px}</style></head>
<body><h1>Harness console</h1>
<p>The React console UI (<code>@harness-fe/console-ui</code>) is built in a later step. The data API is live at <code>/console/api/*</code>; replays render at <code>/replay/:id</code>.</p>
</body></html>`;

/**
 * Build the `/console` + `/replay` handler. Returns true when it consumed the
 * request. Reads use the trusted local principal (an authenticated console
 * operator sees everything — tenant isolation is for agents, not the operator).
 */
export function createConsoleHandler(
    opts: ConsoleOptions,
): (req: IncomingMessage, res: ServerResponse) => Promise<boolean> {
    const caps = opts.coreClient.capabilities;
    const replay = opts.store ? createReplayHandler(opts.store) : null;

    return async (req, res) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        const path = url.pathname;

        if (replay && path.startsWith('/replay/')) {
            return replay(req, res);
        }

        if (path.startsWith('/console/api/')) {
            try {
                return await handleApi(path, url, req, res);
            } catch (e) {
                sendJson(res, 500, { error: e instanceof Error ? e.message : String(e) });
                return true;
            }
        }

        if (path === '/console' || path === '/console/' || path.startsWith('/console/')) {
            return serveSpa(path, res);
        }

        return false;
    };

    async function handleApi(path: string, url: URL, req: IncomingMessage, res: ServerResponse): Promise<boolean> {
        if (req.method !== 'GET') {
            sendJson(res, 405, { error: 'method_not_allowed' });
            return true;
        }
        const p = LOCAL_PRINCIPAL;
        if (path === '/console/api/meta') {
            sendJson(res, 200, { protocolVersion: PROTOCOL_VERSION, mode: opts.mode });
            return true;
        }
        if (path === '/console/api/projects') {
            sendJson(res, 200, await caps.projectSessions(p));
            return true;
        }
        if (path === '/console/api/sessions') {
            const projectId = url.searchParams.get('projectId');
            if (!projectId) {
                sendJson(res, 400, { error: 'projectId required' });
                return true;
            }
            const limit = Number(url.searchParams.get('limit') ?? '20') || 20;
            sendJson(res, 200, await caps.sessionList(p, projectId, limit));
            return true;
        }
        // /console/api/session/:id/summary  |  /tail
        const m = path.match(/^\/console\/api\/session\/([^/]+)\/(summary|tail)$/);
        if (m) {
            const sessionId = decodeURIComponent(m[1]);
            if (m[2] === 'summary') {
                sendJson(res, 200, await caps.sessionSummary(p, sessionId));
            } else {
                const n = Number(url.searchParams.get('n') ?? '50') || 50;
                const type = url.searchParams.get('type') ?? undefined;
                sendJson(res, 200, await caps.sessionTail(p, sessionId, { n, type: type ?? undefined }));
            }
            return true;
        }
        sendJson(res, 404, { error: 'not_found' });
        return true;
    }

    function serveSpa(path: string, res: ServerResponse): boolean {
        if (!opts.consoleDir) {
            res.statusCode = 200;
            res.setHeader('content-type', 'text/html; charset=utf-8');
            res.end(PLACEHOLDER);
            return true;
        }
        // Serve a static asset under consoleDir, else fall back to index.html (SPA routing).
        const rel = path === '/console' || path === '/console/' ? 'index.html' : path.slice('/console/'.length);
        const safeRel = rel.replace(/\.\.+/g, '').replace(/^\/+/, '');
        const file = join(opts.consoleDir, safeRel);
        const target = existsSync(file) && safeRel ? file : join(opts.consoleDir, 'index.html');
        if (!existsSync(target)) {
            res.statusCode = 200;
            res.setHeader('content-type', 'text/html; charset=utf-8');
            res.end(PLACEHOLDER);
            return true;
        }
        res.statusCode = 200;
        res.setHeader('content-type', contentType(target));
        res.end(readFileSync(target));
        return true;
    }
}

function contentType(file: string): string {
    if (file.endsWith('.html')) return 'text/html; charset=utf-8';
    if (file.endsWith('.js')) return 'application/javascript; charset=utf-8';
    if (file.endsWith('.css')) return 'text/css; charset=utf-8';
    if (file.endsWith('.json')) return 'application/json; charset=utf-8';
    if (file.endsWith('.svg')) return 'image/svg+xml';
    return 'application/octet-stream';
}
