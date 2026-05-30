/**
 * JSON API surface consumed by `@harness-fe/dashboard-ui` (the React SPA).
 *
 * The shape mirrors what the legacy server-rendered dashboard.ts displayed,
 * but as JSON so the SPA can render it with proper components and live
 * updates. Routes live under `/api/*` to keep them clearly separated from
 * SPA assets (`/dashboard/*`) and the replay viewer (`/replay/*`).
 *
 * Reuses `createReplayExport` from replayCreate.ts for the replay POST —
 * same logic the legacy dashboard's form submission ran through, just
 * returns JSON instead of redirecting.
 *
 * Auth is already enforced by `isAuthorized` in bridge.ts before this
 * handler runs, so we never need to check tokens here.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type {
    IStore,
    ProjectMeta,
    RecordingChunkSummary,
    ReplayExportMeta,
    SessionMeta,
    SessionSummary,
    StoreEvent,
} from './store/types.js';
import { createReplayExport, type ReplayCreateResult } from './replayCreate.js';

const TIMELINE_DEFAULT_TAIL = 100;
const SESSIONS_PER_PROJECT = 10;

export interface ProjectListEntry {
    project: ProjectMeta;
    recentSessions: SessionMeta[];
}

export interface SessionDetailResponse {
    session: SessionMeta;
    summary: SessionSummary;
    chunks: RecordingChunkSummary[];
    timeline: StoreEvent[];
    exports: ReplayExportMeta[];
}

export interface ReplayCreateBody {
    tabId?: string;
    ts?: number;
    windowMs?: number;
    since?: number;
    until?: number;
    label?: string;
}

export function createDashboardApiHandler(
    store: IStore,
    getBaseUrl: () => string | undefined,
    onExportCreated?: (input: { sessionId: string; projectId?: string }) => void,
): (req: IncomingMessage, res: ServerResponse) => boolean | Promise<boolean> {
    return async (req, res) => {
        if (!req.url) return false;
        const url = new URL(req.url, 'http://localhost');
        const path = url.pathname;
        if (!path.startsWith('/api/')) return false;
        const method = req.method ?? 'GET';

        // GET /api/projects
        if (method === 'GET' && path === '/api/projects') {
            const projects = store.listProjects();
            const entries: ProjectListEntry[] = projects.map((project) => {
                const recentSessions = store.listSessions({
                    projectId: project.id,
                    limit: SESSIONS_PER_PROJECT,
                });
                return { project, recentSessions };
            });
            sendJson(res, 200, { projects: entries });
            return true;
        }

        // GET /api/sessions?projectId=&tabId=&buildId=&limit=
        if (method === 'GET' && path === '/api/sessions') {
            const sessions = store.listSessions({
                projectId: url.searchParams.get('projectId') ?? undefined,
                tabId: url.searchParams.get('tabId') ?? undefined,
                buildId: url.searchParams.get('buildId') ?? undefined,
                limit: parseIntOr(url.searchParams.get('limit'), 50),
            });
            sendJson(res, 200, { sessions });
            return true;
        }

        // /api/sessions/:id and /api/sessions/:id/replay
        const sessionMatch = path.match(/^\/api\/sessions\/([^/]+)(\/replay)?$/);
        if (sessionMatch) {
            const sessionId = decodeURIComponent(sessionMatch[1]!);
            const isReplay = !!sessionMatch[2];

            if (isReplay && method === 'POST') {
                let body: ReplayCreateBody;
                try {
                    body = await readJsonBody(req);
                } catch (err) {
                    sendJson(res, 400, { error: `invalid JSON body: ${(err as Error).message}` });
                    return true;
                }
                const result: ReplayCreateResult = createReplayExport(store, getBaseUrl(), {
                    sessionId,
                    tabId: body.tabId,
                    ts: body.ts,
                    windowMs: body.windowMs,
                    since: body.since,
                    until: body.until,
                    label: body.label,
                });
                const status = result.error ? 400 : 200;
                if (!result.error && result.exportId && onExportCreated) {
                    // Find the session's project so subscribers can filter.
                    const projectId = store.getSession(sessionId)?.participants[0]?.projectId;
                    onExportCreated({ sessionId, projectId });
                }
                sendJson(res, status, result);
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
                const tailN = parseIntOr(url.searchParams.get('timeline'), TIMELINE_DEFAULT_TAIL);
                const timeline = store.tail(sessionId, { n: tailN });
                // Exports for the session's owning project (filter by sessionId).
                const projectId = session.participants[0]?.projectId ?? '';
                const exports = projectId
                    ? store.listExports(projectId, 50).filter((e) => e.sessionId === sessionId)
                    : [];
                const body: SessionDetailResponse = {
                    session,
                    summary,
                    chunks,
                    timeline,
                    exports,
                };
                sendJson(res, 200, body);
                return true;
            }
        }

        // Any other /api/ path → 404 (consumed so the legacy handler doesn't try).
        sendJson(res, 404, { error: 'not found', path });
        return true;
    };
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
    res.statusCode = status;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    res.end(JSON.stringify(body));
}

async function readJsonBody(req: IncomingMessage): Promise<ReplayCreateBody> {
    const chunks: Buffer[] = [];
    let total = 0;
    const MAX = 1024 * 1024; // 1 MB — replay create bodies are tiny; cap to defend against DoS
    for await (const chunk of req) {
        const buf = chunk as Buffer;
        total += buf.length;
        if (total > MAX) throw new Error(`request body exceeds ${MAX} bytes`);
        chunks.push(buf);
    }
    if (chunks.length === 0) return {};
    const text = Buffer.concat(chunks).toString('utf-8');
    return JSON.parse(text) as ReplayCreateBody;
}

function parseIntOr(raw: string | null, fallback: number): number {
    if (raw == null) return fallback;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
}
