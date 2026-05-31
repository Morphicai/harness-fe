/**
 * `/console` — the unified back office. Serves the React `@harness-fe/console-ui`
 * SPA + its data API + the rrweb replay viewer.
 *
 *   /console/api/meta                     → version + policy mode
 *   /console/api/projects                 → projects + recent sessions
 *   /console/api/sessions?projectId&…      → session list
 *   /console/api/sessions/:id?timeline=N   → { session, summary, chunks, timeline, exports }
 *   POST /console/api/sessions/:id/replay  → create a replay export (viewer URL)
 *   /replay/*                              → rrweb replay viewer page + assets
 *   /console[/*]                           → the SPA (static dist, else placeholder)
 *
 * This is the operator surface: reads go straight to the in-process store (the
 * authenticated console operator sees everything — tenant isolation is for
 * agents, not the operator). The JSON contract mirrors the old dashboard so the
 * recovered dashboard UI consumes it unchanged but for the `/console/api` prefix.
 *
 * Governance (servers / tokens / audit) is served separately by the admin
 * handler at `/admin/*` and surfaced as a second tab in the SPA.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createReplayExport, type CoreClient, type IStore } from '@harness-fe/core';
import { PROTOCOL_VERSION } from '@harness-fe/protocol';
import { createReplayHandler } from './replayViewer.js';

const TIMELINE_DEFAULT_TAIL = 100;
const SESSIONS_PER_PROJECT = 10;

export interface ConsoleOptions {
    coreClient: CoreClient;
    /** Store for the data API + replay viewer (in-process core's store). */
    store: IStore | null;
    /** Outbound base URL (for replay viewer links). */
    getBaseUrl?: () => string | undefined;
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

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
    const chunks: Buffer[] = [];
    let total = 0;
    const MAX = 1024 * 1024;
    for await (const c of req) {
        const buf = c as Buffer;
        total += buf.length;
        if (total > MAX) throw new Error(`body exceeds ${MAX} bytes`);
        chunks.push(buf);
    }
    if (chunks.length === 0) return {};
    return JSON.parse(Buffer.concat(chunks).toString('utf-8')) as Record<string, unknown>;
}

function parseIntOr(raw: string | null, fallback: number): number {
    if (raw == null) return fallback;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
}

const PLACEHOLDER = `<!doctype html><html><head><meta charset="utf-8"><title>Harness console</title>
<style>body{font:14px/1.6 system-ui,sans-serif;max-width:680px;margin:64px auto;padding:0 16px;color:#1a1a1a}code{background:#f3f4f6;padding:2px 6px;border-radius:4px}</style></head>
<body><h1>Harness console</h1>
<p>Build the console UI (<code>pnpm --filter @harness-fe/console-ui build</code>) and serve it via <code>--console-dir</code>. The data API is live at <code>/console/api/*</code>; replays render at <code>/replay/:id</code>.</p>
</body></html>`;

/**
 * Build the `/console` + `/replay` handler. Returns true when it consumed the
 * request.
 */
export function createConsoleHandler(
    opts: ConsoleOptions,
): (req: IncomingMessage, res: ServerResponse) => Promise<boolean> {
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
        if (path === '/console' || path.startsWith('/console/')) {
            return serveSpa(path, res);
        }
        return false;
    };

    async function handleApi(path: string, url: URL, req: IncomingMessage, res: ServerResponse): Promise<boolean> {
        if (path === '/console/api/meta') {
            sendJson(res, 200, { daemonVersion: PROTOCOL_VERSION, protocolVersion: PROTOCOL_VERSION, mode: opts.mode });
            return true;
        }

        const store = opts.store;
        if (!store) {
            sendJson(res, 503, { error: 'store_disabled' });
            return true;
        }
        const method = req.method ?? 'GET';

        if (method === 'GET' && path === '/console/api/projects') {
            const projects = store.listProjects();
            const entries = projects.map((project) => ({
                project,
                recentSessions: store.listSessions({ projectId: project.id, limit: SESSIONS_PER_PROJECT }),
            }));
            sendJson(res, 200, { projects: entries });
            return true;
        }

        if (method === 'GET' && path === '/console/api/sessions') {
            const sessions = store.listSessions({
                projectId: url.searchParams.get('projectId') ?? undefined,
                tabId: url.searchParams.get('tabId') ?? undefined,
                buildId: url.searchParams.get('buildId') ?? undefined,
                limit: parseIntOr(url.searchParams.get('limit'), 50),
            });
            sendJson(res, 200, { sessions });
            return true;
        }

        // /console/api/sessions/:id  and  /console/api/sessions/:id/replay
        const m = path.match(/^\/console\/api\/sessions\/([^/]+)(\/replay)?$/);
        if (m) {
            const sessionId = decodeURIComponent(m[1]);
            const isReplay = !!m[2];

            if (isReplay && method === 'POST') {
                let body: Record<string, unknown>;
                try {
                    body = await readJsonBody(req);
                } catch (err) {
                    sendJson(res, 400, { error: `invalid JSON body: ${(err as Error).message}` });
                    return true;
                }
                const result = createReplayExport(store, opts.getBaseUrl?.(), {
                    sessionId,
                    tabId: body.tabId as string | undefined,
                    ts: body.ts as number | undefined,
                    windowMs: body.windowMs as number | undefined,
                    since: body.since as number | undefined,
                    until: body.until as number | undefined,
                    label: body.label as string | undefined,
                });
                sendJson(res, 'error' in result && result.error ? 400 : 200, result);
                return true;
            }

            if (method === 'GET') {
                const session = store.getSession(sessionId);
                if (!session) {
                    sendJson(res, 404, { error: 'session not found', sessionId });
                    return true;
                }
                const summary = store.summary(sessionId);
                const chunks = store.listRecordings(sessionId);
                const timeline = store.tail(sessionId, {
                    n: parseIntOr(url.searchParams.get('timeline'), TIMELINE_DEFAULT_TAIL),
                });
                const projectId = session.participants[0]?.projectId ?? '';
                const exports = projectId
                    ? store.listExports(projectId, 50).filter((e) => e.sessionId === sessionId)
                    : [];
                sendJson(res, 200, { session, summary, chunks, timeline, exports });
                return true;
            }
        }

        sendJson(res, 404, { error: 'not_found', path });
        return true;
    }

    function serveSpa(path: string, res: ServerResponse): boolean {
        if (!opts.consoleDir) {
            res.statusCode = 200;
            res.setHeader('content-type', 'text/html; charset=utf-8');
            res.end(PLACEHOLDER);
            return true;
        }
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
