/**
 * JsonlStore — JSONL-based persistence layer (v0.4.0 layout).
 *
 * New layout (v0.4.0):
 *   {dataDir}/projects/{projectId}/meta.json
 *   {dataDir}/projects/{projectId}/notes.jsonl
 *   {dataDir}/projects/{projectId}/builds/{buildId}/meta.json
 *   {dataDir}/tabs/{tabId}/meta.json
 *   {dataDir}/sessions/{sessionId}/meta.json
 *   {dataDir}/sessions/{sessionId}/timeline.jsonl
 *   {dataDir}/sessions/{sessionId}/recording.jsonl
 *   {dataDir}/exports/index.jsonl
 *   {dataDir}/exports/{exportId}.rrweb.json
 *
 * Legacy layout (v0.3.x, read-only fallback):
 *   {dataDir}/{projectId}/sessions/{buildId}/tabs/{tabId}/...
 *   On startup, if legacy dirs are detected a warning is emitted pointing
 *   users to `rm -rf ~/.harness/data`.
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
import { StringDecoder } from 'node:string_decoder';
import { WriteQueue } from './WriteQueue.js';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import type {
    BuildMeta,
    IStore,
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
    VisitorMeta,
} from './types.js';
import type { VisitorEnv } from '@harness-fe/protocol';

/**
 * Append to a deduped LRU list capped at `max` entries. Pushing an existing
 * value moves it to the tail (most-recent). Used for VisitorMeta.tabIds and
 * VisitorMeta.projectIds so noisy demo sites don't grow these unboundedly.
 */
function lruAppend(existing: string[] | undefined, value: string | undefined, max: number): string[] {
    const list = existing ? [...existing] : [];
    if (!value) return list;
    const idx = list.indexOf(value);
    if (idx >= 0) list.splice(idx, 1);
    list.push(value);
    while (list.length > max) list.shift();
    return list;
}

const DEFAULT_DATA_DIR = join(homedir(), '.harness', 'data');
const DEFAULT_RETENTION = {
    maxAgeDays: 7,
    maxSessions: 200,
    // rrweb recording retention. Default 30 min (harness-fe#160): recordings are
    // a debugging aid, not an archive, and at team scale they dominate disk. ms
    // granularity (the old `recordingRetentionDays` only did whole/fractional
    // days); callers may still pass `recordingRetentionDays` and it's honored.
    // SAFETY: pruneRecordingFile is baseline-aware — it never evicts the
    // FullSnapshot that the oldest surviving chunk needs, so a short window can't
    // leave orphan increments that won't replay.
    recordingRetentionMs: 30 * 60 * 1000,
    maxRecordingChunksPerSession: 500,
    maxRecordingBytesPerSession: 250 * 1024 * 1024,
    preserveMarkedChunks: true,
    maxExportsPerProject: 50,
    maxExportBytesPerProject: 200 * 1024 * 1024,
    maxBuildsPerProject: 100,
    maxTotalBytes: 1 * 1024 * 1024 * 1024, // 1 GiB hard cap
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

function readLastNLines(filePath: string, n: number): string[] {
    if (!existsSync(filePath)) return [];
    const CHUNK = 16 * 1024;
    const { size } = statSync(filePath);
    if (size === 0) return [];

    if (size <= CHUNK * 2) {
        const content = readFileSync(filePath, 'utf-8');
        const lines = content.split('\n').filter((l) => l.trim());
        return lines.slice(-n);
    }

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

/**
 * Stream a JSONL file line-by-line, synchronously, without ever materializing
 * the whole file as a single string. `readAllLines`/`readFileSync(_, 'utf-8')`
 * throw `Cannot create a string longer than 0x1fffffe8 characters` once a file
 * passes V8's ~512 MB string cap — which a long-running rrweb `recording.jsonl`
 * can hit (harness-fe#166). Reads fixed-size buffers and emits one trimmed,
 * non-empty line at a time; peak memory is one chunk + one line, never the file.
 * `index` counts emitted (non-empty) lines, matching `readAllLines(...).forEach`.
 */
function forEachLineSync(filePath: string, onLine: (line: string, index: number) => void): void {
    if (!existsSync(filePath)) return;
    const CHUNK = 1024 * 1024;
    const fd = openSync(filePath, 'r');
    const decoder = new StringDecoder('utf8');
    const buf = Buffer.allocUnsafe(CHUNK);
    let pending = '';
    let index = 0;
    try {
        let bytesRead: number;
        while ((bytesRead = readSync(fd, buf, 0, CHUNK, null)) > 0) {
            pending += decoder.write(buf.subarray(0, bytesRead));
            let nl = pending.indexOf('\n');
            while (nl !== -1) {
                const line = pending.slice(0, nl);
                pending = pending.slice(nl + 1);
                if (line.trim()) onLine(line, index++);
                nl = pending.indexOf('\n');
            }
        }
        pending += decoder.end();
        if (pending.trim()) onLine(pending, index++);
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
    /**
     * Set during pruning so the baseline-rescue check doesn't need the parsed
     * `events` retained in memory (they're dropped after this is computed —
     * keeping every chunk's events for a multi-hundred-MB file would risk OOM).
     */
    hasFullSnapshot?: boolean;
}

/**
 * Whether a recording chunk carries an rrweb FullSnapshot (type:2) — the
 * baseline a replay must roll forward from. Used by retention pruning to avoid
 * evicting the baseline the surviving increments depend on (harness-fe#160).
 */
function chunkContainsFullSnapshot(chunk: { events: unknown[] }): boolean {
    return chunk.events.some(
        (ev) => typeof ev === 'object' && ev !== null && (ev as { type?: unknown }).type === 2,
    );
}

function parseRecordingChunkLine(
    line: string,
    tabId: string,
    fallbackAgeTs: number,
    index: number,
): RecordingChunkRecord | undefined {
    const parsed = parseJsonLine<Record<string, unknown>>(line);
    if (!parsed || !Array.isArray(parsed.events)) return undefined;

    if (typeof parsed.chunkId !== 'string') {
        process.stderr.write(
            `[harness-fe] recording chunk at index ${index} is missing chunkId — skipping (pre-0.4 data). ` +
            `Run \`rm -rf ~/.harness/data\` to clear legacy data.\n`,
        );
        return undefined;
    }
    const chunkId = parsed.chunkId;
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

const META_EXTENSION_LIMIT_BYTES = 16 * 1024;
const MAX_EVENT_BYTES = 256 * 1024;
const MAX_RECORDING_CHUNK_BYTES = 2 * 1024 * 1024;
// Hard ceiling on a single session's recording.jsonl, enforced at append time.
// `maxRecordingBytesPerSession` only bounds it during purge, which is too late:
// a runaway recording can blow past V8's ~512 MB string cap, after which the
// file can no longer even be read or pruned (harness-fe#166). 384 MB leaves
// generous headroom under the 512 MB cap; once reached, new chunks are dropped.
const MAX_RECORDING_FILE_BYTES = 384 * 1024 * 1024;

function enforceExtensionBudget(meta: { tags?: unknown; metadata?: unknown }, label: string): void {
    const open = JSON.stringify({ tags: meta.tags, metadata: meta.metadata });
    const size = Buffer.byteLength(open, 'utf-8');
    if (size > META_EXTENSION_LIMIT_BYTES) {
        throw new Error(
            `[harness-fe] refused to write ${label}: tags+metadata payload is ${size} bytes (limit ${META_EXTENSION_LIMIT_BYTES}).`,
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

    /**
     * In-memory index: sessionId → SessionMeta (rebuilt on startup, kept in sync).
     * Enables O(1) session lookup without disk reads.
     */
    private sessionIndex = new Map<string, SessionMeta>();

    /** Sessions already warned about exceeding the recording file ceiling (warn once). */
    private readonly oversizedRecordingWarned = new Set<string>();

    /**
     * In-memory index: buildId → projectId (from openBuild / upsertBuild).
     * Enables resolving project from buildId for legacy bridge compat.
     */
    private buildIndex = new Map<string, string>(); // buildId → projectId

    constructor(dataDir?: string) {
        const serverStartTimestamp = Date.now();
        this.dataDir = resolve(dataDir ?? DEFAULT_DATA_DIR);
        ensureDir(this.dataDir);
        this._rebuildIndexes(serverStartTimestamp);
    }

    /** Scan disk to rebuild in-memory indexes. Mark orphaned sessions (no endedAt). */
    private _rebuildIndexes(serverStartTimestamp: number): void {
        const sessionsDir = join(this.dataDir, 'sessions');
        if (!existsSync(sessionsDir)) return;

        let entries: import('node:fs').Dirent[];
        try {
            entries = readdirSync(sessionsDir, { withFileTypes: true }) as import('node:fs').Dirent[];
        } catch {
            return;
        }

        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const metaPath = join(sessionsDir, String(entry.name), 'meta.json');
            const meta = readJson<SessionMeta>(metaPath);
            if (!meta || !meta.id) continue;

            // Mark orphaned sessions (crashed daemons)
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

            this.sessionIndex.set(meta.id, meta);
        }

        // Rebuild buildIndex from projects/*/builds/*/meta.json
        const projectsDir = join(this.dataDir, 'projects');
        if (!existsSync(projectsDir)) return;
        try {
            for (const projEntry of readdirSync(projectsDir, { withFileTypes: true })) {
                if (!projEntry.isDirectory()) continue;
                const buildsDir = join(projectsDir, String(projEntry.name), 'builds');
                if (!existsSync(buildsDir)) continue;
                for (const buildEntry of readdirSync(buildsDir, { withFileTypes: true })) {
                    if (!buildEntry.isDirectory()) continue;
                    const buildMeta = readJson<BuildMeta>(join(buildsDir, String(buildEntry.name), 'meta.json'));
                    if (buildMeta?.id) {
                        this.buildIndex.set(buildMeta.id, String(projEntry.name));
                    }
                }
            }
        } catch {
            // ignore
        }
    }

    // ── Path helpers ──────────────────────────────────────────────────────

    private projectsDir(): string {
        return join(this.dataDir, 'projects');
    }

    private projectDir(projectId: string): string {
        return join(this.projectsDir(), sanitizeId(projectId));
    }

    private buildDir(projectId: string, buildId: string): string {
        return join(this.projectDir(projectId), 'builds', sanitizeId(buildId));
    }

    private visitorsDir(): string {
        return join(this.dataDir, 'visitors');
    }

    private visitorDir(visitorId: string): string {
        return join(this.visitorsDir(), sanitizeId(visitorId));
    }

    private tabsDir(): string {
        return join(this.dataDir, 'tabs');
    }

    private tabDir(tabId: string): string {
        return join(this.tabsDir(), sanitizeId(tabId));
    }

    private sessionsDir(): string {
        return join(this.dataDir, 'sessions');
    }

    private sessionDir(sessionId: string): string {
        return join(this.sessionsDir(), sanitizeId(sessionId));
    }

    private sessionTimeline(sessionId: string): string {
        return join(this.sessionDir(sessionId), 'timeline.jsonl');
    }

    private sessionRecording(sessionId: string): string {
        return join(this.sessionDir(sessionId), 'recording.jsonl');
    }

    private exportsDir(): string {
        return join(this.dataDir, 'exports');
    }

    private exportIndex(): string {
        return join(this.exportsDir(), 'index.jsonl');
    }

    private exportEventsPath(exportId: string): string {
        return join(this.exportsDir(), `${sanitizeId(exportId)}.rrweb.json`);
    }

    // ── Build lifecycle ───────────────────────────────────────────────────

    openBuild(projectId: string, patch: Partial<Omit<BuildMeta, 'id' | 'projectId' | 'builtAt'>> = {}): string {
        const buildId = randomUUID().slice(0, 8);
        this.upsertBuild(projectId, buildId, patch);
        // Also ensure project meta exists
        const projMetaPath = join(this.projectDir(projectId), 'meta.json');
        if (!existsSync(projMetaPath)) {
            this.upsertProject(projectId, {});
        } else {
            // Touch lastActiveAt
            const existing = readJson<ProjectMeta>(projMetaPath);
            if (existing) {
                existing.lastActiveAt = Date.now();
                writeJson(projMetaPath, existing);
            }
        }
        return buildId;
    }

    closeBuild(buildId: string, closedAt?: number): void {
        const projectId = this.buildIndex.get(buildId);
        if (!projectId) return;
        const metaPath = join(this.buildDir(projectId, buildId), 'meta.json');
        const meta = readJson<BuildMeta>(metaPath);
        if (!meta) return;
        meta.endedAt = closedAt ?? Date.now();
        writeJson(metaPath, meta);
    }

    // ── Tab lifecycle ─────────────────────────────────────────────────────

    upsertTab(tabId: string, patch: Partial<Omit<TabMeta, 'id'>>): TabMeta {
        const dir = this.tabDir(tabId);
        ensureDir(dir);
        const metaPath = join(dir, 'meta.json');
        const existing = readJson<TabMeta>(metaPath);
        const merged: TabMeta = {
            connectedAt: Date.now(),
            ...existing,
            ...patch,
            id: tabId,
        };
        writeJson(metaPath, merged);
        return merged;
    }

    getTab(tabId: string): TabMeta | undefined {
        return readJson<TabMeta>(join(this.tabDir(tabId), 'meta.json')) ?? undefined;
    }

    closeTab(tabId: string, disconnectedAt?: number): void {
        const metaPath = join(this.tabDir(tabId), 'meta.json');
        const meta = readJson<TabMeta>(metaPath);
        if (!meta) return;
        meta.disconnectedAt = disconnectedAt ?? Date.now();
        writeJson(metaPath, meta);
    }

    // ── Session lifecycle (pageload) ──────────────────────────────────────

    upsertSession(
        sessionId: string,
        meta: Partial<Omit<SessionMeta, 'id'>> & { tabId: string; startedAt: number },
    ): SessionMeta {
        const dir = this.sessionDir(sessionId);
        ensureDir(dir);
        const metaPath = join(dir, 'meta.json');
        const existing = readJson<SessionMeta>(metaPath);

        // Merge participants: add new ones not already in the list
        const existingParticipants = existing?.participants ?? [];
        const incomingParticipants = meta.participants ?? [];
        const merged: SessionMeta = {
            participants: [],
            ...existing,
            ...meta,
            id: sessionId,
            // Write-once: first principal to open the session owns it.
            createdBy: existing?.createdBy ?? meta.createdBy,
        };
        // Reset participants — we'll rebuild via dedup loop below
        merged.participants = [];
        // Build merged participants list
        const seen = new Set<string>();
        for (const p of existingParticipants) {
            const key = `${p.projectId}::${p.buildId ?? ''}`;
            if (!seen.has(key)) {
                seen.add(key);
                merged.participants.push(p);
            }
        }
        for (const p of incomingParticipants) {
            const key = `${p.projectId}::${p.buildId ?? ''}`;
            if (!seen.has(key)) {
                seen.add(key);
                merged.participants.push(p);
            }
        }

        writeJson(metaPath, merged);
        this.sessionIndex.set(sessionId, merged);
        return merged;
    }

    closeSession(sessionId: string, endedAt?: number): void {
        const metaPath = join(this.sessionDir(sessionId), 'meta.json');
        const meta = readJson<SessionMeta>(metaPath);
        if (!meta) return;
        meta.endedAt = endedAt ?? Date.now();
        writeJson(metaPath, meta);
        // Update in-memory index
        const cached = this.sessionIndex.get(sessionId);
        if (cached) {
            cached.endedAt = meta.endedAt;
        }
    }

    getSession(sessionId: string): SessionMeta | undefined {
        // Check in-memory index first
        const cached = this.sessionIndex.get(sessionId);
        if (cached) return cached;
        // Fall back to disk
        const meta = readJson<SessionMeta>(join(this.sessionDir(sessionId), 'meta.json'));
        if (meta) {
            this.sessionIndex.set(sessionId, meta);
        }
        return meta ?? undefined;
    }

    listSessions(opts: { tabId?: string; projectId?: string; buildId?: string; limit?: number } = {}): SessionMeta[] {
        const { tabId, projectId, buildId, limit = 50 } = opts;
        const sessionsDir = this.sessionsDir();
        if (!existsSync(sessionsDir)) return [];

        const sessions: SessionMeta[] = [];
        try {
            for (const entry of readdirSync(sessionsDir, { withFileTypes: true })) {
                if (!entry.isDirectory()) continue;
                const meta = readJson<SessionMeta>(join(sessionsDir, String(entry.name), 'meta.json'));
                if (!meta) continue;
                // Update index
                this.sessionIndex.set(meta.id, meta);
                // Apply filters
                if (tabId && meta.tabId !== tabId) continue;
                if (projectId && !meta.participants.some((p) => p.projectId === projectId)) continue;
                if (buildId && !meta.participants.some((p) => p.buildId === buildId)) continue;
                sessions.push(meta);
            }
        } catch {
            // ignore scan errors
        }

        return sessions.sort((a, b) => b.startedAt - a.startedAt).slice(0, limit);
    }

    // ── Write ─────────────────────────────────────────────────────────────

    appendEvent(sessionId: string, event: StoreEvent): void {
        if (!this.getSession(sessionId)) return;
        const line = JSON.stringify(event);
        if (Buffer.byteLength(line, 'utf-8') > MAX_EVENT_BYTES) {
            process.stderr.write(
                `[harness-fe] dropping oversized event (${Buffer.byteLength(line, 'utf-8')} bytes > ${MAX_EVENT_BYTES}) — type=${event.t}\n`,
            );
            return;
        }
        this.writeQueue.enqueue(this.sessionTimeline(sessionId), sessionId, line);
    }

    appendEventBatch(sessionId: string, events: StoreEvent[]): void {
        if (!events.length) return;
        if (!this.getSession(sessionId)) return;
        for (const event of events) {
            const line = JSON.stringify(event);
            if (Buffer.byteLength(line, 'utf-8') > MAX_EVENT_BYTES) {
                process.stderr.write(
                    `[harness-fe] dropping oversized event in batch (${Buffer.byteLength(line, 'utf-8')} bytes) — type=${event.t}\n`,
                );
                continue;
            }
            this.writeQueue.enqueue(this.sessionTimeline(sessionId), sessionId, line);
        }
    }

    appendRecording(sessionId: string, chunk: unknown): void {
        if (!this.getSession(sessionId)) return;
        const line = Array.isArray(chunk) ? { ts: Date.now(), events: chunk } : chunk;
        const serialized = JSON.stringify(line);
        if (Buffer.byteLength(serialized, 'utf-8') > MAX_RECORDING_CHUNK_BYTES) {
            process.stderr.write(
                `[harness-fe] dropping oversized rrweb chunk (${Buffer.byteLength(serialized, 'utf-8')} bytes > ${MAX_RECORDING_CHUNK_BYTES})\n`,
            );
            return;
        }
        const target = this.sessionRecording(sessionId);
        // Per-file ceiling: stop appending once a session's recording approaches
        // the V8 string cap, so it stays readable/prunable (harness-fe#166). The
        // on-disk size lags queued writes slightly, but the 384 MB ceiling leaves
        // ample headroom under 512 MB to absorb that.
        try {
            if (existsSync(target) && statSync(target).size > MAX_RECORDING_FILE_BYTES) {
                if (!this.oversizedRecordingWarned.has(sessionId)) {
                    this.oversizedRecordingWarned.add(sessionId);
                    process.stderr.write(
                        `[harness-fe] recording for session ${sessionId} exceeds ${MAX_RECORDING_FILE_BYTES} bytes — dropping further rrweb chunks. ` +
                        `Lower retention / baseline cadence, or purge this session.\n`,
                    );
                }
                return;
            }
        } catch {
            /* stat race / transient fs error — fall through and append */
        }
        ensureDir(this.sessionDir(sessionId));
        this.writeQueue.enqueue(target, sessionId, serialized);
    }

    writeNote(projectId: string, key: string, value: string): void {
        const projDir = this.projectDir(projectId);
        ensureDir(projDir);
        appendJsonl(join(projDir, 'notes.jsonl'), { ts: Date.now(), key, value });
    }

    // ── Project metadata ───────────────────────────────────────────────────

    upsertProject(
        projectId: string,
        patch: Partial<Omit<ProjectMeta, 'id' | 'createdAt'>>,
    ): ProjectMeta {
        const projDir = this.projectDir(projectId);
        ensureDir(projDir);
        const metaPath = join(projDir, 'meta.json');
        const existing = readJson<ProjectMeta>(metaPath);

        // Cycle detection
        if (patch.parentProjectId !== undefined && patch.parentProjectId !== null) {
            if (patch.parentProjectId === projectId) {
                throw new Error(
                    `[harness-fe] refused to set parentProjectId=${projectId} on itself`,
                );
            }
            const visited = new Set<string>();
            let cursor: string | undefined = patch.parentProjectId;
            while (cursor) {
                if (cursor === projectId) {
                    throw new Error(
                        `[harness-fe] refused to create parent-project cycle: ${projectId} → … → ${projectId}`,
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
            // Write-once: the first principal to create the project owns it.
            createdBy: existing?.createdBy ?? patch.createdBy,
        };
        enforceExtensionBudget(merged, `project ${projectId}`);
        writeJson(metaPath, merged);
        return merged;
    }

    getProject(projectId: string): ProjectMeta | undefined {
        return readJson<ProjectMeta>(join(this.projectDir(projectId), 'meta.json')) ?? undefined;
    }

    listProjects(): ProjectMeta[] {
        const projectsDir = this.projectsDir();
        if (!existsSync(projectsDir)) return [];
        const projects: ProjectMeta[] = [];
        try {
            for (const entry of readdirSync(projectsDir, { withFileTypes: true })) {
                if (!entry.isDirectory()) continue;
                const meta = readJson<ProjectMeta>(join(projectsDir, String(entry.name), 'meta.json'));
                if (meta) projects.push(meta);
            }
        } catch {
            // ignore
        }
        return projects.sort((a, b) => b.lastActiveAt - a.lastActiveAt);
    }

    // ── Visitor metadata (0.5+) ─────────────────────────────────────────────

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
    ): VisitorMeta {
        const dir = this.visitorDir(visitorId);
        ensureDir(dir);
        const metaPath = join(dir, 'meta.json');
        const existing = readJson<VisitorMeta>(metaPath);
        const now = patch.seenAt ?? Date.now();

        const tabIds = lruAppend(existing?.tabIds, patch.addTabId, 50);
        const projectIds = lruAppend(existing?.projectIds, patch.addProjectId, 50);

        const merged: VisitorMeta = {
            id: visitorId,
            // userId: prefer fresh non-empty value; otherwise preserve existing
            userId: patch.userId && patch.userId.length > 0 ? patch.userId : existing?.userId,
            firstSeenAt: existing?.firstSeenAt ?? now,
            lastSeenAt: now,
            sessionCount: (existing?.sessionCount ?? 0) + (patch.incrementSession ? 1 : 0),
            tabIds,
            projectIds,
            lastEnv: patch.lastEnv ?? existing?.lastEnv,
        };
        writeJson(metaPath, merged);
        return merged;
    }

    getVisitor(visitorId: string): VisitorMeta | undefined {
        return readJson<VisitorMeta>(join(this.visitorDir(visitorId), 'meta.json')) ?? undefined;
    }

    listVisitors(opts: { projectId?: string; limit?: number } = {}): VisitorMeta[] {
        const dir = this.visitorsDir();
        if (!existsSync(dir)) return [];
        const out: VisitorMeta[] = [];
        try {
            for (const entry of readdirSync(dir, { withFileTypes: true })) {
                if (!entry.isDirectory()) continue;
                const meta = readJson<VisitorMeta>(join(dir, String(entry.name), 'meta.json'));
                if (!meta) continue;
                if (opts.projectId && !meta.projectIds.includes(opts.projectId)) continue;
                out.push(meta);
            }
        } catch {
            // ignore
        }
        out.sort((a, b) => b.lastSeenAt - a.lastSeenAt);
        return opts.limit ? out.slice(0, opts.limit) : out;
    }

    // ── Build metadata ─────────────────────────────────────────────────────

    upsertBuild(
        projectId: string,
        buildId: string,
        patch: Partial<Omit<BuildMeta, 'id' | 'projectId'>>,
    ): BuildMeta {
        const dir = this.buildDir(projectId, buildId);
        ensureDir(dir);
        const metaPath = join(dir, 'meta.json');
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
        this.buildIndex.set(buildId, projectId);
        return merged;
    }

    getBuild(projectId: string, buildId: string): BuildMeta | undefined {
        return readJson<BuildMeta>(join(this.buildDir(projectId, buildId), 'meta.json')) ?? undefined;
    }

    listBuilds(projectId: string, limit = 50): BuildMeta[] {
        const buildsDir = join(this.projectDir(projectId), 'builds');
        if (!existsSync(buildsDir)) return [];
        const builds: BuildMeta[] = [];
        try {
            for (const entry of readdirSync(buildsDir, { withFileTypes: true })) {
                if (!entry.isDirectory()) continue;
                const meta = readJson<BuildMeta>(join(buildsDir, String(entry.name), 'meta.json'));
                if (meta) builds.push(meta);
            }
        } catch {
            // ignore
        }
        return builds.sort((a, b) => b.builtAt - a.builtAt).slice(0, limit);
    }

    // ── Project tree ───────────────────────────────────────────────────────

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

        const nodeOf = new Map<string, ProjectTreeNode>();
        const queue: ProjectMeta[] = [...seedRoots];
        const visited = new Set<string>();
        while (queue.length > 0) {
            const p = queue.shift()!;
            if (visited.has(p.id)) continue;
            visited.add(p.id);
            nodeOf.set(p.id, { id: p.id, displayName: p.displayName, tags: p.tags, children: [] });
            const kids = (byParent.get(p.id) ?? []).slice().sort(sortByLabel);
            for (const k of kids) queue.push(k);
        }
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

    tail(sessionId: string, opts: TailOptions = {}): StoreEvent[] {
        if (!this.getSession(sessionId)) return [];

        const filePath = this.sessionTimeline(sessionId);
        const n = opts.n ?? 50;
        const multiplier = opts.type || opts.since || opts.until || opts.projectId ? 5 : 1;
        const rawLines = readLastNLines(filePath, n * multiplier);

        const events: StoreEvent[] = [];
        for (const line of rawLines) {
            const event = parseEvent(line);
            if (!event) continue;
            if (!matchesType(event, opts.type)) continue;
            if (!matchesTimeRange(event, opts.since, opts.until)) continue;
            if (opts.projectId && event.projectId !== opts.projectId) continue;
            events.push(event);
        }

        return events.slice(-n);
    }

    search(sessionId: string, query: string, opts: SearchOptions = {}): StoreEvent[] {
        if (!this.getSession(sessionId)) return [];

        const filePath = this.sessionTimeline(sessionId);
        const limit = opts.limit ?? 50;
        const lowerQuery = query.toLowerCase();
        const results: StoreEvent[] = [];

        for (const line of readAllLines(filePath)) {
            if (!line.toLowerCase().includes(lowerQuery)) continue;
            const event = parseEvent(line);
            if (!event) continue;
            if (!matchesType(event, opts.type)) continue;
            results.push(event);
            if (results.length >= limit) break;
        }

        return results;
    }

    listRecordings(sessionId: string): RecordingChunkSummary[] {
        if (!this.getSession(sessionId)) return [];

        const recPath = this.sessionRecording(sessionId);
        const chunks: RecordingChunkSummary[] = [];
        const sessionMeta = this.getSession(sessionId);
        const tabId = sessionMeta?.tabId ?? '';

        forEachLineSync(recPath, (line, index) => {
            const chunk = parseRecordingChunkLine(line, tabId, 0, index);
            if (!chunk) return;
            chunks.push({
                chunkId: chunk.chunkId,
                tabId: chunk.tabId,
                startTs: chunk.startTs,
                endTs: chunk.endTs,
                eventCount: chunk.eventCount,
            });
        });

        return chunks.sort((a, b) => a.startTs - b.startTs);
    }

    sliceRecordings(sessionId: string, since: number, until: number): RecordingChunk[] {
        if (!this.getSession(sessionId)) return [];

        const recPath = this.sessionRecording(sessionId);
        const sessionMeta = this.getSession(sessionId);
        const tabId = sessionMeta?.tabId ?? '';
        const chunks: RecordingChunk[] = [];

        forEachLineSync(recPath, (line, index) => {
            const chunk = parseRecordingChunkLine(line, tabId, 0, index);
            if (!chunk) return;
            if (chunk.endTs < since || chunk.startTs > until) return;
            chunks.push({
                chunkId: chunk.chunkId,
                tabId: chunk.tabId,
                startTs: chunk.startTs,
                endTs: chunk.endTs,
                eventCount: chunk.eventCount,
                events: chunk.events,
            });
        });

        return chunks.sort((a, b) => a.startTs - b.startTs);
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
        // Determine projectId from session participants
        const session = this.getSession(input.sessionId);
        const projectId = session?.participants[0]?.projectId ?? 'unknown';

        const exportId = `exp_${randomUUID().slice(0, 12)}`;
        const exportDir = this.exportsDir();
        ensureDir(exportDir);

        const eventsPath = this.exportEventsPath(exportId);
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
        appendJsonl(this.exportIndex(), meta);
        return meta;
    }

    getExport(exportId: string): ReplayExportMeta | undefined {
        const indexPath = this.exportIndex();
        if (!existsSync(indexPath)) return undefined;
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
        const eventsPath = this.exportEventsPath(exportId);
        if (!existsSync(eventsPath)) return undefined;
        try {
            const parsed = JSON.parse(readFileSync(eventsPath, 'utf-8'));
            return Array.isArray(parsed) ? parsed : undefined;
        } catch {
            return undefined;
        }
    }

    listExports(projectId: string, limit?: number): ReplayExportMeta[] {
        const indexPath = this.exportIndex();
        if (!existsSync(indexPath)) return [];
        const seen = new Map<string, ReplayExportMeta>();
        for (const line of readAllLines(indexPath)) {
            try {
                const meta = JSON.parse(line) as ReplayExportMeta;
                if (meta?.exportId && (projectId === 'all' || meta.projectId === projectId)) {
                    seen.set(meta.exportId, meta);
                }
            } catch {
                /* swallow */
            }
        }
        const metas: ReplayExportMeta[] = [];
        for (const meta of seen.values()) metas.push(meta);
        metas.sort((a, b) => b.createdAt - a.createdAt);
        return typeof limit === 'number' ? metas.slice(0, limit) : metas;
    }

    summary(sessionId: string): SessionSummary {
        const session = this.getSession(sessionId);

        const counts: Partial<Record<string, number>> = {};
        let lastError: StoreEvent | undefined;
        let lastActivity: number | undefined;

        const filePath = this.sessionTimeline(sessionId);
        for (const line of readAllLines(filePath)) {
            const event = parseEvent(line);
            if (!event) continue;
            counts[event.t] = (counts[event.t] ?? 0) + 1;
            if (event.t === 'err') lastError = event;
            if (!lastActivity || event.ts > lastActivity) lastActivity = event.ts;
        }

        const tabs: string[] = session ? [session.tabId].filter(Boolean) : [];

        const fallbackSession: SessionMeta = {
            id: sessionId,
            tabId: 'unknown',
            startedAt: 0,
            participants: [],
        };

        return {
            session: session ?? fallbackSession,
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
        const latest = new Map<string, { key: string; value: string; ts: number }>();
        for (const note of notes) {
            const existing = latest.get(note.key);
            if (!existing || note.ts >= existing.ts) latest.set(note.key, note);
        }
        return [...latest.values()].sort((a, b) => b.ts - a.ts);
    }

    // ── Maintenance ───────────────────────────────────────────────────────

    purge(policy: RetentionPolicy = {}): PurgeResult {
        // Normalize aliases
        const maxSessions = policy.maxSessions ?? policy.maxSessionsPerProject ?? DEFAULT_RETENTION.maxSessions;
        const maxAgeDays = policy.maxAgeDays ?? DEFAULT_RETENTION.maxAgeDays;
        const maxChunks = policy.maxRecordingChunksPerSession ?? policy.maxRecordingChunksPerTab ?? DEFAULT_RETENTION.maxRecordingChunksPerSession;
        const maxBytes = policy.maxRecordingBytesPerSession ?? policy.maxRecordingBytesPerTab ?? DEFAULT_RETENTION.maxRecordingBytesPerSession;
        const preserveMarkedChunks = policy.preserveMarkedChunks ?? DEFAULT_RETENTION.preserveMarkedChunks;
        const maxExportsPerProject = policy.maxExportsPerProject ?? DEFAULT_RETENTION.maxExportsPerProject;
        const maxExportBytesPerProject = policy.maxExportBytesPerProject ?? DEFAULT_RETENTION.maxExportBytesPerProject;
        const maxBuildsPerProject = policy.maxBuildsPerProject ?? DEFAULT_RETENTION.maxBuildsPerProject;
        const maxTotalBytes = policy.maxTotalBytes !== undefined ? policy.maxTotalBytes : DEFAULT_RETENTION.maxTotalBytes;

        const now = Date.now();
        const maxAge = maxAgeDays * 86400000;
        // Recording retention: explicit ms wins; else fall back to the (legacy)
        // days field if the caller set it; else the ms default.
        const recMaxAge =
            policy.recordingRetentionMs ??
            (policy.recordingRetentionDays != null
                ? policy.recordingRetentionDays * 86400000
                : DEFAULT_RETENTION.recordingRetentionMs);

        let sessionsDeleted = 0;
        let recordingsDeleted = 0;
        let exportsDeleted = 0;
        let bytesFreed = 0;
        let buildsDeleted = 0;

        const sessionsDir = this.sessionsDir();
        if (existsSync(sessionsDir)) {
            const allSessions = this.listSessions({ limit: Number.MAX_SAFE_INTEGER });

            // Delete sessions older than maxAge
            for (const sess of allSessions) {
                const age = now - sess.startedAt;
                if (age > maxAge) {
                    const dir = this.sessionDir(sess.id);
                    const size = dirSize(dir);
                    rmrf(dir);
                    this.sessionIndex.delete(sess.id);
                    bytesFreed += size;
                    sessionsDeleted++;
                }
            }

            // Keep only the most recent maxSessions
            const remaining = this.listSessions({ limit: Number.MAX_SAFE_INTEGER });
            if (remaining.length > maxSessions) {
                const toDelete = remaining.slice(maxSessions);
                for (const sess of toDelete) {
                    const dir = this.sessionDir(sess.id);
                    const size = dirSize(dir);
                    rmrf(dir);
                    this.sessionIndex.delete(sess.id);
                    bytesFreed += size;
                    sessionsDeleted++;
                }
            }

            // Trim recording data per session
            for (const sess of this.listSessions({ limit: Number.MAX_SAFE_INTEGER })) {
                const recPath = this.sessionRecording(sess.id);
                if (!existsSync(recPath)) continue;
                const timelinePath = this.sessionTimeline(sess.id);
                const result = this.pruneRecordingFile(
                    recPath,
                    timelinePath,
                    now,
                    recMaxAge,
                    maxChunks,
                    maxBytes,
                    preserveMarkedChunks,
                );
                bytesFreed += result.bytesFreed;
                recordingsDeleted += result.chunksDeleted;
            }
        }

        // Trim exports
        const exportResult = this.pruneExports(maxExportsPerProject, maxExportBytesPerProject);
        exportsDeleted += exportResult.exportsDeleted;
        bytesFreed += exportResult.bytesFreed;

        // Trim builds per project
        for (const proj of this.listProjects()) {
            const allBuilds = this.listBuilds(proj.id, Number.MAX_SAFE_INTEGER);
            if (allBuilds.length > maxBuildsPerProject) {
                const stale = allBuilds.slice(maxBuildsPerProject);
                for (const b of stale) {
                    const dir = this.buildDir(proj.id, b.id);
                    const size = dirSize(dir);
                    rmrf(dir);
                    this.buildIndex.delete(b.id);
                    bytesFreed += size;
                    buildsDeleted++;
                }
            }
        }

        // Total-size cap: if data dir still exceeds maxTotalBytes after all
        // other passes, evict oldest sessions until we're under the limit.
        if (maxTotalBytes > 0) {
            const currentSize = dirSize(this.dataDir);
            if (currentSize > maxTotalBytes) {
                const remaining = this.listSessions({ limit: Number.MAX_SAFE_INTEGER });
                // oldest last → pop from end
                remaining.sort((a, b) => b.startedAt - a.startedAt);
                let runningSize = currentSize;
                while (runningSize > maxTotalBytes && remaining.length > 0) {
                    const sess = remaining.pop()!;
                    const dir = this.sessionDir(sess.id);
                    const size = dirSize(dir);
                    rmrf(dir);
                    this.sessionIndex.delete(sess.id);
                    runningSize -= size;
                    bytesFreed += size;
                    sessionsDeleted++;
                }
            }
        }

        return { sessionsDeleted, recordingsDeleted, exportsDeleted, bytesFreed, buildsDeleted };
    }

    private pruneExports(
        maxExports: number,
        maxBytes: number,
    ): { exportsDeleted: number; bytesFreed: number } {
        // Collect all exports across all projects
        const indexPath = this.exportIndex();
        if (!existsSync(indexPath)) return { exportsDeleted: 0, bytesFreed: 0 };

        // Group by project
        const byProject = new Map<string, ReplayExportMeta[]>();
        for (const line of readAllLines(indexPath)) {
            try {
                const meta = JSON.parse(line) as ReplayExportMeta;
                if (!meta?.exportId) continue;
                const arr = byProject.get(meta.projectId) ?? [];
                arr.push(meta);
                byProject.set(meta.projectId, arr);
            } catch {
                /* swallow */
            }
        }

        let totalDeleted = 0;
        let totalFreed = 0;
        const keepIds = new Set<string>();

        for (const [, exports] of byProject) {
            exports.sort((a, b) => b.createdAt - a.createdAt);
            let runningBytes = 0;
            for (const meta of exports) {
                const fits = keepIds.size < maxExports && runningBytes + meta.bytes <= maxBytes;
                if (fits) {
                    keepIds.add(meta.exportId);
                    runningBytes += meta.bytes;
                } else {
                    // Delete this export's events file
                    const eventsPath = this.exportEventsPath(meta.exportId);
                    if (existsSync(eventsPath)) {
                        const size = statSync(eventsPath).size;
                        try { unlinkSync(eventsPath); totalFreed += size; } catch { /* swallow */ }
                    }
                    totalDeleted++;
                }
            }
        }

        if (totalDeleted > 0) {
            // Rewrite index keeping only surviving entries
            const allLines = readAllLines(indexPath);
            const kept = allLines.filter((line) => {
                try {
                    const meta = JSON.parse(line) as ReplayExportMeta;
                    return keepIds.has(meta.exportId);
                } catch {
                    return false;
                }
            });
            if (kept.length === 0) {
                try { unlinkSync(indexPath); } catch { /* swallow */ }
            } else {
                writeFileSync(indexPath, kept.join('\n') + '\n', 'utf-8');
            }
        }

        return { exportsDeleted: totalDeleted, bytesFreed: totalFreed };
    }

    /**
     * Flush all pending WriteQueue entries to disk. Used in tests.
     */
    async flush(): Promise<void> {
        await this.writeQueue.drain();
    }

    async close(): Promise<void> {
        try {
            await this.writeQueue.drain();
        } catch (err) {
            console.error('[JsonlStore] close: drain failed:', err);
        }
    }

    private pruneRecordingFile(
        recPath: string,
        timelinePath: string,
        now: number,
        recMaxAge: number,
        maxChunks: number,
        maxBytesLimit: number,
        preserveMarkedChunks: boolean,
    ): { chunksDeleted: number; bytesFreed: number } {
        if (!existsSync(recPath)) return { chunksDeleted: 0, bytesFreed: 0 };
        const fallbackAgeTs = statSync(recPath).mtimeMs;

        const markerTimestamps = this.readMarkerTimestamps(timelinePath);
        const chunks: RecordingChunkRecord[] = [];

        // Stream line-by-line: a recording large enough to need pruning is exactly
        // the case that can exceed V8's string cap, so this must never read the
        // whole file as one string (harness-fe#166).
        forEachLineSync(recPath, (line, index) => {
            const chunk = parseRecordingChunkLine(line, '', fallbackAgeTs, index);
            if (!chunk) return;
            chunk.marked = markerTimestamps.some((ts) => ts >= chunk.startTs && ts <= chunk.endTs);
            // Compute the baseline flag now, then drop events — the rescue below
            // only needs the boolean, and retaining every chunk's events for a
            // very large file would risk OOM (harness-fe#166).
            chunk.hasFullSnapshot = chunkContainsFullSnapshot(chunk);
            chunk.events = [];
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
            if (!preserveMarkedChunks) return sorted[0];
            return sorted.find((chunk) => !chunk.marked) ?? sorted[0];
        };

        while (kept.length > maxChunks) {
            const candidate = chooseRemovalCandidate();
            if (!candidate) break;
            removed.add(candidate.chunkId);
            kept = kept.filter((chunk) => chunk.chunkId !== candidate.chunkId);
        }

        let totalBytes = kept.reduce((sum, chunk) => sum + chunk.bytes, 0);
        while (totalBytes > maxBytesLimit) {
            const candidate = chooseRemovalCandidate();
            if (!candidate) break;
            removed.add(candidate.chunkId);
            kept = kept.filter((chunk) => chunk.chunkId !== candidate.chunkId);
            totalBytes = kept.reduce((sum, chunk) => sum + chunk.bytes, 0);
        }

        // Baseline-aware rescue (harness-fe#160). A replay window can only be
        // assembled from a FullSnapshot (rrweb type:2) at or before it; the
        // age/size eviction above is blind to that, so dropping the baseline
        // while keeping later increments would leave the surviving tail
        // unreplayable (the very risk of a short retention window). Guarantee the
        // oldest surviving chunk is anchored: if no retained chunk at-or-before it
        // carries a FullSnapshot, pull the most-recent such baseline back out of
        // `removed`. May leave one chunk over a size/count cap — correctness wins,
        // same spirit as preserveMarkedChunks.
        if (kept.length > 0) {
            const oldestKeptTs = Math.min(...kept.map((c) => c.startTs));
            const anchored = kept.some(
                (c) => c.startTs <= oldestKeptTs && c.hasFullSnapshot,
            );
            if (!anchored) {
                const baseline = chunks
                    .filter(
                        (c) =>
                            removed.has(c.chunkId) &&
                            c.startTs <= oldestKeptTs &&
                            c.hasFullSnapshot,
                    )
                    .sort((a, b) => b.startTs - a.startTs)[0];
                if (baseline) {
                    removed.delete(baseline.chunkId);
                    kept.push(baseline);
                }
            }
        }

        if (removed.size === 0) return { chunksDeleted: 0, bytesFreed: 0 };

        const bytesFreed = chunks
            .filter((chunk) => removed.has(chunk.chunkId))
            .reduce((sum, chunk) => sum + chunk.bytes, 0);

        if (kept.length === 0) {
            unlinkSync(recPath);
        } else {
            // Persist in chronological order — the rescue can append an older
            // baseline out of order, and replay assembly expects events in time
            // order.
            const ordered = [...kept].sort((a, b) => a.startTs - b.startTs);
            writeFileSync(recPath, `${ordered.map((chunk) => chunk.line).join('\n')}\n`, 'utf-8');
        }

        return { chunksDeleted: removed.size, bytesFreed };
    }

    private readMarkerTimestamps(timelinePath: string): number[] {
        const timestamps: number[] = [];
        for (const line of readAllLines(timelinePath)) {
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
