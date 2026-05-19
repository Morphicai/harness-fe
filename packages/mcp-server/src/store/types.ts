/**
 * Store types — the public interface for the JSONL-based persistence layer.
 *
 * Directory layout:
 *   {dataDir}/
 *   └── {projectId}/
 *       ├── meta.json                  project metadata
 *       ├── tasks.json                 annotation tasks
 *       ├── memory.json                agent memory (key-value)
 *       ├── notes.jsonl                project-level notes (cross-session, legacy)
 *       └── sessions/
 *           └── {sessionId}/
 *               ├── meta.json          session metadata
 *               ├── timeline.jsonl     session-level event stream
 *               └── tabs/
 *                   └── {tabId}/
 *                       ├── meta.json        tab metadata
 *                       ├── timeline.jsonl   tab-level event stream
 *                       └── recording.jsonl  rrweb recording (optional)
 */

import type { Task } from '@harnessa-fe/protocol';

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
    | 'load'         // page-load initial snapshot (tab-scoped)
    | 'storage'      // localStorage/sessionStorage/cookie mutation (tab-scoped)
    | string;        // extensible — future types don't need schema changes

/** A single event line in a JSONL file. */
export interface StoreEvent {
    /**
     * Server-assigned monotonic integer per session (assigned at enqueue time).
     * Optional on input — the store layer assigns this; callers of `append` omit it.
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
     * Load ID — identifies the page load this event belongs to.
     * REQUIRED when `tab` is set (every tab-scoped event MUST be attributable
     * to a specific page load). MUST be absent for session-scoped events
     * such as build-plugin `hmr` / `node:log` / `node:err`.
     */
    load?: string;
    /** Event payload — structure depends on `t`. */
    d?: unknown;
}

// ─── Metadata shapes ─────────────────────────────────────────────────────────

export interface ProjectMeta {
    id: string;
    createdAt: number;
    lastActiveAt: number;
    /**
     * Parent project's id when this project is loaded as a sub-app
     * (e.g. micro-frontend iframe child, module-federation remote).
     * Forms the project tree; undefined = forest root.
     */
    parentProjectId?: string;
    /** Human-readable display name. Defaults to package.json `name`. */
    displayName?: string;
    /** Free-form labels (monorepo / team / product-line / …). */
    tags?: string[];
    /**
     * Extension slot — future relationship/categorization types live here
     * before being promoted to first-class fields.
     */
    metadata?: Record<string, unknown>;
}

/**
 * Per-build metadata. One row per distinct build artifact. Builds are an
 * external dimension to sessions/tabs — a single build can be executed by
 * many tabs across many page-load sessions; recording these lets agents
 * answer "what source code was running when this happened".
 *
 * Falls back to dev defaults when git is unavailable.
 */
export interface BuildMeta {
    /** buildId — stable for the lifetime of a dev server run / a prod build. */
    id: string;
    projectId: string;
    builtAt: number;
    /** git rev-parse HEAD, when available. */
    gitSha?: string;
    /** True if working tree had uncommitted changes when this build was started. */
    gitDirty?: boolean;
    /** Hash of (package.json + lockfile + key config files) — falls back when gitSha is missing. */
    sourceDigest?: string;
    nodeVersion?: string;
    /** 'vite' | 'webpack' | 'esbuild' | 'rspack' | … */
    bundler?: string;
    bundlerVersion?: string;
    metadata?: Record<string, unknown>;
}

/**
 * Node in a project tree returned by `getProjectTree`. Computed from
 * `ProjectMeta.parentProjectId` relationships at read time.
 */
export interface ProjectTreeNode {
    id: string;
    displayName?: string;
    tags?: string[];
    children: ProjectTreeNode[];
}

export interface SessionMeta {
    id: string;
    projectId: string;
    peerRole: string;
    startedAt: number;
    endedAt?: number;
    metadata?: Record<string, unknown>;
}

export interface TabMeta {
    id: string;
    sessionId: string;
    url?: string;
    title?: string;
    userAgent?: string;
    connectedAt: number;
    disconnectedAt?: number;
}

/**
 * Per-load metadata. One row per page load, appended to
 * `tabs/{tabId}/loads.jsonl`. The store rewrites a row in place when
 * `endedAt` is filled in (next PAGE_LOAD arrives or tab disconnects).
 */
export interface LoadMeta {
    /** loadId generated by the runtime client. */
    id: string;
    tabId: string;
    sessionId: string;
    startedAt: number;
    /** Set when the next load begins on the same tab, or when the tab closes. */
    endedAt?: number;
    /** Page metadata captured at load start. */
    url?: string;
    title?: string;
    referrer?: string;
    userAgent?: string;
    /** Compact summary of the initial snapshot stored on the load timeline. */
    initial?: {
        viewport?: { w: number; h: number; dpr: number };
        storageKeys?: { local?: number; session?: number; cookie?: number };
        storageTruncated?: boolean;
    };
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
    /** Only return events for a specific page load. */
    loadId?: string;
}

export interface SearchOptions {
    /** Filter by event type(s). */
    type?: EventType | EventType[];
    /** Max results. Default 50. */
    limit?: number;
    /** Only return events for a specific page load. */
    loadId?: string;
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
 * Metadata for a saved replay export. The actual events array lives in
 * {dataDir}/{projectId}/exports/{exportId}.rrweb.json.
 */
export interface ReplayExportMeta {
    exportId: string;
    projectId: string;
    sessionId: string;
    tabId?: string;
    /** Optional human label, e.g. "checkout-error". */
    label?: string;
    /** Window requested by the caller. */
    since: number;
    until: number;
    /** Time span actually covered by the exported events (may be tighter than [since, until]). */
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
    /** Keep at most this many sessions per project. Default 20. */
    maxSessionsPerProject?: number;
    /** Delete recording.jsonl files older than this many days. Default 3. */
    recordingRetentionDays?: number;
    /** Keep at most this many recording chunks per tab. */
    maxRecordingChunksPerTab?: number;
    /** Keep at most this many bytes of recording data per tab. */
    maxRecordingBytesPerTab?: number;
    /** Prefer keeping chunks that overlap rrweb markers when trimming by count/bytes. */
    preserveMarkedChunks?: boolean;
    /** Keep at most this many replay exports per project. Default 50. */
    maxExportsPerProject?: number;
    /** Keep at most this many bytes of replay exports per project. Default 200MB. */
    maxExportBytesPerProject?: number;
}

export interface PurgeResult {
    sessionsDeleted: number;
    recordingsDeleted: number;
    exportsDeleted: number;
    bytesFreed: number;
}

// ─── Task store interface ─────────────────────────────────────────────────────

/**
 * Persistence interface for annotation tasks.
 * Implementations use atomic write-then-rename for durability.
 */
export interface ITaskStore {
    /** Load all tasks for a project. Returns [] if file is missing or corrupt. */
    loadTasks(projectId: string): Task[];
    /** Atomically persist the full task list for a project. */
    saveTasks(projectId: string, tasks: Task[]): void;
}

// ─── Memory store interface ───────────────────────────────────────────────────

/** A single agent memory entry stored in memory.json. */
export interface MemoryEntry {
    /** The entry key. */
    key: string;
    /** The stored value (plain text or JSON string). */
    value: string;
    /** Unix ms timestamp of the last write. */
    updatedAt: number;
}

/**
 * Persistence interface for agent memory (persistent key-value store per project).
 * Implementations use atomic write-then-rename for durability.
 */
export interface IMemoryStore {
    /** Get a memory entry by key. Returns undefined if not found. */
    get(projectId: string, key: string): MemoryEntry | undefined;
    /** Write or update a memory entry. Returns the new/updated entry. */
    set(projectId: string, key: string, value: string): MemoryEntry;
    /** Delete a memory entry. Returns true if the key existed, false otherwise. */
    delete(projectId: string, key: string): boolean;
    /** List all memory entries for a project, sorted by updatedAt descending. */
    list(projectId: string): MemoryEntry[];
}

// ─── Store interface ──────────────────────────────────────────────────────────

export interface IStore {
    // ── Session lifecycle ──────────────────────────────────────────────────

    /** Create or resume a session for a project. Returns sessionId. */
    openSession(projectId: string, meta: Omit<SessionMeta, 'id' | 'projectId' | 'startedAt'>): string;

    /** Mark a session as ended. Optional closedAt timestamp (defaults to Date.now()). */
    closeSession(sessionId: string, closedAt?: number): void;

    /** Register a tab within a session. */
    openTab(sessionId: string, tab: Omit<TabMeta, 'sessionId' | 'connectedAt'>): void;

    /** Mark a tab as disconnected. */
    closeTab(sessionId: string, tabId: string): void;

    /**
     * Append a new LoadMeta to `tabs/{tabId}/loads.jsonl` and rewrite the
     * previous open load's `endedAt` to `meta.startedAt` (atomic per file).
     */
    openLoad(sessionId: string, tabId: string, meta: Omit<LoadMeta, 'tabId' | 'sessionId' | 'endedAt'>): void;

    /** Close the most-recent open load (sets endedAt). No-op if none is open. */
    closeLatestLoad(sessionId: string, tabId: string, endedAt?: number): void;

    // ── Write ──────────────────────────────────────────────────────────────

    /**
     * Append an event to the session timeline.
     * If tabId is provided, also appends to the tab timeline.
     */
    append(sessionId: string, event: StoreEvent, tabId?: string): void;

    /**
     * Append a batch of events (single write call — more efficient).
     */
    appendBatch(sessionId: string, events: StoreEvent[], tabId?: string): void;

    /**
     * Append an rrweb recording chunk to a tab's recording file.
     */
    appendRecording(sessionId: string, tabId: string, chunk: unknown): void;

    /**
     * Write a project-level note (cross-session knowledge).
     */
    writeNote(projectId: string, key: string, value: string): void;

    // ── Project metadata (v0.2: parent/displayName/tags) ───────────────────

    /**
     * Upsert project metadata. Merges with the existing meta.json:
     * caller-provided fields overwrite, others are preserved. `id` and
     * `createdAt` are never overwritten.
     *
     * Throws if `patch.parentProjectId` would create a cycle in the project tree.
     */
    upsertProject(projectId: string, patch: Partial<Omit<ProjectMeta, 'id' | 'createdAt'>>): ProjectMeta;

    /** Read a single project's metadata. */
    getProject(projectId: string): ProjectMeta | undefined;

    // ── Build metadata (v0.2: identify source-code snapshots) ──────────────

    /** Upsert build metadata. Creates the project dir if missing. */
    upsertBuild(projectId: string, buildId: string, patch: Partial<Omit<BuildMeta, 'id' | 'projectId'>>): BuildMeta;

    /** Read a single build's metadata. */
    getBuild(projectId: string, buildId: string): BuildMeta | undefined;

    /** List builds for a project, newest first. */
    listBuilds(projectId: string, limit?: number): BuildMeta[];

    // ── Project tree (v0.2: micro-frontend support) ────────────────────────

    /**
     * Get a forest (or sub-tree from `rootId`) constructed from
     * `ProjectMeta.parentProjectId`. Projects with no parent become roots.
     */
    getProjectTree(rootId?: string): ProjectTreeNode[];

    // ── Read ───────────────────────────────────────────────────────────────

    /** List all known projects. */
    listProjects(): ProjectMeta[];

    /** List sessions for a project, newest first. */
    listSessions(projectId: string, limit?: number): SessionMeta[];

    /** Get session metadata. */
    getSession(sessionId: string): SessionMeta | undefined;

    /**
     * Read the last N events from a session or tab timeline.
     * If tabId is omitted, reads from the session-level timeline.
     */
    tail(sessionId: string, opts?: TailOptions, tabId?: string): StoreEvent[];

    /**
     * Search events in a session timeline by substring match on the raw JSON line.
     */
    search(sessionId: string, query: string, opts?: SearchOptions, tabId?: string): StoreEvent[];

    /** List recording chunks for a session or a specific tab. */
    listRecordings(sessionId: string, tabId?: string): RecordingChunkSummary[];

    /** Return recording chunks overlapping the requested time window. */
    sliceRecordings(sessionId: string, since: number, until: number, tabId?: string): RecordingChunk[];

    /** List loads recorded for a tab, newest first. */
    listLoads(sessionId: string, tabId: string): LoadMeta[];

    /** Get a single LoadMeta by id. Returns undefined if not found. */
    getLoad(sessionId: string, tabId: string, loadId: string): LoadMeta | undefined;

    /**
     * Return recording chunks overlapping the load's [startedAt, endedAt]
     * window. If the load is still open, uses Date.now() as the upper bound.
     */
    sliceRecordingsByLoad(sessionId: string, tabId: string, loadId: string): RecordingChunk[];

    /**
     * Persist a replay export (concatenated rrweb events for a time window).
     * Returns metadata. Events are stored as a single JSON array file on disk.
     */
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

    /** Read export metadata by id. Returns undefined if not found. */
    getExport(exportId: string): ReplayExportMeta | undefined;

    /** Read the raw events array for an export. Returns undefined if missing. */
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
