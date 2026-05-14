/**
 * Store types — the public interface for the JSONL-based persistence layer.
 *
 * Directory layout:
 *   {dataDir}/
 *   └── {projectId}/
 *       ├── meta.json                  project metadata
 *       ├── notes.jsonl                project-level notes (cross-session)
 *       └── sessions/
 *           └── {sessionId}/
 *               ├── meta.json          session metadata
 *               ├── timeline.jsonl     session-level event stream
 *               └── tabs/
 *                   └── {tabId}/
 *                       ├── timeline.jsonl   tab-level event stream
 *                       └── recording.jsonl  rrweb recording (optional)
 */

// ─── Event types ─────────────────────────────────────────────────────────────

/** Short type codes used in JSONL lines to keep files compact. */
export type EventType =
    | 'log'        // browser console
    | 'err'        // browser JS error
    | 'req'        // network request (start)
    | 'res'        // network response (end)
    | 'cmd'        // MCP command sent to runtime/plugin
    | 'resp'       // MCP command response
    | 'hmr'        // HMR update from build plugin
    | 'task'       // user annotation task submitted
    | 'rrweb'      // rrweb recording chunk
    | 'node:log'   // Node.js stdout from build plugin
    | 'node:err'   // Node.js stderr from build plugin
    | 'note'       // project-level note written by agent/user
    | string;      // extensible — future types don't need schema changes

/** A single event line in a JSONL file. */
export interface StoreEvent {
    /** Unix timestamp in milliseconds. */
    ts: number;
    /** Short event type code. */
    t: EventType;
    /** Tab ID — present for tab-scoped events. */
    tab?: string;
    /** Event payload — structure depends on `t`. */
    d?: unknown;
}

// ─── Metadata shapes ─────────────────────────────────────────────────────────

export interface ProjectMeta {
    id: string;
    createdAt: number;
    lastActiveAt: number;
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
}

export interface SearchOptions {
    /** Filter by event type(s). */
    type?: EventType | EventType[];
    /** Max results. Default 50. */
    limit?: number;
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
}

export interface PurgeResult {
    sessionsDeleted: number;
    recordingsDeleted: number;
    bytesFreed: number;
}

// ─── Store interface ──────────────────────────────────────────────────────────

export interface IStore {
    // ── Session lifecycle ──────────────────────────────────────────────────

    /** Create or resume a session for a project. Returns sessionId. */
    openSession(projectId: string, meta: Omit<SessionMeta, 'id' | 'projectId' | 'startedAt'>): string;

    /** Mark a session as ended. */
    closeSession(sessionId: string): void;

    /** Register a tab within a session. */
    openTab(sessionId: string, tab: Omit<TabMeta, 'sessionId' | 'connectedAt'>): void;

    /** Mark a tab as disconnected. */
    closeTab(sessionId: string, tabId: string): void;

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
    appendRecording(sessionId: string, tabId: string, events: unknown[]): void;

    /**
     * Write a project-level note (cross-session knowledge).
     */
    writeNote(projectId: string, key: string, value: string): void;

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

    /** Get a summary of a session (counts, last error, etc.). */
    summary(sessionId: string): SessionSummary;

    /** Read project notes. */
    listNotes(projectId: string): Array<{ key: string; value: string; ts: number }>;

    // ── Maintenance ────────────────────────────────────────────────────────

    /** Delete old sessions and recordings according to retention policy. */
    purge(policy?: RetentionPolicy): PurgeResult;

    /** Close any open file handles. */
    close(): void;
}
