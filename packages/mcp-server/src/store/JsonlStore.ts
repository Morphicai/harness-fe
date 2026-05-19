/**
 * JsonlStore — JSONL-based persistence layer.
 *
 * Timeline writes are async-batched via WriteQueue (non-blocking).
 * Reads use a simple tail-from-end approach for recent events,
 * and full-file scan for search/filter operations.
 *
 * Directory layout:
 *   {dataDir}/{projectId}/meta.json
 *   {dataDir}/{projectId}/notes.jsonl
 *   {dataDir}/{projectId}/sessions/{sessionId}/meta.json
 *   {dataDir}/{projectId}/sessions/{sessionId}/timeline.jsonl
 *   {dataDir}/{projectId}/sessions/{sessionId}/tabs/{tabId}/timeline.jsonl
 *   {dataDir}/{projectId}/sessions/{sessionId}/tabs/{tabId}/recording.jsonl
 *   {dataDir}/{projectId}/exports/index.jsonl                       export metadata
 *   {dataDir}/{projectId}/exports/{exportId}.rrweb.json             replay events
 */

import {
    appendFileSync,
    existsSync,
    mkdirSync,
    openSync,
    readSync,
    closeSync,
    readdirSync,
    readFileSync,
    rmdirSync,
    statSync,
    unlinkSync,
    writeFileSync,
} from 'node:fs';
import { WriteQueue } from './WriteQueue.js';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import type {
    BuildMeta,
    IStore,
    LoadMeta,
    ProjectMeta,
    ProjectTreeNode,
    PurgeResult,
    RecordingChunk,
    RecordingChunkSummary,
    ReplayExportMeta,
    RetentionPolicy,
    SearchOptions,
    SessionMeta,
    SessionSummary,
    StoreEvent,
    TabMeta,
    TailOptions,
} from './types.js';

const DEFAULT_DATA_DIR = join(homedir(), '.harnessa', 'data');
const DEFAULT_RETENTION: Required<RetentionPolicy> = {
    maxAgeDays: 7,
    maxSessionsPerProject: 20,
    recordingRetentionDays: 3,
    maxRecordingChunksPerTab: 500,
    maxRecordingBytesPerTab: 250 * 1024 * 1024,
    preserveMarkedChunks: true,
    maxExportsPerProject: 50,
    maxExportBytesPerProject: 200 * 1024 * 1024,
    maxBuildsPerProject: 100,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ensureDir(dir: string): void {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function writeJson(path: string, data: unknown): void {
    writeFileSync(path, JSON.stringify(data, null, 2), 'utf-8');
}

function readJson<T>(path: string): T | undefined {
    try {
        return JSON.parse(readFileSync(path, 'utf-8')) as T;
    } catch {
        return undefined;
    }
}

function appendJsonl(path: string, obj: unknown): void {
    appendFileSync(path, JSON.stringify(obj) + '\n', 'utf-8');
}

/**
 * Read the last N lines from a file efficiently.
 * Reads from the end in chunks to avoid loading the whole file.
 */
function readLastNLines(filePath: string, n: number): string[] {
    if (!existsSync(filePath)) return [];
    const CHUNK = 16 * 1024; // 16KB chunks
    const { size } = statSync(filePath);
    if (size === 0) return [];

    // For small files just read everything
    if (size <= CHUNK * 2) {
        const content = readFileSync(filePath, 'utf-8');
        const lines = content.split('\n').filter((l) => l.trim());
        return lines.slice(-n);
    }

    // Read from end in chunks until we have enough lines
    const fd = openSync(filePath, 'r');
    try {
        let pos = size;
        let collected = '';
        let lines: string[] = [];

        while (pos > 0 && lines.length < n + 1) {
            const readSize = Math.min(CHUNK, pos);
            pos -= readSize;
            const buf = Buffer.alloc(readSize);
            readSync(fd, buf, 0, readSize, pos);
            collected = buf.toString('utf-8') + collected;
            lines = collected.split('\n').filter((l) => l.trim());
        }

        return lines.slice(-n);
    } finally {
        closeSync(fd);
    }
}

function readAllLines(filePath: string): string[] {
    if (!existsSync(filePath)) return [];
    return readFileSync(filePath, 'utf-8')
        .split('\n')
        .filter((l) => l.trim());
}

function parseEvent(line: string): StoreEvent | undefined {
    try {
        return JSON.parse(line) as StoreEvent;
    } catch {
        return undefined;
    }
}

function parseJsonLine<T>(line: string): T | undefined {
    try {
        return JSON.parse(line) as T;
    } catch {
        return undefined;
    }
}

interface RecordingChunkRecord extends RecordingChunk {
    line: string;
    bytes: number;
    marked: boolean;
    ageTs: number;
}

function parseRecordingChunkLine(
    line: string,
    tabId: string,
    fallbackAgeTs: number,
    index: number,
): RecordingChunkRecord | undefined {
    const parsed = parseJsonLine<Record<string, unknown>>(line);
    if (!parsed || !Array.isArray(parsed.events)) return undefined;

    const chunkId =
        typeof parsed.chunkId === 'string'
            ? parsed.chunkId
            : `legacy_${index.toString().padStart(6, '0')}`;
    const startTs =
        typeof parsed.startTs === 'number'
            ? parsed.startTs
            : typeof parsed.ts === 'number'
              ? parsed.ts
              : undefined;
    const endTs =
        typeof parsed.endTs === 'number'
            ? parsed.endTs
            : typeof parsed.ts === 'number'
              ? parsed.ts
              : undefined;
    if (startTs === undefined || endTs === undefined) return undefined;

    return {
        chunkId,
        tabId,
        startTs,
        endTs,
        eventCount:
            typeof parsed.eventCount === 'number'
                ? parsed.eventCount
                : parsed.events.length,
        events: parsed.events,
        line,
        bytes: Buffer.byteLength(`${line}\n`, 'utf-8'),
        marked: false,
        ageTs:
            typeof parsed.endTs === 'number'
                ? parsed.endTs
                : fallbackAgeTs,
    };
}

/**
 * Reject meta upserts that would write more than this many bytes of
 * open-ended user data (`tags` + `metadata`). Protects against agents or
 * misconfigured plugins inflating meta.json files to MBs.
 */
const META_EXTENSION_LIMIT_BYTES = 16 * 1024;

function enforceExtensionBudget(meta: { tags?: unknown; metadata?: unknown }, label: string): void {
    const open = JSON.stringify({ tags: meta.tags, metadata: meta.metadata });
    const size = Buffer.byteLength(open, 'utf-8');
    if (size > META_EXTENSION_LIMIT_BYTES) {
        throw new Error(
            `[harnessa-fe] refused to write ${label}: tags+metadata payload is ${size} bytes (limit ${META_EXTENSION_LIMIT_BYTES}).`,
        );
    }
}

function matchesType(event: StoreEvent, type: string | string[] | undefined): boolean {
    if (!type) return true;
    if (Array.isArray(type)) return type.includes(event.t);
    return event.t === type;
}

function matchesTimeRange(event: StoreEvent, since?: number, until?: number): boolean {
    if (since !== undefined && event.ts < since) return false;
    if (until !== undefined && event.ts > until) return false;
    return true;
}

/**
 * Enforce the `tab ⇒ load` invariant: every tab-scoped event must carry a
 * loadId so it can be attributed to a specific page load. Session-scoped
 * events (no tab, e.g. build-plugin hmr / node:log) MUST NOT carry one.
 */
function validateLoadInvariant(event: StoreEvent, tabId: string | undefined): void {
    const hasTab = !!(tabId ?? event.tab);
    if (hasTab && !event.load) {
        throw new Error(
            `JsonlStore.append: tab-scoped event "${event.t}" missing required load field`,
        );
    }
    if (!hasTab && event.load) {
        throw new Error(
            `JsonlStore.append: session-scoped event "${event.t}" must not carry a load field`,
        );
    }
}

function dirSize(dir: string): number {
    if (!existsSync(dir)) return 0;
    let total = 0;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) total += dirSize(full);
        else total += statSync(full).size;
    }
    return total;
}

function rmrf(dir: string): void {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) rmrf(full);
        else unlinkSync(full);
    }
    rmdirSync(dir);
}

// ─── JsonlStore ───────────────────────────────────────────────────────────────

export class JsonlStore implements IStore {
    private readonly dataDir: string;
    private readonly writeQueue = new WriteQueue();

    constructor(dataDir?: string) {
        const serverStartTimestamp = Date.now();
        this.dataDir = resolve(dataDir ?? DEFAULT_DATA_DIR);
        ensureDir(this.dataDir);

        // Startup recovery: rebuild sessionIndex from disk and mark orphaned sessions
        this._recoverSessions(serverStartTimestamp);
    }

    /**
     * Scan all project directories and their sessions on disk.
     * Rebuilds the in-memory sessionIndex and marks any session that lacks
     * `endedAt` as orphaned (crashed) by setting endedAt = serverStartTimestamp.
     */
    private _recoverSessions(serverStartTimestamp: number): void {
        if (!existsSync(this.dataDir)) return;

        let projectEntries: import('node:fs').Dirent[];
        try {
            projectEntries = readdirSync(this.dataDir, { withFileTypes: true }) as import('node:fs').Dirent[];
        } catch {
            return;
        }

        for (const projEntry of projectEntries) {
            if (!projEntry.isDirectory()) continue;
            const sessionsDir = join(this.dataDir, String(projEntry.name), 'sessions');
            if (!existsSync(sessionsDir)) continue;

            let sessionEntries: import('node:fs').Dirent[];
            try {
                sessionEntries = readdirSync(sessionsDir, { withFileTypes: true }) as import('node:fs').Dirent[];
            } catch {
                continue;
            }

            for (const sessEntry of sessionEntries) {
                if (!sessEntry.isDirectory()) continue;
                const metaPath = join(sessionsDir, String(sessEntry.name), 'meta.json');
                const meta = readJson<SessionMeta>(metaPath);
                if (!meta || !meta.id || !meta.projectId) continue;

                // Rebuild the in-memory index
                this.sessionIndex.set(meta.id, meta.projectId);

                // Mark orphaned sessions (no endedAt = crashed/unclean shutdown)
                if (meta.endedAt === undefined) {
                    meta.endedAt = serverStartTimestamp;
                    try {
                        writeJson(metaPath, meta);
                    } catch (err) {
                        console.error(
                            `[JsonlStore] startup recovery: failed to write endedAt for session ${meta.id}:`,
                            err,
                        );
                    }
                }
            }
        }
    }

    // ── Path helpers ──────────────────────────────────────────────────────

    private projectDir(projectId: string): string {
        return join(this.dataDir, sanitizeId(projectId));
    }

    private sessionDir(projectId: string, sessionId: string): string {
        return join(this.projectDir(projectId), 'sessions', sessionId);
    }

    private tabDir(projectId: string, sessionId: string, tabId: string): string {
        return join(this.sessionDir(projectId, sessionId), 'tabs', sanitizeId(tabId));
    }

    private sessionTimeline(projectId: string, sessionId: string): string {
        return join(this.sessionDir(projectId, sessionId), 'timeline.jsonl');
    }

    private tabTimeline(projectId: string, sessionId: string, tabId: string): string {
        return join(this.tabDir(projectId, sessionId, tabId), 'timeline.jsonl');
    }

    private tabRecording(projectId: string, sessionId: string, tabId: string): string {
        return join(this.tabDir(projectId, sessionId, tabId), 'recording.jsonl');
    }

    private tabLoadsFile(projectId: string, sessionId: string, tabId: string): string {
        return join(this.tabDir(projectId, sessionId, tabId), 'loads.jsonl');
    }

    private exportDir(projectId: string): string {
        return join(this.projectDir(projectId), 'exports');
    }

    private exportIndex(projectId: string): string {
        return join(this.exportDir(projectId), 'index.jsonl');
    }

    private exportEventsPath(projectId: string, exportId: string): string {
        return join(this.exportDir(projectId), `${sanitizeId(exportId)}.rrweb.json`);
    }

    /** Reverse lookup: exportId → projectId. Built lazily, scans project dirs. */
    private findExportProject(exportId: string): string | undefined {
        for (const proj of this.listProjects()) {
            const indexPath = this.exportIndex(proj.id);
            if (!existsSync(indexPath)) continue;
            for (const line of readAllLines(indexPath)) {
                try {
                    const meta = JSON.parse(line) as ReplayExportMeta;
                    if (meta?.exportId === exportId) return proj.id;
                } catch {
                    /* swallow malformed line */
                }
            }
        }
        return undefined;
    }

    // ── Session lookup (sessionId → projectId) ────────────────────────────

    private sessionIndex = new Map<string, string>(); // sessionId → projectId

    private resolveProject(sessionId: string): string | undefined {
        return this.sessionIndex.get(sessionId);
    }

    // ── Session lifecycle ─────────────────────────────────────────────────

    openSession(
        projectId: string,
        meta: Omit<SessionMeta, 'id' | 'projectId' | 'startedAt'>,
    ): string {
        const sessionId = randomUUID().slice(0, 8);
        const projDir = this.projectDir(projectId);
        ensureDir(projDir);

        // Upsert project meta (preserve previously written fields like
        // parentProjectId / displayName / tags — only touch lifecycle stamps).
        const projMetaPath = join(projDir, 'meta.json');
        const existing = readJson<ProjectMeta>(projMetaPath);
        const projMeta: ProjectMeta = {
            ...existing,
            id: projectId,
            createdAt: existing?.createdAt ?? Date.now(),
            lastActiveAt: Date.now(),
        };
        writeJson(projMetaPath, projMeta);

        // Create session directory + meta
        const sessDir = this.sessionDir(projectId, sessionId);
        ensureDir(sessDir);
        const sessMeta: SessionMeta = {
            id: sessionId,
            projectId,
            startedAt: Date.now(),
            ...meta,
        };
        writeJson(join(sessDir, 'meta.json'), sessMeta);

        this.sessionIndex.set(sessionId, projectId);
        return sessionId;
    }

    closeSession(sessionId: string, closedAt?: number): void {
        const projectId = this.resolveProject(sessionId);
        if (!projectId) return;
        const metaPath = join(this.sessionDir(projectId, sessionId), 'meta.json');
        const meta = readJson<SessionMeta>(metaPath);
        if (!meta) return;
        meta.endedAt = closedAt ?? Date.now();
        writeJson(metaPath, meta);
    }

    openTab(sessionId: string, tab: Omit<TabMeta, 'sessionId' | 'connectedAt'>): void {
        const projectId = this.resolveProject(sessionId);
        if (!projectId) return;
        const tabDir = this.tabDir(projectId, sessionId, tab.id);
        ensureDir(tabDir);
        const tabMeta: TabMeta = {
            ...tab,
            sessionId,
            connectedAt: Date.now(),
        };
        writeJson(join(tabDir, 'meta.json'), tabMeta);
    }

    closeTab(sessionId: string, tabId: string): void {
        const projectId = this.resolveProject(sessionId);
        if (!projectId) return;
        const metaPath = join(this.tabDir(projectId, sessionId, tabId), 'meta.json');
        const meta = readJson<TabMeta>(metaPath);
        if (!meta) return;
        meta.disconnectedAt = Date.now();
        writeJson(metaPath, meta);
    }

    openLoad(
        sessionId: string,
        tabId: string,
        meta: Omit<LoadMeta, 'tabId' | 'sessionId' | 'endedAt'>,
    ): void {
        const projectId = this.resolveProject(sessionId);
        if (!projectId) return;
        const tabDir = this.tabDir(projectId, sessionId, tabId);
        ensureDir(tabDir);
        // Close prior open load on this tab — endedAt = new load's startedAt.
        this.closeLatestLoad(sessionId, tabId, meta.startedAt);
        const row: LoadMeta = { ...meta, tabId, sessionId };
        appendJsonl(this.tabLoadsFile(projectId, sessionId, tabId), row);
    }

    closeLatestLoad(sessionId: string, tabId: string, endedAt: number = Date.now()): void {
        const projectId = this.resolveProject(sessionId);
        if (!projectId) return;
        const loadsPath = this.tabLoadsFile(projectId, sessionId, tabId);
        if (!existsSync(loadsPath)) return;
        const lines = readAllLines(loadsPath);
        if (!lines.length) return;
        // Find last row with no endedAt and rewrite the file in place.
        const rows = lines
            .map((l) => {
                try {
                    return JSON.parse(l) as LoadMeta;
                } catch {
                    return undefined;
                }
            })
            .filter((r): r is LoadMeta => !!r);
        let rewrote = false;
        for (let i = rows.length - 1; i >= 0; i--) {
            const row = rows[i];
            if (row.endedAt === undefined) {
                row.endedAt = endedAt;
                rewrote = true;
                break;
            }
        }
        if (!rewrote) return;
        writeFileSync(
            loadsPath,
            rows.map((r) => JSON.stringify(r)).join('\n') + '\n',
            'utf-8',
        );
    }

    // ── Write ─────────────────────────────────────────────────────────────

    append(sessionId: string, event: StoreEvent, tabId?: string): void {
        validateLoadInvariant(event, tabId);
        const projectId = this.resolveProject(sessionId);
        if (!projectId) return;

        // Always write to session timeline
        this.writeQueue.enqueue(
            this.sessionTimeline(projectId, sessionId),
            sessionId,
            JSON.stringify(event),
        );

        // Also write to tab timeline if tabId provided
        if (tabId) {
            const tabDir = this.tabDir(projectId, sessionId, tabId);
            ensureDir(tabDir);
            this.writeQueue.enqueue(
                this.tabTimeline(projectId, sessionId, tabId),
                sessionId,
                JSON.stringify(event),
            );
        }
    }

    appendBatch(sessionId: string, events: StoreEvent[], tabId?: string): void {
        if (!events.length) return;
        for (const event of events) validateLoadInvariant(event, tabId);
        const projectId = this.resolveProject(sessionId);
        if (!projectId) return;

        // Enqueue each event individually — WriteQueue handles batching
        for (const event of events) {
            this.writeQueue.enqueue(
                this.sessionTimeline(projectId, sessionId),
                sessionId,
                JSON.stringify(event),
            );
        }

        if (tabId) {
            const tabDir = this.tabDir(projectId, sessionId, tabId);
            ensureDir(tabDir);
            for (const event of events) {
                this.writeQueue.enqueue(
                    this.tabTimeline(projectId, sessionId, tabId),
                    sessionId,
                    JSON.stringify(event),
                );
            }
        }
    }

    appendRecording(sessionId: string, tabId: string, chunk: unknown): void {
        const projectId = this.resolveProject(sessionId);
        if (!projectId) return;
        const tabDir = this.tabDir(projectId, sessionId, tabId);
        ensureDir(tabDir);
        const line = Array.isArray(chunk) ? { ts: Date.now(), events: chunk } : chunk;
        // Each chunk is one line in recording.jsonl.
        // Write ONLY to recording.jsonl — NOT to session or tab timeline
        this.writeQueue.enqueue(
            this.tabRecording(projectId, sessionId, tabId),
            sessionId,
            JSON.stringify(line),
        );
    }

    writeNote(projectId: string, key: string, value: string): void {
        const projDir = this.projectDir(projectId);
        ensureDir(projDir);
        appendJsonl(join(projDir, 'notes.jsonl'), {
            ts: Date.now(),
            key,
            value,
        });
    }

    // ── Project metadata (v0.2: parent/displayName/tags) ───────────────────

    upsertProject(
        projectId: string,
        patch: Partial<Omit<ProjectMeta, 'id' | 'createdAt'>>,
    ): ProjectMeta {
        const projDir = this.projectDir(projectId);
        ensureDir(projDir);
        const metaPath = join(projDir, 'meta.json');
        const existing = readJson<ProjectMeta>(metaPath);

        // Cycle detection — refuse parent assignments that would close a loop.
        if (patch.parentProjectId !== undefined && patch.parentProjectId !== null) {
            if (patch.parentProjectId === projectId) {
                throw new Error(
                    `[harnessa-fe] refused to set parentProjectId=${projectId} on itself`,
                );
            }
            // Walk up the candidate parent's chain; if we encounter `projectId`, it's a cycle.
            const visited = new Set<string>();
            let cursor: string | undefined = patch.parentProjectId;
            while (cursor) {
                if (cursor === projectId) {
                    throw new Error(
                        `[harnessa-fe] refused to create parent-project cycle: ${projectId} → … → ${projectId}`,
                    );
                }
                if (visited.has(cursor)) break;
                visited.add(cursor);
                const ancestor: ProjectMeta | undefined = readJson<ProjectMeta>(
                    join(this.projectDir(cursor), 'meta.json'),
                ) ?? undefined;
                cursor = ancestor?.parentProjectId;
            }
        }

        const merged: ProjectMeta = {
            ...existing,
            ...patch,
            id: projectId,
            createdAt: existing?.createdAt ?? Date.now(),
            lastActiveAt: Date.now(),
        };
        // Open-ended fields (tags / metadata) accept anything the caller passes.
        // Refuse to persist if the combined extension fields would push the
        // meta.json past a safe ceiling — protects against agents stuffing
        // megabytes into project metadata.
        enforceExtensionBudget(merged, `project ${projectId}`);
        writeJson(metaPath, merged);
        return merged;
    }

    getProject(projectId: string): ProjectMeta | undefined {
        const meta = readJson<ProjectMeta>(join(this.projectDir(projectId), 'meta.json'));
        return meta ?? undefined;
    }

    // ── Build metadata (v0.2: source-code snapshot id) ─────────────────────

    upsertBuild(
        projectId: string,
        buildId: string,
        patch: Partial<Omit<BuildMeta, 'id' | 'projectId'>>,
    ): BuildMeta {
        const buildDir = join(this.projectDir(projectId), 'builds', sanitizeId(buildId));
        ensureDir(buildDir);
        const metaPath = join(buildDir, 'meta.json');
        const existing = readJson<BuildMeta>(metaPath);
        const merged: BuildMeta = {
            ...existing,
            ...patch,
            id: buildId,
            projectId,
            builtAt: existing?.builtAt ?? Date.now(),
        };
        enforceExtensionBudget(merged, `build ${projectId}/${buildId}`);
        writeJson(metaPath, merged);
        return merged;
    }

    getBuild(projectId: string, buildId: string): BuildMeta | undefined {
        const meta = readJson<BuildMeta>(
            join(this.projectDir(projectId), 'builds', sanitizeId(buildId), 'meta.json'),
        );
        return meta ?? undefined;
    }

    listBuilds(projectId: string, limit = 50): BuildMeta[] {
        const buildsDir = join(this.projectDir(projectId), 'builds');
        if (!existsSync(buildsDir)) return [];
        const builds: BuildMeta[] = [];
        for (const entry of readdirSync(buildsDir, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue;
            const meta = readJson<BuildMeta>(join(buildsDir, entry.name, 'meta.json'));
            if (meta) builds.push(meta);
        }
        return builds.sort((a, b) => b.builtAt - a.builtAt).slice(0, limit);
    }

    // ── Project tree ───────────────────────────────────────────────────────

    /**
     * Assemble the project forest from `parentProjectId` links.
     *
     * Iterative (no recursion) so a 10,000-level deep tree won't blow the
     * stack. A `visited` set additionally guards against any stale cycle
     * that slipped past upsertProject's check (e.g. from a hand-edited
     * meta.json).
     */
    getProjectTree(rootId?: string): ProjectTreeNode[] {
        const all = this.listProjects();
        const byParent = new Map<string, ProjectMeta[]>();
        for (const p of all) {
            const parent = p.parentProjectId;
            if (!parent) continue;
            const arr = byParent.get(parent) ?? [];
            arr.push(p);
            byParent.set(parent, arr);
        }
        const sortByLabel = (a: { displayName?: string; id: string }, b: { displayName?: string; id: string }) =>
            (a.displayName ?? a.id).localeCompare(b.displayName ?? b.id);

        const seedRoots = rootId
            ? all.filter((p) => p.id === rootId)
            : all.filter((p) => !p.parentProjectId);

        // Build all nodes up-front (id-keyed) so we can stitch children into
        // their parents in a second pass without recursion.
        const nodeOf = new Map<string, ProjectTreeNode>();
        const queue: ProjectMeta[] = [...seedRoots];
        const visited = new Set<string>();
        while (queue.length > 0) {
            const p = queue.shift()!;
            if (visited.has(p.id)) continue;
            visited.add(p.id);
            nodeOf.set(p.id, {
                id: p.id,
                displayName: p.displayName,
                tags: p.tags,
                children: [],
            });
            const kids = (byParent.get(p.id) ?? []).slice().sort(sortByLabel);
            for (const k of kids) queue.push(k);
        }
        // Stitch.
        for (const p of all) {
            if (!nodeOf.has(p.id) || !p.parentProjectId) continue;
            const parent = nodeOf.get(p.parentProjectId);
            const me = nodeOf.get(p.id);
            if (parent && me) parent.children.push(me);
        }
        return seedRoots
            .slice()
            .sort(sortByLabel)
            .map((p) => nodeOf.get(p.id))
            .filter((n): n is ProjectTreeNode => Boolean(n));
    }

    // ── Read ──────────────────────────────────────────────────────────────

    listProjects(): ProjectMeta[] {
        if (!existsSync(this.dataDir)) return [];
        const projects: ProjectMeta[] = [];
        for (const entry of readdirSync(this.dataDir, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue;
            const meta = readJson<ProjectMeta>(join(this.dataDir, entry.name, 'meta.json'));
            if (meta) projects.push(meta);
        }
        return projects.sort((a, b) => b.lastActiveAt - a.lastActiveAt);
    }

    listSessions(projectId: string, limit = 20): SessionMeta[] {
        const sessionsDir = join(this.projectDir(projectId), 'sessions');
        if (!existsSync(sessionsDir)) return [];
        const sessions: SessionMeta[] = [];
        for (const entry of readdirSync(sessionsDir, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue;
            const meta = readJson<SessionMeta>(
                join(sessionsDir, entry.name, 'meta.json'),
            );
            if (meta) {
                sessions.push(meta);
                // Rebuild index from disk (useful after restart)
                this.sessionIndex.set(meta.id, projectId);
            }
        }
        return sessions
            .sort((a, b) => b.startedAt - a.startedAt)
            .slice(0, limit);
    }

    getSession(sessionId: string): SessionMeta | undefined {
        const projectId = this.resolveProject(sessionId);
        if (!projectId) {
            // Try to find by scanning (after restart)
            for (const proj of this.listProjects()) {
                const sessions = this.listSessions(proj.id);
                const found = sessions.find((s) => s.id === sessionId);
                if (found) return found;
            }
            return undefined;
        }
        return readJson<SessionMeta>(
            join(this.sessionDir(projectId, sessionId), 'meta.json'),
        );
    }

    tail(sessionId: string, opts: TailOptions = {}, tabId?: string): StoreEvent[] {
        const projectId = this.resolveProject(sessionId);
        if (!projectId) return [];

        const filePath = tabId
            ? this.tabTimeline(projectId, sessionId, tabId)
            : this.sessionTimeline(projectId, sessionId);

        const n = opts.n ?? 50;
        // Read more lines than needed to account for filtering
        const multiplier = opts.type || opts.since || opts.until || opts.loadId ? 5 : 1;
        const rawLines = readLastNLines(filePath, n * multiplier);

        const events: StoreEvent[] = [];
        for (const line of rawLines) {
            const event = parseEvent(line);
            if (!event) continue;
            if (!matchesType(event, opts.type)) continue;
            if (!matchesTimeRange(event, opts.since, opts.until)) continue;
            if (opts.loadId && event.load !== opts.loadId) continue;
            events.push(event);
        }

        return events.slice(-n);
    }

    search(
        sessionId: string,
        query: string,
        opts: SearchOptions = {},
        tabId?: string,
    ): StoreEvent[] {
        const projectId = this.resolveProject(sessionId);
        if (!projectId) return [];

        const filePath = tabId
            ? this.tabTimeline(projectId, sessionId, tabId)
            : this.sessionTimeline(projectId, sessionId);

        const limit = opts.limit ?? 50;
        const lowerQuery = query.toLowerCase();
        const results: StoreEvent[] = [];

        for (const line of readAllLines(filePath)) {
            if (!line.toLowerCase().includes(lowerQuery)) continue;
            const event = parseEvent(line);
            if (!event) continue;
            if (!matchesType(event, opts.type)) continue;
            if (opts.loadId && event.load !== opts.loadId) continue;
            results.push(event);
            if (results.length >= limit) break;
        }

        return results;
    }

    listRecordings(sessionId: string, tabId?: string): RecordingChunkSummary[] {
        const projectId = this.resolveProject(sessionId);
        if (!projectId) return [];

        const tabIds = tabId ? [tabId] : this.listTabIds(projectId, sessionId);
        const chunks: RecordingChunkSummary[] = [];

        for (const currentTabId of tabIds) {
            const lines = readAllLines(this.tabRecording(projectId, sessionId, currentTabId));
            lines.forEach((line, index) => {
                const chunk = parseRecordingChunkLine(line, currentTabId, 0, index);
                if (!chunk) return;
                chunks.push({
                    chunkId: chunk.chunkId,
                    tabId: currentTabId,
                    startTs: chunk.startTs,
                    endTs: chunk.endTs,
                    eventCount: chunk.eventCount,
                });
            });
        }

        return chunks.sort((a, b) => a.startTs - b.startTs);
    }

    sliceRecordings(sessionId: string, since: number, until: number, tabId?: string): RecordingChunk[] {
        const projectId = this.resolveProject(sessionId);
        if (!projectId) return [];

        const tabIds = tabId ? [tabId] : this.listTabIds(projectId, sessionId);
        const chunks: RecordingChunk[] = [];

        for (const currentTabId of tabIds) {
            const lines = readAllLines(this.tabRecording(projectId, sessionId, currentTabId));
            lines.forEach((line, index) => {
                const chunk = parseRecordingChunkLine(line, currentTabId, 0, index);
                if (!chunk) return;
                if (chunk.endTs < since || chunk.startTs > until) return;
                chunks.push({
                    chunkId: chunk.chunkId,
                    tabId: currentTabId,
                    startTs: chunk.startTs,
                    endTs: chunk.endTs,
                    eventCount: chunk.eventCount,
                    events: chunk.events,
                });
            });
        }

        return chunks.sort((a, b) => a.startTs - b.startTs);
    }

    listLoads(sessionId: string, tabId: string): LoadMeta[] {
        const projectId = this.resolveProject(sessionId);
        if (!projectId) return [];
        const loadsPath = this.tabLoadsFile(projectId, sessionId, tabId);
        if (!existsSync(loadsPath)) return [];
        const rows: LoadMeta[] = [];
        for (const line of readAllLines(loadsPath)) {
            try {
                rows.push(JSON.parse(line) as LoadMeta);
            } catch {
                /* skip malformed */
            }
        }
        return rows.sort((a, b) => b.startedAt - a.startedAt);
    }

    getLoad(sessionId: string, tabId: string, loadId: string): LoadMeta | undefined {
        return this.listLoads(sessionId, tabId).find((r) => r.id === loadId);
    }

    sliceRecordingsByLoad(sessionId: string, tabId: string, loadId: string): RecordingChunk[] {
        const load = this.getLoad(sessionId, tabId, loadId);
        if (!load) return [];
        const until = load.endedAt ?? Date.now();
        return this.sliceRecordings(sessionId, load.startedAt, until, tabId);
    }

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
    }): ReplayExportMeta {
        const projectId = this.resolveProject(input.sessionId);
        if (!projectId) {
            throw new Error(`writeExport: unknown sessionId ${input.sessionId}`);
        }
        const exportId = `exp_${randomUUID().slice(0, 12)}`;
        const exportDir = this.exportDir(projectId);
        ensureDir(exportDir);

        const eventsPath = this.exportEventsPath(projectId, exportId);
        const payload = JSON.stringify(input.events);
        writeFileSync(eventsPath, payload, 'utf-8');

        const meta: ReplayExportMeta = {
            exportId,
            projectId,
            sessionId: input.sessionId,
            tabId: input.tabId,
            label: input.label,
            since: input.since,
            until: input.until,
            startTs: input.startTs,
            endTs: input.endTs,
            chunkCount: input.chunkCount,
            eventCount: input.events.length,
            bytes: Buffer.byteLength(payload, 'utf-8'),
            createdAt: Date.now(),
        };
        appendJsonl(this.exportIndex(projectId), meta);
        return meta;
    }

    getExport(exportId: string): ReplayExportMeta | undefined {
        const projectId = this.findExportProject(exportId);
        if (!projectId) return undefined;
        const indexPath = this.exportIndex(projectId);
        let latest: ReplayExportMeta | undefined;
        for (const line of readAllLines(indexPath)) {
            try {
                const meta = JSON.parse(line) as ReplayExportMeta;
                if (meta?.exportId === exportId) latest = meta;
            } catch {
                /* swallow */
            }
        }
        return latest;
    }

    readExportEvents(exportId: string): unknown[] | undefined {
        const projectId = this.findExportProject(exportId);
        if (!projectId) return undefined;
        const eventsPath = this.exportEventsPath(projectId, exportId);
        if (!existsSync(eventsPath)) return undefined;
        try {
            const parsed = JSON.parse(readFileSync(eventsPath, 'utf-8'));
            return Array.isArray(parsed) ? parsed : undefined;
        } catch {
            return undefined;
        }
    }

    listExports(projectId: string, limit?: number): ReplayExportMeta[] {
        const indexPath = this.exportIndex(projectId);
        if (!existsSync(indexPath)) return [];
        const metas: ReplayExportMeta[] = [];
        // Index is append-only; later lines win for duplicate exportIds (shouldn't happen, but defensive).
        const seen = new Map<string, ReplayExportMeta>();
        for (const line of readAllLines(indexPath)) {
            try {
                const meta = JSON.parse(line) as ReplayExportMeta;
                if (meta?.exportId) seen.set(meta.exportId, meta);
            } catch {
                /* swallow */
            }
        }
        for (const meta of seen.values()) metas.push(meta);
        metas.sort((a, b) => b.createdAt - a.createdAt);
        return typeof limit === 'number' ? metas.slice(0, limit) : metas;
    }

    summary(sessionId: string): SessionSummary {
        const session = this.getSession(sessionId);
        const projectId = this.resolveProject(sessionId);

        const counts: Partial<Record<string, number>> = {};
        let lastError: StoreEvent | undefined;
        let lastActivity: number | undefined;

        if (projectId) {
            const filePath = this.sessionTimeline(projectId, sessionId);
            for (const line of readAllLines(filePath)) {
                const event = parseEvent(line);
                if (!event) continue;
                counts[event.t] = (counts[event.t] ?? 0) + 1;
                if (event.t === 'err') lastError = event;
                if (!lastActivity || event.ts > lastActivity) lastActivity = event.ts;
            }
        }

        // List tabs
        const tabs: string[] = [];
        if (projectId) {
            const tabsDir = join(this.sessionDir(projectId, sessionId), 'tabs');
            if (existsSync(tabsDir)) {
                for (const entry of readdirSync(tabsDir, { withFileTypes: true })) {
                    if (entry.isDirectory()) tabs.push(entry.name);
                }
            }
        }

        return {
            session: session ?? {
                id: sessionId,
                projectId: projectId ?? 'unknown',
                peerRole: 'unknown',
                startedAt: 0,
            },
            counts,
            lastError,
            lastActivity,
            tabs,
        };
    }

    listNotes(projectId: string): Array<{ key: string; value: string; ts: number }> {
        const notesPath = join(this.projectDir(projectId), 'notes.jsonl');
        const notes: Array<{ key: string; value: string; ts: number }> = [];
        for (const line of readAllLines(notesPath)) {
            const parsed = parseEvent(line) as unknown as { key: string; value: string; ts: number } | undefined;
            if (parsed?.key) notes.push(parsed);
        }
        // Return latest value per key — iterate all and keep the last seen (highest ts)
        const latest = new Map<string, { key: string; value: string; ts: number }>();
        for (const note of notes) {
            const existing = latest.get(note.key);
            if (!existing || note.ts >= existing.ts) latest.set(note.key, note);
        }
        return [...latest.values()].sort((a, b) => b.ts - a.ts);
    }

    private listTabIds(projectId: string, sessionId: string): string[] {
        const tabsDir = join(this.sessionDir(projectId, sessionId), 'tabs');
        if (!existsSync(tabsDir)) return [];
        return readdirSync(tabsDir, { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => entry.name);
    }

    // ── Maintenance ───────────────────────────────────────────────────────

    purge(policy: RetentionPolicy = {}): PurgeResult {
        const p: Required<RetentionPolicy> = { ...DEFAULT_RETENTION, ...policy };
        const now = Date.now();
        const maxAge = p.maxAgeDays * 86400000;
        const recMaxAge = p.recordingRetentionDays * 86400000;

        let sessionsDeleted = 0;
        let recordingsDeleted = 0;
        let exportsDeleted = 0;
        let bytesFreed = 0;
        let buildsDeleted = 0;

        for (const proj of this.listProjects()) {
            const sessions = this.listSessions(proj.id, 1000);

            // Delete sessions older than maxAge
            for (const sess of sessions) {
                const age = now - sess.startedAt;
                if (age > maxAge) {
                    const dir = this.sessionDir(proj.id, sess.id);
                    const size = dirSize(dir);
                    rmrf(dir);
                    this.sessionIndex.delete(sess.id);
                    bytesFreed += size;
                    sessionsDeleted++;
                }
            }

            // Keep only the most recent N sessions
            const remaining = this.listSessions(proj.id, 1000);
            if (remaining.length > p.maxSessionsPerProject) {
                const toDelete = remaining.slice(p.maxSessionsPerProject);
                for (const sess of toDelete) {
                    const dir = this.sessionDir(proj.id, sess.id);
                    const size = dirSize(dir);
                    rmrf(dir);
                    this.sessionIndex.delete(sess.id);
                    bytesFreed += size;
                    sessionsDeleted++;
                }
            }

            // Trim recording data per tab while preserving timeline history.
            for (const sess of this.listSessions(proj.id, 1000)) {
                const tabsDir = join(this.sessionDir(proj.id, sess.id), 'tabs');
                if (!existsSync(tabsDir)) continue;
                for (const tabEntry of readdirSync(tabsDir, { withFileTypes: true })) {
                    if (!tabEntry.isDirectory()) continue;
                    const recPath = join(tabsDir, tabEntry.name, 'recording.jsonl');
                    if (!existsSync(recPath)) continue;
                    const result = this.pruneRecordingFile(
                        recPath,
                        this.tabTimeline(proj.id, sess.id, tabEntry.name),
                        now,
                        recMaxAge,
                        p,
                    );
                    bytesFreed += result.bytesFreed;
                    recordingsDeleted += result.chunksDeleted;
                }
            }

            // Trim exports per project: enforce count + byte ceilings (oldest first).
            const exportResult = this.pruneExportsForProject(
                proj.id,
                p.maxExportsPerProject,
                p.maxExportBytesPerProject,
            );
            exportsDeleted += exportResult.exportsDeleted;
            bytesFreed += exportResult.bytesFreed;

            // Trim BuildMeta directories per project. listBuilds returns newest
            // first by builtAt; anything past `maxBuildsPerProject` is pruned.
            const allBuilds = this.listBuilds(proj.id, Number.MAX_SAFE_INTEGER);
            if (allBuilds.length > p.maxBuildsPerProject) {
                const stale = allBuilds.slice(p.maxBuildsPerProject);
                for (const b of stale) {
                    const dir = join(this.projectDir(proj.id), 'builds', sanitizeId(b.id));
                    const size = dirSize(dir);
                    rmrf(dir);
                    bytesFreed += size;
                    buildsDeleted++;
                }
            }
        }

        return { sessionsDeleted, recordingsDeleted, exportsDeleted, bytesFreed, buildsDeleted };
    }

    private pruneExportsForProject(
        projectId: string,
        maxExports: number,
        maxBytes: number,
    ): { exportsDeleted: number; bytesFreed: number } {
        const exports = this.listExports(projectId); // newest first
        if (exports.length === 0) return { exportsDeleted: 0, bytesFreed: 0 };

        const keep: ReplayExportMeta[] = [];
        const drop: ReplayExportMeta[] = [];
        let runningBytes = 0;
        for (const meta of exports) {
            const fits = keep.length < maxExports && runningBytes + meta.bytes <= maxBytes;
            if (fits) {
                keep.push(meta);
                runningBytes += meta.bytes;
            } else {
                drop.push(meta);
            }
        }
        if (drop.length === 0) return { exportsDeleted: 0, bytesFreed: 0 };

        let bytesFreed = 0;
        for (const meta of drop) {
            const eventsPath = this.exportEventsPath(projectId, meta.exportId);
            if (existsSync(eventsPath)) {
                const size = statSync(eventsPath).size;
                try {
                    unlinkSync(eventsPath);
                    bytesFreed += size;
                } catch {
                    /* swallow */
                }
            }
        }

        // Rewrite index keeping only surviving entries.
        const indexPath = this.exportIndex(projectId);
        if (keep.length === 0) {
            try { unlinkSync(indexPath); } catch { /* swallow */ }
        } else {
            // Preserve original insertion order (oldest first) so future appends still work naturally.
            keep.sort((a, b) => a.createdAt - b.createdAt);
            const body = keep.map((m) => JSON.stringify(m)).join('\n') + '\n';
            writeFileSync(indexPath, body, 'utf-8');
        }

        return { exportsDeleted: drop.length, bytesFreed };
    }

    /**
     * Flush all pending Write_Queue entries to disk.
     * Call this in tests before reading back events via tail()/search().
     */
    async flush(): Promise<void> {
        await this.writeQueue.drain();
    }

    async close(): Promise<void> {
        // Drain the Write_Queue to ensure all pending events are flushed to disk
        try {
            await this.writeQueue.drain();
        } catch (err) {
            console.error('[JsonlStore] close: drain failed:', err);
        }
    }

    private pruneRecordingFile(
        recPath: string,
        tabTimelinePath: string,
        now: number,
        recMaxAge: number,
        policy: Required<RetentionPolicy>,
    ): { chunksDeleted: number; bytesFreed: number } {
        const lines = readAllLines(recPath);
        if (lines.length === 0) return { chunksDeleted: 0, bytesFreed: 0 };
        const fallbackAgeTs = statSync(recPath).mtimeMs;

        const markerTimestamps = this.readMarkerTimestamps(tabTimelinePath);
        const chunks: RecordingChunkRecord[] = [];

        lines.forEach((line, index) => {
            const chunk = parseRecordingChunkLine(line, '', fallbackAgeTs, index);
            if (!chunk) return;
            chunk.marked = markerTimestamps.some((ts) => ts >= chunk.startTs && ts <= chunk.endTs);
            chunks.push(chunk);
        });

        if (chunks.length === 0) return { chunksDeleted: 0, bytesFreed: 0 };

        const removed = new Set<string>();

        for (const chunk of chunks) {
            if (now - chunk.ageTs > recMaxAge) removed.add(chunk.chunkId);
        }

        let kept = chunks.filter((chunk) => !removed.has(chunk.chunkId));

        const chooseRemovalCandidate = (): RecordingChunkRecord | undefined => {
            if (kept.length === 0) return undefined;
            const sorted = [...kept].sort((a, b) => a.startTs - b.startTs);
            if (!policy.preserveMarkedChunks) return sorted[0];
            return sorted.find((chunk) => !chunk.marked) ?? sorted[0];
        };

        while (kept.length > policy.maxRecordingChunksPerTab) {
            const candidate = chooseRemovalCandidate();
            if (!candidate) break;
            removed.add(candidate.chunkId);
            kept = kept.filter((chunk) => chunk.chunkId !== candidate.chunkId);
        }

        let totalBytes = kept.reduce((sum, chunk) => sum + chunk.bytes, 0);
        while (totalBytes > policy.maxRecordingBytesPerTab) {
            const candidate = chooseRemovalCandidate();
            if (!candidate) break;
            removed.add(candidate.chunkId);
            kept = kept.filter((chunk) => chunk.chunkId !== candidate.chunkId);
            totalBytes = kept.reduce((sum, chunk) => sum + chunk.bytes, 0);
        }

        if (removed.size === 0) return { chunksDeleted: 0, bytesFreed: 0 };

        const bytesFreed = chunks
            .filter((chunk) => removed.has(chunk.chunkId))
            .reduce((sum, chunk) => sum + chunk.bytes, 0);

        if (kept.length === 0) {
            unlinkSync(recPath);
        } else {
            writeFileSync(recPath, `${kept.map((chunk) => chunk.line).join('\n')}\n`, 'utf-8');
        }

        return { chunksDeleted: removed.size, bytesFreed };
    }

    private readMarkerTimestamps(tabTimelinePath: string): number[] {
        const timestamps: number[] = [];
        for (const line of readAllLines(tabTimelinePath)) {
            const event = parseEvent(line);
            if (!event || event.t !== 'rrweb:marker') continue;
            timestamps.push(event.ts);
        }
        return timestamps;
    }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Sanitize a string for use as a directory name. */
export function sanitizeId(id: string): string {
    return id.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 64);
}
