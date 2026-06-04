/**
 * Capability API — the protocol-agnostic surface every front door reuses.
 *
 * Each method takes `(args, principal)` and returns raw data (no MCP / HTTP
 * envelope — that's the gateway's job). Each enforces, in core:
 *   - **scope** (write-only callers are denied every read/control capability),
 *   - **tenant visibility** (`canSee` / `canSeeProject`),
 *   - **command-target scoping** (via the bridge's `findTab` + principal).
 *
 * The gateway calls these through the {@link CoreClient} interface; the
 * in-process implementation forwards straight here.
 */

import type {
    TabInfo,
    Task,
    TaskResolution,
    TaskStatus,
} from '@harness-fe/protocol';
import type { Bridge, SendCommandOptions } from '../bridge.js';
import { canSee, canSeeProject, type Principal } from '../identity.js';
import type { IStore } from '../store/index.js';
import { createReplayExport } from '../replayCreate.js';
import { buildVisitorTimeline } from '../visitorTimeline.js';
import { assertScope, requiredScopeForCommand } from './scope.js';

export { ScopeDeniedError, requiredScopeForCommand, assertScope } from './scope.js';
export type { CapabilityScope } from './scope.js';

/** Options for a command capability (subset of {@link SendCommandOptions}). */
export interface CommandOptions {
    tabId?: string;
    target?: 'runtime-client' | 'vite-plugin';
    projectId?: string;
    timeoutMs?: number;
}

/**
 * Owner chain of a project for tenant isolation: the project's own `createdBy`
 * followed by its ancestors' (walked via `parentProjectId`, self → root,
 * cycle-safe). Feed to `canSeeProject` so a host agent sees its sub-apps' data.
 */
function ownerChainOf(projectId: string, store: IStore): Array<string | undefined> {
    const chain: Array<string | undefined> = [];
    const seen = new Set<string>();
    let id: string | undefined = projectId;
    while (id && !seen.has(id)) {
        seen.add(id);
        const p = store.getProject(id);
        if (!p) break;
        chain.push(p.createdBy);
        id = p.parentProjectId;
    }
    return chain;
}

/** Merge overlapping rrweb recording chunks into contiguous intervals. */
function meltRecordingIntervals(chunks: Array<{
    chunkId: string;
    tabId: string;
    startTs: number;
    endTs: number;
    eventCount: number;
}>): Array<{
    startTs: number;
    endTs: number;
    chunkCount: number;
    eventCount: number;
    chunkIds: string[];
    tabIds: string[];
}> {
    if (chunks.length === 0) return [];
    const sorted = [...chunks].sort((a, b) => a.startTs - b.startTs || a.endTs - b.endTs);
    const intervals: Array<{
        startTs: number;
        endTs: number;
        chunkCount: number;
        eventCount: number;
        chunkIds: string[];
        tabIds: string[];
    }> = [];
    for (const chunk of sorted) {
        const last = intervals[intervals.length - 1];
        if (!last || chunk.startTs > last.endTs) {
            intervals.push({
                startTs: chunk.startTs,
                endTs: chunk.endTs,
                chunkCount: 1,
                eventCount: chunk.eventCount,
                chunkIds: [chunk.chunkId],
                tabIds: [chunk.tabId],
            });
            continue;
        }
        last.endTs = Math.max(last.endTs, chunk.endTs);
        last.chunkCount += 1;
        last.eventCount += chunk.eventCount;
        last.chunkIds.push(chunk.chunkId);
        if (!last.tabIds.includes(chunk.tabId)) last.tabIds.push(chunk.tabId);
    }
    return intervals;
}

/**
 * The capability surface. Construct with a {@link Bridge}; every method enforces
 * scope + visibility internally.
 */
export class CoreCapabilities {
    constructor(private readonly bridge: Bridge) {}

    /** Require a non-null store, else throw a uniform error. */
    private requireStore(): IStore {
        if (!this.bridge.store) throw new Error('core: store is not enabled');
        return this.bridge.store;
    }

    // ─── Browser commands (sendCommand) ───────────────────────────────────────

    /**
     * Run a browser/plugin command. Control commands (CONTROL_COMMANDS) require
     * `control` scope; everything else requires `read`. Tab resolution +
     * command-target scoping happen inside the bridge using `principal`.
     */
    async command(
        command: string,
        args: unknown,
        principal: Principal,
        opts: CommandOptions = {},
    ): Promise<unknown> {
        assertScope(principal, requiredScopeForCommand(command));
        const sendOpts: SendCommandOptions = { ...opts, principal };
        return this.bridge.sendCommand(command, args, sendOpts);
    }

    /** List connected browser tabs. */
    async listTabs(principal: Principal): Promise<TabInfo[]> {
        assertScope(principal, 'read');
        return this.bridge.listTabs();
    }

    // ─── tasks.* ──────────────────────────────────────────────────────────────

    /**
     * List user-submitted annotation tasks, filtered to projects the caller may
     * see. Falls back to the submitter tag (`canSee`) when no store is
     * configured (in-memory mode).
     */
    async tasksPending(
        principal: Principal,
        filter: { status?: TaskStatus | 'all'; limit?: number } = {},
    ): Promise<Task[]> {
        assertScope(principal, 'read');
        const store = this.bridge.store;
        const all = await this.bridge.listTasks({ status: filter.status ?? 'pending', limit: filter.limit });
        return store
            ? all.filter((t) => canSeeProject(principal, t.projectId, ownerChainOf(t.projectId, store)))
            : all.filter((t) => canSee(principal, t.createdBy));
    }

    /** Claim a task, tagging the claiming principal. */
    async tasksClaim(principal: Principal, taskId: string): Promise<Task | undefined> {
        assertScope(principal, 'read');
        return this.bridge.claimTask(taskId, principal);
    }

    /** Resolve a task with an optional note + structured resolution. */
    async tasksResolve(
        principal: Principal,
        taskId: string,
        note?: string,
        resolution?: TaskResolution,
    ): Promise<Task | undefined> {
        assertScope(principal, 'read');
        return this.bridge.resolveTask(taskId, note, resolution, principal);
    }

    /** Read a task screenshot attachment as base64 PNG, or null. */
    async taskAttachment(
        principal: Principal,
        taskId: string,
        attachmentId: string,
    ): Promise<string | null> {
        assertScope(principal, 'read');
        return this.bridge.getTaskAttachmentData(taskId, attachmentId);
    }

    // ─── session.* / project.* / build.* / visitor.* (store reads) ────────────

    /** List recent sessions for a project the caller may see. */
    async sessionList(
        principal: Principal,
        projectId: string,
        limit = 10,
    ) {
        assertScope(principal, 'read');
        const store = this.requireStore();
        if (!canSeeProject(principal, projectId, ownerChainOf(projectId, store))) return [];
        return store.listSessions({ projectId, limit });
    }

    /** Summarize a session (event counts, last error, active tabs). */
    async sessionSummary(principal: Principal, sessionId: string) {
        assertScope(principal, 'read');
        return this.requireStore().summary(sessionId);
    }

    /** Tail the last N events from a session timeline. */
    async sessionTail(
        principal: Principal,
        sessionId: string,
        opts: { n?: number; type?: string | string[]; projectId?: string; since?: number; until?: number } = {},
    ) {
        assertScope(principal, 'read');
        const store = this.requireStore();
        const session = store.getSession(sessionId);
        if (!session) return { error: 'session not found', sessionId };
        return store.tail(sessionId, {
            n: opts.n ?? 50,
            type: opts.type,
            since: opts.since,
            until: opts.until,
            projectId: opts.projectId,
        });
    }

    /** Substring search over a session timeline. */
    async sessionSearch(
        principal: Principal,
        sessionId: string,
        query: string,
        opts: { type?: string | string[]; limit?: number } = {},
    ) {
        assertScope(principal, 'read');
        const store = this.requireStore();
        const session = store.getSession(sessionId);
        if (!session) return { error: 'session not found', sessionId };
        return store.search(sessionId, query, { type: opts.type, limit: opts.limit ?? 50 });
    }

    /** List projects (with recent sessions) the caller may see. */
    async projectSessions(principal: Principal) {
        assertScope(principal, 'read');
        const store = this.requireStore();
        const projects = store
            .listProjects()
            .filter((p) => canSeeProject(principal, p.id, ownerChainOf(p.id, store)));
        return projects.map((p) => ({
            ...p,
            recentSessions: store.listSessions({ projectId: p.id, limit: 3 }),
        }));
    }

    /** List every project the daemon has seen (full metadata). */
    async projectList(principal: Principal) {
        assertScope(principal, 'read');
        return this.requireStore().listProjects();
    }

    /** Read a single project's metadata. */
    async projectGet(principal: Principal, projectId: string) {
        assertScope(principal, 'read');
        return this.requireStore().getProject(projectId) ?? null;
    }

    /** Project forest assembled from parentProjectId relationships. */
    async projectTree(principal: Principal, rootId?: string) {
        assertScope(principal, 'read');
        return this.requireStore().getProjectTree(rootId);
    }

    /** Set or clear a project's parentProjectId (rejects cycles). */
    async projectSetParent(principal: Principal, projectId: string, parentProjectId?: string | null) {
        assertScope(principal, 'read');
        return this.requireStore().upsertProject(projectId, {
            parentProjectId: parentProjectId ?? undefined,
        });
    }

    /** List builds for a project, newest first. */
    async buildList(principal: Principal, projectId: string, limit?: number) {
        assertScope(principal, 'read');
        return this.requireStore().listBuilds(projectId, limit);
    }

    /** Read a single build's metadata. */
    async buildGet(principal: Principal, projectId: string, buildId: string) {
        assertScope(principal, 'read');
        return this.requireStore().getBuild(projectId, buildId) ?? null;
    }

    /** List known visitors. */
    async visitorList(principal: Principal, opts: { projectId?: string; limit?: number } = {}) {
        assertScope(principal, 'read');
        return this.requireStore().listVisitors(opts);
    }

    /** Read a single visitor's metadata. */
    async visitorGet(principal: Principal, visitorId: string) {
        assertScope(principal, 'read');
        return this.requireStore().getVisitor(visitorId) ?? null;
    }

    /** Chronological session list (journey) for one visitor. */
    async visitorJourney(principal: Principal, visitorId: string, limit?: number) {
        assertScope(principal, 'read');
        const store = this.requireStore();
        const visitor = store.getVisitor(visitorId);
        if (!visitor) return { error: `visitor not found: ${visitorId}` };
        const seen = new Set<string>();
        const sessionsOut: Array<{
            sessionId: string;
            url?: string;
            title?: string;
            startedAt: number;
            endedAt?: number;
            projects: string[];
            builds: string[];
        }> = [];
        for (const pid of visitor.projectIds) {
            for (const sess of store.listSessions({ projectId: pid, limit: 200 })) {
                if (seen.has(sess.id)) continue;
                if (sess.tabId && !visitor.tabIds.includes(sess.tabId)) continue;
                seen.add(sess.id);
                sessionsOut.push({
                    sessionId: sess.id,
                    url: sess.url,
                    title: sess.title,
                    startedAt: sess.startedAt,
                    endedAt: sess.endedAt,
                    projects: sess.participants.map((p) => p.projectId),
                    builds: sess.participants.map((p) => p.buildId).filter((b): b is string => !!b),
                });
            }
        }
        sessionsOut.sort((a, b) => b.startedAt - a.startedAt);
        const slice = limit ? sessionsOut.slice(0, limit) : sessionsOut;
        return { visitor, sessions: slice };
    }

    /** Merged cross-session event timeline for one visitor (ascending by ts). */
    async visitorTimeline(
        principal: Principal,
        visitorId: string,
        opts: {
            since?: number;
            until?: number;
            types?: string | string[];
            tabIds?: string[];
            sessionIds?: string[];
            limit?: number;
        } = {},
    ) {
        assertScope(principal, 'read');
        return buildVisitorTimeline(this.requireStore(), visitorId, opts);
    }

    // ─── session.recordings.* / replay ─────────────────────────────────────────

    /** List rrweb recording chunks available for a session (+ merged intervals). */
    async recordingsList(principal: Principal, sessionId: string) {
        assertScope(principal, 'read');
        const store = this.requireStore();
        const session = store.getSession(sessionId);
        if (!session) return { error: 'session not found', sessionId };
        const chunks = store.listRecordings(sessionId);
        return { chunks, intervals: meltRecordingIntervals(chunks) };
    }

    /** Recording chunks overlapping a window around a timestamp (+ markers). */
    async recordingsAround(principal: Principal, sessionId: string, ts: number, windowMs = 15_000) {
        assertScope(principal, 'read');
        const store = this.requireStore();
        const session = store.getSession(sessionId);
        if (!session) return { error: 'session not found', sessionId };
        const since = ts - windowMs;
        const until = ts + windowMs;
        const chunks = store.listRecordings(sessionId)
            .filter((chunk) => chunk.endTs >= since && chunk.startTs <= until);
        const markers = store.tail(sessionId, { n: 200, type: 'rrweb:marker', since, until })
            .filter((marker) => chunks.some((chunk) => chunk.endTs >= marker.ts && chunk.startTs <= marker.ts));
        return { since, until, chunks, intervals: meltRecordingIntervals(chunks), markers };
    }

    /** Recording chunks overlapping an explicit window. */
    async recordingsSlice(principal: Principal, sessionId: string, since: number, until: number) {
        assertScope(principal, 'read');
        const store = this.requireStore();
        const session = store.getSession(sessionId);
        if (!session) return { error: 'session not found', sessionId };
        const chunks = store.sliceRecordings(sessionId, since, until);
        return { since, until, chunks, intervals: meltRecordingIntervals(chunks) };
    }

    /** Bundle recording chunks in a window into a replay export; returns viewer URL. */
    async replayCreate(
        principal: Principal,
        args: {
            sessionId: string;
            tabId?: string;
            ts?: number;
            windowMs?: number;
            since?: number;
            until?: number;
            label?: string;
        },
    ) {
        assertScope(principal, 'read');
        return createReplayExport(this.requireStore(), this.bridge.getViewerBaseUrl(), args);
    }

    // ─── project.memory.* ──────────────────────────────────────────────────────

    /** Write/update a persistent project memory entry. */
    async memorySet(principal: Principal, projectId: string, key: string, value: string) {
        assertScope(principal, 'read');
        const entry = this.bridge.getMemoryStore().set(projectId, key, value);
        return { ok: true, key: entry.key, updatedAt: entry.updatedAt };
    }

    /** Read a project memory entry by key. */
    async memoryGet(principal: Principal, projectId: string, key: string) {
        assertScope(principal, 'read');
        const entry = this.bridge.getMemoryStore().get(projectId, key);
        if (!entry) return { found: false, key };
        return { found: true, key: entry.key, value: entry.value, updatedAt: entry.updatedAt };
    }

    /** List all memory entries for a project. */
    async memoryList(principal: Principal, projectId: string) {
        assertScope(principal, 'read');
        return this.bridge.getMemoryStore().list(projectId);
    }

    /** Delete a project memory entry by key. */
    async memoryDelete(principal: Principal, projectId: string, key: string) {
        assertScope(principal, 'read');
        const deleted = this.bridge.getMemoryStore().delete(projectId, key);
        return { deleted, key };
    }

    // ─── session.purge ──────────────────────────────────────────────────────────

    /** Delete old sessions/recordings to free disk space. */
    async sessionPurge(
        principal: Principal,
        policy: {
            maxAgeDays?: number;
            maxSessionsPerProject?: number;
            recordingRetentionDays?: number;
            maxRecordingChunksPerTab?: number;
            maxRecordingBytesPerTab?: number;
            preserveMarkedChunks?: boolean;
        } = {},
    ) {
        assertScope(principal, 'read');
        const result = this.requireStore().purge(policy);
        return {
            sessionsDeleted: result.sessionsDeleted,
            recordingsDeleted: result.recordingsDeleted,
            bytesFreed: result.bytesFreed,
        };
    }
}
