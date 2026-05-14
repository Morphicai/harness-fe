/**
 * JsonlStore — JSONL-based persistence layer.
 *
 * All writes are synchronous append operations (O(1), no seek).
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
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import type {
    IStore,
    ProjectMeta,
    PurgeResult,
    RetentionPolicy,
    SearchOptions,
    SessionMeta,
    SessionSummary,
    StoreEvent,
    TabMeta,
    TailOptions,
} from './types.js';

const DEFAULT_DATA_DIR = join(homedir(), '.harnessa-fe', 'data');
const DEFAULT_RETENTION: Required<RetentionPolicy> = {
    maxAgeDays: 7,
    maxSessionsPerProject: 20,
    recordingRetentionDays: 3,
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

function appendJsonlBatch(path: string, objs: unknown[]): void {
    if (!objs.length) return;
    appendFileSync(path, objs.map((o) => JSON.stringify(o)).join('\n') + '\n', 'utf-8');
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

    constructor(dataDir?: string) {
        this.dataDir = resolve(dataDir ?? DEFAULT_DATA_DIR);
        ensureDir(this.dataDir);
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

        // Upsert project meta
        const projMetaPath = join(projDir, 'meta.json');
        const existing = readJson<ProjectMeta>(projMetaPath);
        const projMeta: ProjectMeta = {
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

    closeSession(sessionId: string): void {
        const projectId = this.resolveProject(sessionId);
        if (!projectId) return;
        const metaPath = join(this.sessionDir(projectId, sessionId), 'meta.json');
        const meta = readJson<SessionMeta>(metaPath);
        if (!meta) return;
        meta.endedAt = Date.now();
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

    // ── Write ─────────────────────────────────────────────────────────────

    append(sessionId: string, event: StoreEvent, tabId?: string): void {
        const projectId = this.resolveProject(sessionId);
        if (!projectId) return;

        // Always write to session timeline
        appendJsonl(this.sessionTimeline(projectId, sessionId), event);

        // Also write to tab timeline if tabId provided
        if (tabId) {
            const tabDir = this.tabDir(projectId, sessionId, tabId);
            ensureDir(tabDir);
            appendJsonl(this.tabTimeline(projectId, sessionId, tabId), event);
        }
    }

    appendBatch(sessionId: string, events: StoreEvent[], tabId?: string): void {
        if (!events.length) return;
        const projectId = this.resolveProject(sessionId);
        if (!projectId) return;

        appendJsonlBatch(this.sessionTimeline(projectId, sessionId), events);

        if (tabId) {
            const tabDir = this.tabDir(projectId, sessionId, tabId);
            ensureDir(tabDir);
            appendJsonlBatch(this.tabTimeline(projectId, sessionId, tabId), events);
        }
    }

    appendRecording(sessionId: string, tabId: string, events: unknown[]): void {
        const projectId = this.resolveProject(sessionId);
        if (!projectId) return;
        const tabDir = this.tabDir(projectId, sessionId, tabId);
        ensureDir(tabDir);
        // Each chunk is one line: { ts, events: [...] }
        appendJsonl(this.tabRecording(projectId, sessionId, tabId), {
            ts: Date.now(),
            events,
        });
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
        const multiplier = opts.type || opts.since || opts.until ? 5 : 1;
        const rawLines = readLastNLines(filePath, n * multiplier);

        const events: StoreEvent[] = [];
        for (const line of rawLines) {
            const event = parseEvent(line);
            if (!event) continue;
            if (!matchesType(event, opts.type)) continue;
            if (!matchesTimeRange(event, opts.since, opts.until)) continue;
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
            results.push(event);
            if (results.length >= limit) break;
        }

        return results;
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

    // ── Maintenance ───────────────────────────────────────────────────────

    purge(policy: RetentionPolicy = {}): PurgeResult {
        const p: Required<RetentionPolicy> = { ...DEFAULT_RETENTION, ...policy };
        const now = Date.now();
        const maxAge = p.maxAgeDays * 86400000;
        const recMaxAge = p.recordingRetentionDays * 86400000;

        let sessionsDeleted = 0;
        let recordingsDeleted = 0;
        let bytesFreed = 0;

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

            // Delete old recording files (keep timeline, just remove rrweb)
            for (const sess of this.listSessions(proj.id, 1000)) {
                const tabsDir = join(this.sessionDir(proj.id, sess.id), 'tabs');
                if (!existsSync(tabsDir)) continue;
                for (const tabEntry of readdirSync(tabsDir, { withFileTypes: true })) {
                    if (!tabEntry.isDirectory()) continue;
                    const recPath = join(tabsDir, tabEntry.name, 'recording.jsonl');
                    if (!existsSync(recPath)) continue;
                    const { mtimeMs } = statSync(recPath);
                    if (now - mtimeMs > recMaxAge) {
                        const size = statSync(recPath).size;
                        unlinkSync(recPath);
                        bytesFreed += size;
                        recordingsDeleted++;
                    }
                }
            }
        }

        return { sessionsDeleted, recordingsDeleted, bytesFreed };
    }

    close(): void {
        // No file handles to close (all writes are synchronous one-shot appends)
    }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Sanitize a string for use as a directory name. */
function sanitizeId(id: string): string {
    return id.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 64);
}
