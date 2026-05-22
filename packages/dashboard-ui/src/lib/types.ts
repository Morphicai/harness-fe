/**
 * Type definitions matching the JSON API surface in mcp-server's
 * `dashboardApi.ts`. Kept local (rather than importing from
 * `@harness-fe/mcp-server`) so the SPA can be built independently —
 * the daemon ships the dist; the dashboard never imports daemon code.
 *
 * If a field drifts here vs the API, the SPA degrades gracefully (most
 * fields are optional) and a single integration test in mcp-server
 * catches the worst regressions.
 */

export interface ProjectMeta {
    id: string;
    createdAt: number;
    lastActiveAt: number;
    parentProjectId?: string;
    displayName?: string;
    tags?: string[];
}

export interface SessionMeta {
    id: string;
    tabId: string;
    startedAt: number;
    endedAt?: number;
    url?: string;
    title?: string;
    userAgent?: string;
    participants: Array<{ projectId: string; buildId?: string; joinedAt: number }>;
}

export interface ProjectListEntry {
    project: ProjectMeta;
    recentSessions: SessionMeta[];
}

export interface RecordingChunkSummary {
    chunkId: string;
    tabId: string;
    startTs: number;
    endTs: number;
    eventCount: number;
}

export interface ReplayExportMeta {
    exportId: string;
    projectId: string;
    sessionId: string;
    tabId?: string;
    label?: string;
    since: number;
    until: number;
    startTs: number;
    endTs: number;
    chunkCount: number;
    eventCount: number;
    bytes: number;
    createdAt: number;
}

export type StoreEventType =
    | 'log'
    | 'err'
    | 'net'
    | 'cmd'
    | 'resp'
    | 'load'
    | 'rrweb'
    | 'applog'
    | 'pageinfo'
    | string;

export interface StoreEvent {
    ts: number;
    t: StoreEventType;
    tab?: string;
    projectId?: string;
    buildId?: string;
    visitorId?: string;
    d?: unknown;
}

export interface SessionSummary {
    session: SessionMeta;
    counts: Partial<Record<string, number>>;
    lastError?: StoreEvent;
    lastActivity?: number;
    tabs: string[];
}

export interface SessionDetail {
    session: SessionMeta;
    summary: SessionSummary;
    chunks: RecordingChunkSummary[];
    timeline: StoreEvent[];
    exports: ReplayExportMeta[];
}

export interface ReplayCreateResult {
    exportId?: string;
    viewerUrl?: string;
    sessionId: string;
    tabId?: string;
    since: number;
    until: number;
    error?: string;
    eventCount?: number;
    chunkCount?: number;
    bytes?: number;
    startTs?: number;
    endTs?: number;
}

export interface DashboardUpdateFrame {
    type: 'dashboard.update';
    id: string;
    sessionId?: string;
    projectId?: string;
    kind: 'session.new' | 'session.update' | 'session.closed' | 'project.update' | 'export.new';
    ts: number;
}
