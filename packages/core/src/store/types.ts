/**
 * Store types — the public interface for the JSONL-based persistence layer.
 *
 * v0.4.0 layout (new, flat):
 *   {dataDir}/projects/{projectId}/meta.json
 *   {dataDir}/projects/{projectId}/tasks.json
 *   {dataDir}/projects/{projectId}/memory.json
 *   {dataDir}/projects/{projectId}/notes.jsonl
 *   {dataDir}/projects/{projectId}/builds/{buildId}/meta.json
 *   {dataDir}/tabs/{tabId}/meta.json
 *   {dataDir}/sessions/{sessionId}/meta.json       ← one per pageload
 *   {dataDir}/sessions/{sessionId}/timeline.jsonl  ← mixed parent+child events
 *   {dataDir}/sessions/{sessionId}/recording.jsonl ← rrweb chunks
 *   {dataDir}/visitors/{visitorId}/meta.json       ← per-browser identity (0.5+)
 *
 * Legacy layout (v0.3.x, read-only fallback — daemon warns on startup):
 *   {dataDir}/{projectId}/sessions/{buildId}/tabs/{tabId}/...
 */

import type { Task, VisitorEnv } from '@harness-fe/protocol';

// NOTE: the MCP SDK's resumable-SSE `EventStore`/`EventId`/`StreamId` types and
// the `MemoryEventStore` implementation are intentionally NOT part of core —
// resumable streaming is an MCP-transport concern that lives in the gateway.
// core stays free of any `@modelcontextprotocol/sdk` dependency.

// ─── Event types ─────────────────────────────────────────────────────────────

/** Short type codes used in JSONL lines to keep files compact. */
export type EventType =
    | 'log'          // browser console
    | 'err'          // browser JS error
    | 'req'          // network request (start)
    | 'res'          // network response (end)
    | 'cmd'          // MCP command sent to runtime/plugin
    | 'resp'         // MCP command response
    | 'hmr'          // HMR update from build plugin
    | 'task'         // user annotation task submitted
    | 'task:claim'   // annotation task claimed by agent
    | 'task:resolve' // annotation task resolved by agent
    | 'rrweb'        // rrweb recording chunk
    | 'node:log'     // Node.js stdout from build plugin
    | 'node:err'     // Node.js stderr from build plugin
    | 'note'         // project-level note written by agent/user
    | 'load'         // page-load initial snapshot
    | 'storage'      // localStorage/sessionStorage/cookie mutation
    | 'ws'           // WebSocket frame (open / send / recv / close)
    | 'navigation'   // history.pushState/replaceState/popstate/hashchange + location.* setters
    | 'globals'      // window.X get/set/delete (build-time-watched keys)
    | 'indexeddb'    // IDB open / put / add / get / delete / clear / cursor
    | 'server-log'   // Node.js console log from node-runtime SDK
    | 'server-err'   // Node.js uncaughtException / unhandledRejection from node-runtime SDK
    | 'server-action'// Route Handler / Server Action timing from withHarnessTracing()
    | 'app-log'      // Explicit log call via @harness-fe/log (user-initiated, distinct from auto-captured console)
    | string;        // extensible — future types don't need schema changes

/** A single event line in a JSONL file. Carries row-level projectId/buildId tags. */
export interface StoreEvent {
    /**
     * Server-assigned monotonic integer per session (assigned at enqueue time).
     * Optional on input — the store layer assigns this.
     * Always present on events returned by `tail` and `search`.
     */
    seq?: number;
    /** Unix timestamp in milliseconds. */
    ts: number;
    /** Short event type code. */
    t: EventType;
    /** Tab ID — present for tab-scoped events. */
    tab?: string;
    /**
     * Load/session ID on tab-scoped events. Kept for backward compat with
     * v0.3.x event lines and bridge code that still stamps event.load.
     */
    load?: string;
    /**
     * Row-level project ID. Stamped by the bridge before calling appendEvent().
     */
    projectId?: string;
    /**
     * Row-level build ID. Stamped by the bridge.
     */
    buildId?: string;
    /**
     * Row-level visitor ID. Stamped by the bridge from the registered peer
     * or the frame's own `visitorId`. Lets agents filter timeline by
     * "everything from this user" without join lookups.
     */
    visitorId?: string;
    /** Event payload — structure depends on `t`. */
    d?: unknown;
}

// ─── Metadata shapes ─────────────────────────────────────────────────────────

export interface ProjectMeta {
    id: string;
    createdAt: number;
    lastActiveAt: number;
    parentProjectId?: string;
    displayName?: string;
    tags?: string[];
    /**
     * Caller-identity tag (4.0 · P1): principal id that first created this
     * project. Write-once (locked on creation like `createdAt`); informational
     * in P1, the basis for `project → agent` routing/isolation in P3.
     */
    createdBy?: string;
    metadata?: Record<string, unknown>;
}

/**
 * Per-build metadata. Lives at projects/{projectId}/builds/{buildId}/meta.json.
 */
export interface BuildMeta {
    id: string;
    projectId: string;
    builtAt: number;
    gitSha?: string;
    gitDirty?: boolean;
    sourceDigest?: string;
    nodeVersion?: string;
    /** 'vite' | 'webpack' | 'esbuild' | 'rspack' | … */
    bundler?: string;
    bundlerVersion?: string;
    /** Timestamp when this build's dev server was closed. */
    endedAt?: number;
    metadata?: Record<string, unknown>;
}

/**
 * Node in a project tree returned by `getProjectTree`.
 */
export interface ProjectTreeNode {
    id: string;
    displayName?: string;
    tags?: string[];
    children: ProjectTreeNode[];
}

/**
 * Per-tab metadata. Lives at tabs/{tabId}/meta.json.
 * A tab spans multiple sessions and may host multiple projects.
 */
export interface TabMeta {
    id: string;
    userAgent?: string;
    connectedAt: number;
    disconnectedAt?: number;
    metadata?: Record<string, unknown>;
}

/**
 * Per-session (pageload) metadata. Lives at sessions/{sessionId}/meta.json.
 * A session = one pageload. Multiple projects/iframes may participate
 * (they share sessionId via tryInheritFromParent).
 */
export interface SessionMeta {
    /** sessionId generated by the runtime (shared across same-origin iframes). */
    id: string;
    tabId: string;
    startedAt: number;
    endedAt?: number;
    url?: string;
    title?: string;
    referrer?: string;
    userAgent?: string;
    /**
     * Every (projectId, buildId) pair that participated in this pageload.
     * Merge semantics: new participants are appended on each upsertSession call.
     */
    participants: Array<{ projectId: string; buildId?: string; joinedAt: number }>;
    initial?: {
        viewport?: { w: number; h: number; dpr: number };
        storageKeys?: { local?: number; session?: number; cookie?: number };
        storageTruncated?: boolean;
    };
    /**
     * Caller-identity tag (4.0 · P1): principal id of the connection that
     * opened this session. Write-once. Informational in P1.
     */
    createdBy?: string;
    metadata?: Record<string, unknown>;
}

/**
 * Per-visitor identity. Lives at visitors/{visitorId}/meta.json. Stitches a
 * user's activity across pageloads / refreshes / tabs.
 */
export interface VisitorMeta {
    /** visitorId — anonymous UUID persisted in browser localStorage. */
    id: string;
    /** App-supplied identifier (latest non-empty value wins). */
    userId?: string;
    firstSeenAt: number;
    lastSeenAt: number;
    /** Distinct sessions (pageloads) attributed to this visitor. */
    sessionCount: number;
    /** LRU-capped list of distinct tabIds seen (max 50). */
    tabIds: string[];
    /** Distinct projects this visitor has touched (max 50). */
    projectIds: string[];
    /** Last-seen environment snapshot. */
    lastEnv?: VisitorEnv;
}

// ─── Query options ────────────────────────────────────────────────────────────

export interface TailOptions {
    /** Number of lines to return from the end. Default 50. */
    n?: number;
    /** Filter by event type(s). */
    type?: EventType | EventType[];
    /** Only return events after this timestamp. */
    since?: number;
    /** Only return events before this timestamp. */
    until?: number;
    /** Filter by projectId (useful for multi-project session timelines). */
    projectId?: string;
}

export interface SearchOptions {
    /** Filter by event type(s). */
    type?: EventType | EventType[];
    /** Max results. Default 50. */
    limit?: number;
}

export interface RecordingChunkSummary {
    chunkId: string;
    tabId: string;
    startTs: number;
    endTs: number;
    eventCount: number;
}

export interface RecordingChunk extends RecordingChunkSummary {
    events: unknown[];
}

/**
 * Metadata for a saved replay export.
 */
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

// ─── Summary ─────────────────────────────────────────────────────────────────

export interface SessionSummary {
    session: SessionMeta;
    counts: Partial<Record<EventType, number>>;
    lastError?: StoreEvent;
    lastActivity?: number;
    tabs: string[];
}

// ─── Retention ───────────────────────────────────────────────────────────────

export interface RetentionPolicy {
    /** Delete sessions older than this many days. Default 7. */
    maxAgeDays?: number;
    /** Keep at most this many sessions globally. Default 200. */
    maxSessions?: number;
    /** Delete recording.jsonl files older than this many days. Default 3. */
    recordingRetentionDays?: number;
    /** Keep at most this many recording chunks per session. */
    maxRecordingChunksPerSession?: number;
    /** Keep at most this many bytes of recording data per session. */
    maxRecordingBytesPerSession?: number;
    /** Prefer keeping chunks that overlap rrweb markers when trimming. */
    preserveMarkedChunks?: boolean;
    /** Keep at most this many replay exports per project. Default 50. */
    maxExportsPerProject?: number;
    /** Keep at most this many bytes of replay exports per project. Default 200MB. */
    maxExportBytesPerProject?: number;
    /** Keep at most this many BuildMeta records per project. Default 100. */
    maxBuildsPerProject?: number;

    // ─── Legacy aliases (v0.3.x backward compat for existing callers) ─────
    /** @deprecated Use maxSessions. */
    maxSessionsPerProject?: number;
    /** @deprecated Use maxRecordingChunksPerSession. */
    maxRecordingChunksPerTab?: number;
    /** @deprecated Use maxRecordingBytesPerSession. */
    maxRecordingBytesPerTab?: number;
}

export interface PurgeResult {
    sessionsDeleted: number;
    recordingsDeleted: number;
    exportsDeleted: number;
    buildsDeleted?: number;
    bytesFreed: number;
}

// ─── Task store interface ─────────────────────────────────────────────────────

export interface ITaskStore {
    loadTasks(projectId: string): Task[];
    saveTasks(projectId: string, tasks: Task[]): void;
}

// ─── Memory store interface ───────────────────────────────────────────────────

export interface MemoryEntry {
    key: string;
    value: string;
    updatedAt: number;
}

export interface IMemoryStore {
    get(projectId: string, key: string): MemoryEntry | undefined;
    set(projectId: string, key: string, value: string): MemoryEntry;
    delete(projectId: string, key: string): boolean;
    list(projectId: string): MemoryEntry[];
}

// ─── Store interface ──────────────────────────────────────────────────────────

export interface IStore {
    // ── Build lifecycle ────────────────────────────────────────────────────

    /**
     * Open a new build (dev server start / prod build). Returns buildId.
     * Writes projects/{projectId}/builds/{buildId}/meta.json.
     * (Replaces openSession() from v0.3.x)
     */
    openBuild(projectId: string, patch?: Partial<Omit<BuildMeta, 'id' | 'projectId' | 'builtAt'>>): string;

    /**
     * Mark a build as ended.
     * (Replaces closeSession() for build-plugin connections from v0.3.x)
     */
    closeBuild(buildId: string, closedAt?: number): void;

    // ── Tab lifecycle ──────────────────────────────────────────────────────

    /**
     * Write or update tab metadata at tabs/{tabId}/meta.json.
     * Merge semantics: caller-provided fields overwrite, others preserved.
     */
    upsertTab(tabId: string, patch: Partial<Omit<TabMeta, 'id'>>): TabMeta;

    /** Get tab metadata. */
    getTab(tabId: string): TabMeta | undefined;

    /**
     * Mark a tab as disconnected.
     * New signature: (tabId, disconnectedAt?) — no sessionId param.
     */
    closeTab(tabId: string, disconnectedAt?: number): void;

    // ── Session lifecycle (pageload) ───────────────────────────────────────

    /**
     * Open or update a session (one pageload). Writes sessions/{sessionId}/meta.json.
     * participants list is extended (not replaced) on each call.
     * (Replaces openLoad() from v0.3.x)
     */
    upsertSession(
        sessionId: string,
        meta: Partial<Omit<SessionMeta, 'id'>> & { tabId: string; startedAt: number },
    ): SessionMeta;

    /**
     * Mark a session as ended.
     * (Replaces closeLatestLoad() from v0.3.x)
     */
    closeSession(sessionId: string, endedAt?: number): void;

    /** Get session metadata. */
    getSession(sessionId: string): SessionMeta | undefined;

    /**
     * List sessions by recency.
     * New signature: opts object with optional tabId / projectId / buildId / limit.
     * (Replaces listSessions(projectId, limit?) from v0.3.x)
     */
    listSessions(opts?: { tabId?: string; projectId?: string; buildId?: string; limit?: number }): SessionMeta[];

    // ── Write ──────────────────────────────────────────────────────────────

    /**
     * Append a single event to sessions/{sessionId}/timeline.jsonl.
     * event.projectId and event.buildId should be pre-stamped by the bridge.
     * (Replaces append(sessionId=buildId, event, tabId?) from v0.3.x)
     */
    appendEvent(sessionId: string, event: StoreEvent): void;

    /**
     * Append a batch of events.
     * (Replaces appendBatch() from v0.3.x)
     */
    appendEventBatch(sessionId: string, events: StoreEvent[]): void;

    /**
     * Append an rrweb recording chunk to sessions/{sessionId}/recording.jsonl.
     * (Replaces appendRecording(sessionId, tabId, chunk, loadId?) from v0.3.x)
     */
    appendRecording(sessionId: string, chunk: unknown): void;

    /** Write a project-level note. */
    writeNote(projectId: string, key: string, value: string): void;

    // ── Project metadata ───────────────────────────────────────────────────

    /**
     * Upsert project metadata. `id` and `createdAt` are never overwritten.
     * Throws if `patch.parentProjectId` would create a cycle.
     */
    upsertProject(projectId: string, patch: Partial<Omit<ProjectMeta, 'id' | 'createdAt'>>): ProjectMeta;

    /** Read a single project's metadata. */
    getProject(projectId: string): ProjectMeta | undefined;

    /** List all known projects. */
    listProjects(): ProjectMeta[];

    // ── Build metadata ─────────────────────────────────────────────────────

    /** Upsert build metadata. Creates the project dir if missing. */
    upsertBuild(projectId: string, buildId: string, patch: Partial<Omit<BuildMeta, 'id' | 'projectId'>>): BuildMeta;

    /** Read a single build's metadata. */
    getBuild(projectId: string, buildId: string): BuildMeta | undefined;

    /** List builds for a project, newest first. */
    listBuilds(projectId: string, limit?: number): BuildMeta[];

    // ── Project tree ───────────────────────────────────────────────────────

    /** Get a forest (or sub-tree from `rootId`) from parentProjectId links. */
    getProjectTree(rootId?: string): ProjectTreeNode[];

    // ── Visitor metadata (0.5+) ─────────────────────────────────────────────

    /**
     * Upsert visitor metadata. Merges with existing meta:
     *   - `firstSeenAt` preserved; `lastSeenAt` advances
     *   - `sessionCount` increments when caller passes `incrementSession: true`
     *   - `tabIds` / `projectIds` deduped and LRU-capped at 50
     *   - `userId` overwritten if patch carries a non-empty value
     *   - `lastEnv` overwritten if patch carries one
     */
    upsertVisitor(
        visitorId: string,
        patch: {
            userId?: string;
            seenAt?: number;
            incrementSession?: boolean;
            addTabId?: string;
            addProjectId?: string;
            lastEnv?: VisitorEnv;
        },
    ): VisitorMeta;

    /** Read a single visitor's metadata. */
    getVisitor(visitorId: string): VisitorMeta | undefined;

    /** List known visitors, newest lastSeenAt first. */
    listVisitors(opts?: { projectId?: string; limit?: number }): VisitorMeta[];

    // ── Read ───────────────────────────────────────────────────────────────

    /**
     * Read the last N events from a session timeline.
     * New signature: no tabId param (tab is implicit per session).
     */
    tail(sessionId: string, opts?: TailOptions): StoreEvent[];

    /** Search events in a session timeline by substring match. */
    search(sessionId: string, query: string, opts?: SearchOptions): StoreEvent[];

    /** List recording chunks for a session. */
    listRecordings(sessionId: string): RecordingChunkSummary[];

    /** Return recording chunks overlapping the requested time window. */
    sliceRecordings(sessionId: string, since: number, until: number): RecordingChunk[];

    /** Persist a replay export. */
    writeExport(input: {
        sessionId: string;
        tabId?: string;
        since: number;
        until: number;
        label?: string;
        events: unknown[];
        startTs: number;
        endTs: number;
        chunkCount: number;
    }): ReplayExportMeta;

    /** Read export metadata by id. */
    getExport(exportId: string): ReplayExportMeta | undefined;

    /** Read the raw events array for an export. */
    readExportEvents(exportId: string): unknown[] | undefined;

    /** List exports for a project, newest first. */
    listExports(projectId: string, limit?: number): ReplayExportMeta[];

    /** Get a summary of a session (counts, last error, etc.). */
    summary(sessionId: string): SessionSummary;

    /** Read project notes. */
    listNotes(projectId: string): Array<{ key: string; value: string; ts: number }>;

    // ── Maintenance ────────────────────────────────────────────────────────

    /** Delete old sessions and recordings according to retention policy. */
    purge(policy?: RetentionPolicy): PurgeResult;

    /** Close any open file handles. */
    close(): void | Promise<void>;
}
