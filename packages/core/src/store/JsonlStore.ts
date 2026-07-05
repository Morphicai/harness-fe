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
    // Per-session timeline budget (harness-fe#171): keep recent timeline chunk
    // files, drop oldest beyond these. Bounds a single session's event history
    // (the 2.3 GB timeline that wedged auto-purge can't recur).
    maxTimelineBytesPerSession: 64 * 1024 * 1024,
    maxTimelineChunksPerSession: 24,
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
 * Used for any JSONL that can grow past the cap — rrweb `recording.jsonl` and the
 * event `timeline.jsonl` (harness-fe#166 and its timeline sibling).
 *
 * The callback may return `false` to stop early (e.g. a capped search), which
 * avoids streaming a multi-GB file to the end once enough rows are collected.
 */
function forEachLineSync(
    filePath: string,
    onLine: (line: string, index: number) => void | boolean,
): void {
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
                if (line.trim() && onLine(line, index++) === false) return;
                nl = pending.indexOf('\n');
            }
        }
        pending += decoder.end();
        if (pending.trim()) onLine(pending, index++);
    } finally {
        closeSync(fd);
    }
}

/**
 * Stream every line across an ordered (oldest→newest) list of JSONL files as if
 * they were one file (chunk-file storage, harness-fe#171). `index` is global
 * across files (matches the old single-file `forEachLineSync` index). The
 * callback may return `false` to stop — early-stop spans files (e.g. a capped
 * search closes no further files once full).
 */
function forEachLineInFiles(
    files: readonly string[],
    onLine: (line: string, index: number) => void | boolean,
): void {
    let index = 0;
    for (const f of files) {
        let stopped = false;
        forEachLineSync(f, (line) => {
            if (onLine(line, index++) === false) {
                stopped = true;
                return false;
            }
        });
        if (stopped) break;
    }
}

/**
 * Last `n` lines across an ordered (oldest→newest) list of files, chronological.
 * Scans newest file backward (via {@link readLastNLines}) and walks older files
 * only if the newest don't yield `n` — so `tail` usually touches just the active
 * chunk. Returns ≤ n lines in chronological order.
 */
function lastNLinesInFiles(files: readonly string[], n: number): string[] {
    const out: string[] = [];
    for (let i = files.length - 1; i >= 0 && out.length < n; i--) {
        const lines = readLastNLines(files[i], n - out.length);
        out.unshift(...lines); // older file's lines precede what's already collected
    }
    return out;
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
// Chunk-file rotation thresholds (harness-fe#171). A stream rotates to a new
// numbered chunk file before a write that would exceed these, so no single file
// approaches V8's ~512 MB string cap — readable, slice-able, and evictable
// whole. Both are far above the per-line caps above, keeping file counts low.
const RECORDING_CHUNK_BYTES = 16 * 1024 * 1024;
const TIMELINE_CHUNK_BYTES = 8 * 1024 * 1024;

/** Per-file metadata for whole-file recording eviction (harness-fe#171). */
interface RecordingFileMeta {
    path: string;
    minTs: number;
    maxTs: number;
    bytes: number;
    chunkCount: number;
    hasFullSnapshot: boolean;
    hasMarker: boolean;
}

/** Active chunk file state for one session+stream (harness-fe#171). */
interface StreamState {
    /** Current chunk sequence number (1-based; file is `NNNNNN.jsonl`). */
    num: number;
    /** Approximate bytes already in the active chunk file. */
    bytes: number;
}

/** `1` → `000001.jsonl`. Zero-padded so lexical readdir order == chronological. */
function chunkFileName(num: number): string {
    return `${String(num).padStart(6, '0')}.jsonl`;
}

/**
 * Lazily recover the active chunk state for a stream dir on first touch in this
 * process: highest existing chunk number + its on-disk size. A fresh stream (no
 * dir, or only a legacy single file alongside) starts at chunk `000001`.
 */
function seedStreamState(dir: string): StreamState {
    try {
        const files = readdirSync(dir).filter((e) => e.endsWith('.jsonl')).sort();
        const last = files[files.length - 1];
        if (last) {
            const num = parseInt(last, 10) || 1;
            let bytes = 0;
            try {
                bytes = statSync(join(dir, last)).size;
            } catch {
                /* racing rotation/delete — treat as empty, will rotate if needed */
            }
            return { num, bytes };
        }
    } catch {
        /* dir absent — fresh stream */
    }
    return { num: 1, bytes: 0 };
}

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

    /**
     * Active chunk file per session per stream (harness-fe#171): the current
     * numbered chunk and its in-memory byte size. Seeded once per session per
     * process (lazy first-touch) from the on-disk dir, then advanced by each
     * appended line so the hot path stays off `statSync`. Rotation bumps `num`.
     */
    private readonly timelineStreams = new Map<string, StreamState>();
    private readonly recordingStreams = new Map<string, StreamState>();

    /**
     * In-memory index: buildId → projectId (from openBuild / upsertBuild).
     * Enables resolving project from buildId for legacy bridge compat.
     */
    private buildIndex = new Map<string, string>(); // buildId → projectId

    /** Chunk-file rotation thresholds (bytes). Overridable for tests. */
    private readonly recordingChunkBytes: number;
    private readonly timelineChunkBytes: number;

    constructor(dataDir?: string, opts?: { recordingChunkBytes?: number; timelineChunkBytes?: number }) {
        const serverStartTimestamp = Date.now();
        this.dataDir = resolve(dataDir ?? DEFAULT_DATA_DIR);
        this.recordingChunkBytes = opts?.recordingChunkBytes ?? RECORDING_CHUNK_BYTES;
        this.timelineChunkBytes = opts?.timelineChunkBytes ?? TIMELINE_CHUNK_BYTES;
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

    // Chunk-file storage (harness-fe#171): each stream shards into a directory of
    // numbered chunk files. The legacy single file (above) is still read as the
    // oldest "chunk 0" for backward compat; new writes go into these dirs.
    private sessionTimelineDir(sessionId: string): string {
        return join(this.sessionDir(sessionId), 'timeline');
    }

    private sessionRecordingDir(sessionId: string): string {
        return join(this.sessionDir(sessionId), 'recording');
    }

    /**
     * Ordered (oldest→newest) chunk files for a stream: the legacy single file
     * first (if it exists — it predates the chunk dir, so it's the oldest), then
     * the numbered `NNNNNN.jsonl` chunk files in lexical (== chronological) order.
     */
    private chunkFiles(legacyPath: string, dir: string): string[] {
        const files: string[] = [];
        if (existsSync(legacyPath)) files.push(legacyPath);
        try {
            for (const f of readdirSync(dir).filter((e) => e.endsWith('.jsonl')).sort()) {
                files.push(join(dir, f));
            }
        } catch {
            /* dir absent (legacy-only session, or nothing written yet) */
        }
        return files;
    }

    private timelineFiles(sessionId: string): string[] {
        return this.chunkFiles(this.sessionTimeline(sessionId), this.sessionTimelineDir(sessionId));
    }

    private recordingFiles(sessionId: string): string[] {
        return this.chunkFiles(this.sessionRecording(sessionId), this.sessionRecordingDir(sessionId));
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
        const bytes = Buffer.byteLength(line, 'utf-8');
        if (bytes > MAX_EVENT_BYTES) {
            process.stderr.write(
                `[harness-fe] dropping oversized event (${bytes} bytes > ${MAX_EVENT_BYTES}) — type=${event.t}\n`,
            );
            return;
        }
        const target = this.activeChunkPath(
            this.timelineStreams,
            this.sessionTimelineDir(sessionId),
            this.timelineChunkBytes,
            bytes,
            sessionId,
        );
        this.writeQueue.enqueue(target, sessionId, line);
    }

    appendEventBatch(sessionId: string, events: StoreEvent[]): void {
        if (!events.length) return;
        if (!this.getSession(sessionId)) return;
        for (const event of events) {
            const line = JSON.stringify(event);
            const bytes = Buffer.byteLength(line, 'utf-8');
            if (bytes > MAX_EVENT_BYTES) {
                process.stderr.write(
                    `[harness-fe] dropping oversized event in batch (${bytes} bytes) — type=${event.t}\n`,
                );
                continue;
            }
            const target = this.activeChunkPath(
                this.timelineStreams,
                this.sessionTimelineDir(sessionId),
                this.timelineChunkBytes,
                bytes,
                sessionId,
            );
            this.writeQueue.enqueue(target, sessionId, line);
        }
    }

    appendRecording(sessionId: string, chunk: unknown): void {
        if (!this.getSession(sessionId)) return;
        const line = Array.isArray(chunk) ? { ts: Date.now(), events: chunk } : chunk;
        const serialized = JSON.stringify(line);
        const bytes = Buffer.byteLength(serialized, 'utf-8');
        if (bytes > MAX_RECORDING_CHUNK_BYTES) {
            process.stderr.write(
                `[harness-fe] dropping oversized rrweb chunk (${bytes} bytes > ${MAX_RECORDING_CHUNK_BYTES})\n`,
            );
            return;
        }
        const target = this.activeChunkPath(
            this.recordingStreams,
            this.sessionRecordingDir(sessionId),
            this.recordingChunkBytes,
            bytes,
            sessionId,
        );
        this.writeQueue.enqueue(target, sessionId, serialized);
    }

    /**
     * Resolve the chunk file to append `lineBytes` to, rotating to the next
     * numbered chunk when the active one would exceed `threshold` (harness-fe#171).
     * Never splits a line — rotation is decided before the write — so a single
     * (≤2 MB) rrweb chunk always lands whole in one file. Keeps an in-memory
     * byte counter so the hot append path never `statSync`s; seeds it lazily on
     * first touch from the highest existing chunk in `dir`. Creates `dir`.
     */
    private activeChunkPath(
        streams: Map<string, StreamState>,
        dir: string,
        threshold: number,
        lineBytes: number,
        sessionId: string,
    ): string {
        let st = streams.get(sessionId);
        if (!st) {
            st = seedStreamState(dir);
            streams.set(sessionId, st);
        }
        // Rotate before writing if the active chunk is non-empty and this line
        // would push it over the threshold. An empty chunk always accepts a line.
        if (st.bytes > 0 && st.bytes + lineBytes + 1 > threshold) {
            st.num += 1;
            st.bytes = 0;
        }
        st.bytes += lineBytes + 1; // +1 for the newline
        ensureDir(dir);
        return join(dir, chunkFileName(st.num));
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

        const n = opts.n ?? 50;
        const multiplier = opts.type || opts.since || opts.until || opts.projectId ? 5 : 1;
        const rawLines = lastNLinesInFiles(this.timelineFiles(sessionId), n * multiplier);

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

        const limit = opts.limit ?? 50;
        const lowerQuery = query.toLowerCase();
        const results: StoreEvent[] = [];

        // Stream across chunk files — timeline can exceed V8's string cap
        // (harness-fe#166); never read whole. Stop once we have `limit` matches.
        forEachLineInFiles(this.timelineFiles(sessionId), (line) => {
            // Cheap pre-filter on the raw line before paying for JSON.parse —
            // valid because if the whole line doesn't contain the query, the
            // event's own content (a subset of the line) definitely doesn't
            // either. This does NOT mean the line is a real match: envelope
            // fields (projectId/buildId/tab/visitorId) are constant across
            // every event in a session, so a query matching e.g. a project
            // named "react-demo" would otherwise "match" every single event
            // regardless of its actual content.
            if (!line.toLowerCase().includes(lowerQuery)) return;
            const event = parseEvent(line);
            if (!event) return;
            if (!matchesType(event, opts.type)) return;
            // Real match check: only the event's type + payload, never the
            // session-constant envelope fields above.
            const haystack = `${event.t} ${JSON.stringify(event.d ?? '')}`.toLowerCase();
            if (!haystack.includes(lowerQuery)) return;
            results.push(event);
            if (results.length >= limit) return false;
        });

        return results;
    }

    listRecordings(sessionId: string): RecordingChunkSummary[] {
        if (!this.getSession(sessionId)) return [];

        const chunks: RecordingChunkSummary[] = [];
        const sessionMeta = this.getSession(sessionId);
        const tabId = sessionMeta?.tabId ?? '';

        forEachLineInFiles(this.recordingFiles(sessionId), (line, index) => {
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

        const sessionMeta = this.getSession(sessionId);
        const tabId = sessionMeta?.tabId ?? '';
        const chunks: RecordingChunk[] = [];

        forEachLineInFiles(this.recordingFiles(sessionId), (line, index) => {
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

        // Stream across chunk files — a large timeline would otherwise blow V8's
        // string cap here too, breaking the console session-detail page (#166).
        forEachLineInFiles(this.timelineFiles(sessionId), (line) => {
            const event = parseEvent(line);
            if (!event) return;
            counts[event.t] = (counts[event.t] ?? 0) + 1;
            if (event.t === 'error') lastError = event;
            if (!lastActivity || event.ts > lastActivity) lastActivity = event.ts;
        });

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
        // Timeline per-session budget (harness-fe#171). Default age = whole-session
        // maxAge (timeline isn't trimmed more aggressively than the session lives).
        const maxTimelineBytes = policy.maxTimelineBytesPerSession ?? DEFAULT_RETENTION.maxTimelineBytesPerSession;
        const maxTimelineFiles = policy.maxTimelineChunksPerSession ?? DEFAULT_RETENTION.maxTimelineChunksPerSession;
        const timelineMaxAge = policy.timelineRetentionMs ?? maxAge;

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

            // Trim recording data per session. Isolate each session: a single
            // unreadable / pathological file must not abort the whole purge run
            // (harness-fe#166 — one oversized file used to wedge all retention).
            for (const sess of this.listSessions({ limit: Number.MAX_SAFE_INTEGER })) {
                // Isolate each session: one pathological file must not abort the
                // whole purge run (harness-fe#166).
                try {
                    const rec = this.pruneRecordingFiles(
                        sess.id,
                        now,
                        recMaxAge,
                        maxChunks,
                        maxBytes,
                        preserveMarkedChunks,
                    );
                    bytesFreed += rec.bytesFreed;
                    recordingsDeleted += rec.chunksDeleted;
                    const tl = this.pruneTimelineFiles(
                        sess.id,
                        now,
                        timelineMaxAge,
                        maxTimelineBytes,
                        maxTimelineFiles,
                    );
                    bytesFreed += tl.bytesFreed;
                } catch (err) {
                    process.stderr.write(
                        `[harness-fe] purge: failed to prune session ${sess.id}: ${(err as Error).message}\n`,
                    );
                }
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

    /**
     * Build per-file metadata for one recording chunk file by streaming it once.
     * `chunkCount`/`bytes` drive the count/byte caps; `hasFullSnapshot`/`hasMarker`
     * drive baseline rescue + marker preservation; `minTs`/`maxTs` drive age.
     */
    private recordingFileMeta(path: string, markerTimestamps: number[]): RecordingFileMeta {
        let minTs = Infinity;
        let maxTs = -Infinity;
        let chunkCount = 0;
        let hasFullSnapshot = false;
        let hasMarker = false;
        forEachLineSync(path, (line, index) => {
            const chunk = parseRecordingChunkLine(line, '', 0, index);
            if (!chunk) return;
            chunkCount += 1;
            if (chunk.startTs < minTs) minTs = chunk.startTs;
            if (chunk.endTs > maxTs) maxTs = chunk.endTs;
            if (!hasFullSnapshot && chunkContainsFullSnapshot(chunk)) hasFullSnapshot = true;
            if (!hasMarker && markerTimestamps.some((ts) => ts >= chunk.startTs && ts <= chunk.endTs)) {
                hasMarker = true;
            }
        });
        let bytes = 0;
        try {
            bytes = statSync(path).size;
        } catch {
            /* racing delete */
        }
        return { path, minTs, maxTs, bytes, chunkCount, hasFullSnapshot, hasMarker };
    }

    /**
     * Evict whole recording chunk FILES (harness-fe#171) by age/count/bytes,
     * preserving the line-granular invariants at file granularity:
     *  - never evict the file currently being appended (the active chunk);
     *  - baseline-aware rescue (#160): keep the most-recent file holding a
     *    FullSnapshot at-or-before the oldest surviving file;
     *  - marker preservation: prefer evicting files with no rrweb:marker overlap.
     * Eviction is `unlinkSync` of whole files — no file is ever read or rewritten
     * whole, so a multi-GB recording can never wedge purge again.
     */
    private pruneRecordingFiles(
        sessionId: string,
        now: number,
        recMaxAge: number,
        maxChunks: number,
        maxBytesLimit: number,
        preserveMarkedChunks: boolean,
    ): { chunksDeleted: number; bytesFreed: number } {
        const files = this.recordingFiles(sessionId);
        if (files.length === 0) return { chunksDeleted: 0, bytesFreed: 0 };
        const markerTimestamps = this.readMarkerTimestamps(this.timelineFiles(sessionId));
        const metas = files.map((p) => this.recordingFileMeta(p, markerTimestamps)).filter((m) => m.chunkCount > 0);
        if (metas.length === 0) return { chunksDeleted: 0, bytesFreed: 0 };

        // Active chunk (currently appended): exempt from count/bytes eviction so a
        // concurrent write isn't lost. NOT exempt from age — a live session's
        // active chunk has a recent maxTs (naturally safe), while an ended
        // session's last chunk must stay reclaimable.
        const st = this.recordingStreams.get(sessionId);
        const activePath = st ? join(this.sessionRecordingDir(sessionId), chunkFileName(st.num)) : undefined;
        const isActive = (m: RecordingFileMeta) => m.path === activePath;

        const removed = new Set<string>();
        // 1. age — evict whole files entirely past the window.
        for (const m of metas) {
            if (now - m.maxTs > recMaxAge) removed.add(m.path);
        }
        let kept = metas.filter((m) => !removed.has(m.path));

        const chooseRemovalCandidate = (): RecordingFileMeta | undefined => {
            const candidates = kept.filter((m) => !isActive(m)).sort((a, b) => a.minTs - b.minTs);
            if (candidates.length === 0) return undefined;
            if (!preserveMarkedChunks) return candidates[0];
            return candidates.find((m) => !m.hasMarker) ?? candidates[0];
        };
        const evict = (m: RecordingFileMeta) => {
            removed.add(m.path);
            kept = kept.filter((k) => k.path !== m.path);
        };

        // 2. count + bytes — evict oldest non-active files until under caps.
        while (kept.reduce((s, m) => s + m.chunkCount, 0) > maxChunks) {
            const c = chooseRemovalCandidate();
            if (!c) break;
            evict(c);
        }
        while (kept.reduce((s, m) => s + m.bytes, 0) > maxBytesLimit) {
            const c = chooseRemovalCandidate();
            if (!c) break;
            evict(c);
        }

        // 3. baseline-aware rescue at file granularity (#160).
        if (kept.length > 0) {
            const oldestKeptTs = Math.min(...kept.map((m) => m.minTs));
            const anchored = kept.some((m) => m.minTs <= oldestKeptTs && m.hasFullSnapshot);
            if (!anchored) {
                const baseline = metas
                    .filter((m) => removed.has(m.path) && m.minTs <= oldestKeptTs && m.hasFullSnapshot)
                    .sort((a, b) => b.minTs - a.minTs)[0];
                if (baseline) {
                    removed.delete(baseline.path);
                    kept.push(baseline);
                }
            }
        }

        if (removed.size === 0) return { chunksDeleted: 0, bytesFreed: 0 };
        let chunksDeleted = 0;
        let bytesFreed = 0;
        for (const m of metas) {
            if (!removed.has(m.path)) continue;
            try {
                unlinkSync(m.path);
            } catch {
                /* already gone */
            }
            chunksDeleted += m.chunkCount;
            bytesFreed += m.bytes;
        }
        return { chunksDeleted, bytesFreed };
    }

    /**
     * Bound a single session's timeline (harness-fe#171, the core ask): when the
     * timeline chunk files exceed the per-session byte / file-count budget, drop
     * the OLDEST whole files — keep recent events, never the wrong-direction
     * "drop new events" of the old append cap. No baseline/marker rescue: timeline
     * events are independent. The active chunk is never evicted.
     */
    private pruneTimelineFiles(
        sessionId: string,
        now: number,
        timelineMaxAge: number,
        maxBytes: number,
        maxFiles: number,
    ): { bytesFreed: number } {
        const files = this.timelineFiles(sessionId);
        if (files.length === 0) return { bytesFreed: 0 };
        const st = this.timelineStreams.get(sessionId);
        const activePath = st ? join(this.sessionTimelineDir(sessionId), chunkFileName(st.num)) : undefined;

        const metas = files
            .map((p) => {
                let bytes = 0;
                let mtimeMs = 0;
                try {
                    const s = statSync(p);
                    bytes = s.size;
                    mtimeMs = s.mtimeMs;
                } catch {
                    /* racing delete */
                }
                return { path: p, bytes, mtimeMs };
            })
            .filter((m) => m.bytes > 0);

        const removed = new Set<string>();
        // age — evict whole files not touched within the window (mtime proxy).
        // No active exemption (a live session's active file has a recent mtime).
        for (const m of metas) {
            if (now - m.mtimeMs > timelineMaxAge) removed.add(m.path);
        }
        let kept = metas.filter((m) => !removed.has(m.path));
        const oldestNonActive = (): { path: string; bytes: number } | undefined =>
            kept.filter((m) => m.path !== activePath)[0]; // metas already oldest→newest
        const evict = (m: { path: string }) => {
            removed.add(m.path);
            kept = kept.filter((k) => k.path !== m.path);
        };
        while (kept.length > maxFiles) {
            const c = oldestNonActive();
            if (!c) break;
            evict(c);
        }
        while (kept.reduce((s, m) => s + m.bytes, 0) > maxBytes) {
            const c = oldestNonActive();
            if (!c) break;
            evict(c);
        }

        if (removed.size === 0) return { bytesFreed: 0 };
        let bytesFreed = 0;
        for (const m of metas) {
            if (!removed.has(m.path)) continue;
            try {
                unlinkSync(m.path);
            } catch {
                /* already gone */
            }
            bytesFreed += m.bytes;
        }
        return { bytesFreed };
    }

    private readMarkerTimestamps(timelineFiles: string[]): number[] {
        const timestamps: number[] = [];
        // Stream across chunk files — runs inside purge for every session; a
        // multi-GB timeline read whole-file here threw and aborted the ENTIRE
        // auto-purge (harness-fe#166 sibling). Line-by-line keeps purge alive.
        forEachLineInFiles(timelineFiles, (line) => {
            const event = parseEvent(line);
            if (!event || event.t !== 'rrweb:marker') return;
            timestamps.push(event.ts);
        });
        return timestamps;
    }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Sanitize a string for use as a directory name. */
export function sanitizeId(id: string): string {
    return id.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 64);
}
