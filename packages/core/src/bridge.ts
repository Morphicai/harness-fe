/**
 * Bridge — the transport-agnostic WS-frame state machine at the heart of core.
 *
 * Unlike the old daemon Bridge, this owns **no** HTTP server, no WebSocket
 * server, and binds no port. The gateway is the only front door: it terminates
 * the runtime WebSocket (and the HTTP-batch / dashboard channels), resolves the
 * caller's {@link Principal}, then feeds the connection in through
 * {@link Bridge.acceptPeer}. The socket is abstracted behind {@link PeerSocket}
 * so core never depends on `ws`.
 *
 * Responsibilities:
 *   - Handshake: `hello` frame → register peer in SessionRouter, reply `hello.ack`
 *   - sendCommand(): forward a CommandFrame to the target tab, return a Promise
 *     that resolves when the matching ResponseFrame arrives
 *   - onEvent(): broadcast event frames to subscribers (capability tails / recorder)
 *   - persist events / recordings / tasks to the store
 */

import { randomUUID } from 'node:crypto';
import { join as joinPath } from 'node:path';
import { homedir } from 'node:os';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import {
    EVENT_NAME,
    PROTOCOL_VERSION,
    type ConsentPolicy,
    pageLoadPayloadSchema,
    rrwebChunkPayloadSchema,
    taskSubmitPayloadSchema,
    type CommandFrame,
    type EventFrame,
    type Frame,
    type HelloAckFrame,
    type HttpBatch,
    type QueryFrame,
    type QueryResponseFrame,
    type TabInfo,
    type Task,
    type TaskAttachment,
    type TaskResolution,
    type TaskStatus,
    frameSchema,
} from '@harness-fe/protocol';
import { LOCAL_PRINCIPAL, type Principal } from './identity.js';
import { currentCaller } from './callerContext.js';
import { SessionRouter, type PeerSession } from './sessionRouter.js';
import {
    JsonlStore,
    JsonTaskStore,
    JsonMemoryStore,
    sanitizeId as sanitizeStoreId,
    type IStore,
    type ITaskStore,
    type IMemoryStore,
    type RetentionPolicy,
} from './store/index.js';

/**
 * The transport abstraction. The gateway adapts a real `ws.WebSocket` (or any
 * other bidirectional message channel) to this shape and hands it to
 * {@link Bridge.acceptPeer}. core only ever sends/receives JSON strings and
 * asks whether the socket is still open.
 */
export interface PeerSocket {
    /** Send a JSON frame string to the peer. Must not throw on a closed socket. */
    send(data: string): void;
    /** Close the underlying connection. */
    close(): void;
    /** True while the socket can still send. */
    readonly isOpen: boolean;
    /** Register the inbound-message handler. Called once per accepted peer. */
    onMessage(handler: (data: string) => void): void;
    /** Register the close handler. Called once per accepted peer. */
    onClose(handler: () => void): void;
}

export interface SendCommandOptions {
    tabId?: string;
    timeoutMs?: number;
    target?: 'runtime-client' | 'vite-plugin';
    projectId?: string;
    /**
     * Caller identity (command-target scoping). When set, tab resolution is
     * restricted to tabs the caller may drive. Omit (or `local`) to preserve
     * global behaviour.
     */
    principal?: Principal;
}

const COMMAND_TIMEOUT_MS = 30_000;
const TASK_QUEUE_CAP = 200;

/**
 * Default data directory for all persistence stores. The gateway / CLI normally
 * passes an explicit `dataDir`; this is the fallback when none is supplied.
 */
export function defaultDataDir(): string {
    return joinPath(homedir(), '.harness', 'core', 'data');
}

interface PendingCommand {
    resolve(payload: unknown): void;
    reject(err: Error): void;
    timer: NodeJS.Timeout;
}

export interface BridgeOptions {
    /**
     * Browser-consent policy for control commands, pushed to runtime clients in
     * `hello.ack`. The gateway sets this from its Policy (Open → off,
     * Governed → session). Default `{ mode: 'off' }` (solo / unrestricted).
     */
    consent?: ConsentPolicy;
    /**
     * Base URL where the replay viewer is reachable (served by the gateway's
     * `/console`). Injected so `replay` capability links resolve to the gateway,
     * not to core (which has no public URL of its own).
     */
    viewerBaseUrl?: string;
    /**
     * Store instance for JSONL persistence. If omitted, a default JsonlStore is
     * created at `dataDir`. Pass null to disable persistence.
     */
    store?: IStore | null;
    /**
     * Task store instance for JSON task persistence. If omitted, a default
     * JsonTaskStore is created at `dataDir`. Pass null to disable.
     */
    taskStore?: ITaskStore | null;
    /**
     * Memory store instance for agent memory persistence. If omitted, a default
     * JsonMemoryStore is created at `dataDir`. Pass null to disable.
     */
    memoryStore?: IMemoryStore | null;
    /**
     * Root data directory for task attachment binaries. Defaults to `dataDir`.
     */
    attachmentsDataDir?: string;
    /**
     * Root data directory for the default stores (when `store` / `taskStore` /
     * `memoryStore` are not supplied). Defaults to {@link defaultDataDir}.
     */
    dataDir?: string;
    /** Optional friendly label surfaced in dashboards. Cosmetic only. */
    label?: string;
    /**
     * Automatic retention policy enforcement. Without this, manual
     * `session.purge` is the only thing that trims the on-disk store. Default:
     * purge once shortly after start and every hour thereafter. Set
     * `enabled: false` for tests / one-shot runs.
     */
    autoPurge?: {
        enabled?: boolean;          // default true
        /** Period between purges in ms. Default 1 hour. */
        intervalMs?: number;
        /** Override the retention policy. Default uses store's built-in defaults. */
        policy?: RetentionPolicy;
        /** Skip the startup purge (still runs the periodic timer). Default false. */
        skipInitial?: boolean;
    };
}

export type EventListener = (event: EventFrame, session: PeerSession) => void;

export class Bridge {
    readonly router = new SessionRouter();
    readonly store: IStore | null;
    readonly taskStore: ITaskStore | null;
    readonly memoryStore: IMemoryStore;
    private sockets = new Map<string, PeerSocket>();
    private pending = new Map<string, PendingCommand>();
    private eventListeners = new Set<EventListener>();
    private tasks = new Map<string, Task>();
    /** Browser-consent policy pushed to runtime clients in hello.ack. */
    private readonly consentPolicy: ConsentPolicy;
    private readonly viewerBaseUrl: string | undefined;
    private readonly attachDataDir: string;
    private autoPurgeOpts: Required<NonNullable<BridgeOptions['autoPurge']>>;
    /** Set by start() when auto-purge is enabled; cleared by stop(). */
    private autoPurgeTimer?: NodeJS.Timeout;
    /**
     * Map from connectionId → buildId (for build-plugin connections)
     * or sessionId (for runtime-client connections).
     */
    private connToStoreId = new Map<string, string>();
    /** Caller identity per connection. Resolved by the gateway, passed to acceptPeer. */
    private connToPrincipal = new Map<string, Principal>();
    /**
     * Identity attributed to task claim/resolve when no per-call principal is
     * threaded through. Falls back to the trusted local principal.
     */
    private readonly defaultPrincipal: Principal = LOCAL_PRINCIPAL;
    /** Connections that already logged a "no store session" warning. */
    private warnedNoSession = new Set<string>();
    /**
     * Grace period timers: projectId → timer handle. When a build plugin
     * disconnects, a 30-second timer is started; reconnect within that window
     * cancels it.
     */
    private graceTimers = new Map<string, NodeJS.Timeout>();
    /** Pending build end info: projectId → { buildId, closedAt }. */
    private pendingEndBuild = new Map<string, { buildId: string; closedAt: number }>();
    /**
     * Dashboard subscribers — connections that sent `hello` with
     * role: 'dashboard-client'. Receive `dashboard.update` frames whenever
     * session state changes; never receive commands and never send events.
     */
    private dashboardSubscribers = new Set<PeerSocket>();
    /** Debounce per-session 'session.update' broadcasts so chatty rrweb chunks don't spam subscribers. */
    private dashboardDebounceTimers = new Map<string, NodeJS.Timeout>();

    /** Optional friendly label. Cosmetic only. */
    readonly label: string | undefined;

    constructor(opts: BridgeOptions = {}) {
        const dataDir = opts.dataDir ?? defaultDataDir();
        this.label = opts.label;
        this.store = opts.store === null ? null : (opts.store ?? new JsonlStore(dataDir));
        this.taskStore = opts.taskStore === null ? null : (opts.taskStore ?? new JsonTaskStore(dataDir));
        this.memoryStore = opts.memoryStore === null
            ? new JsonMemoryStore(dataDir)
            : (opts.memoryStore ?? new JsonMemoryStore(dataDir));
        this.attachDataDir = opts.attachmentsDataDir ?? dataDir;
        // Consent defaults to off (solo / unrestricted). The gateway forces
        // `session` for governed deployments.
        this.consentPolicy = opts.consent ?? { mode: 'off' };
        this.viewerBaseUrl = opts.viewerBaseUrl;
        // Default auto-purge ON. CI / tests pass `enabled: false` (or set
        // env HARNESS_FE_PURGE_DISABLED=1) to opt out.
        const envDisabled = process.env.HARNESS_FE_PURGE_DISABLED === '1';
        this.autoPurgeOpts = {
            enabled: opts.autoPurge?.enabled ?? !envDisabled,
            intervalMs: opts.autoPurge?.intervalMs ?? 60 * 60 * 1000,
            policy: opts.autoPurge?.policy ?? {},
            skipInitial: opts.autoPurge?.skipInitial ?? false,
        };
    }

    /** Returns the memory store instance for use by capability functions. */
    getMemoryStore(): IMemoryStore {
        return this.memoryStore;
    }

    /** Base URL where the replay viewer is reachable (gateway-served), or undefined. */
    getViewerBaseUrl(): string | undefined {
        return this.viewerBaseUrl;
    }

    /**
     * Begin lifecycle: schedule auto-purge. Idempotent-ish — call once after
     * construction. (No HTTP/WS to start; the gateway owns transport.)
     */
    async start(): Promise<void> {
        if (this.store && this.autoPurgeOpts.enabled) {
            if (!this.autoPurgeOpts.skipInitial) {
                this.runAutoPurge('startup');
            }
            const timer = setInterval(
                () => this.runAutoPurge('periodic'),
                this.autoPurgeOpts.intervalMs,
            );
            // unref so the timer never holds the Node process alive on its own.
            timer.unref();
            this.autoPurgeTimer = timer;
        }
    }

    /** Stop lifecycle: clear timers and close all peer sockets. Safe to call repeatedly. */
    async stop(): Promise<void> {
        if (this.autoPurgeTimer) {
            clearInterval(this.autoPurgeTimer);
            this.autoPurgeTimer = undefined;
        }
        for (const timer of this.graceTimers.values()) clearTimeout(timer);
        this.graceTimers.clear();
        for (const timer of this.dashboardDebounceTimers.values()) clearTimeout(timer);
        this.dashboardDebounceTimers.clear();
        for (const sock of this.sockets.values()) {
            try {
                sock.close();
            } catch {
                /* swallow */
            }
        }
        this.sockets.clear();
    }

    /**
     * Run `store.purge()` defensively. Errors are logged but never bubble out —
     * core must keep serving even if disk is full or files are locked.
     */
    private runAutoPurge(trigger: 'startup' | 'periodic'): void {
        if (!this.store) return;
        try {
            const result = this.store.purge(this.autoPurgeOpts.policy);
            const removed =
                result.sessionsDeleted +
                result.recordingsDeleted +
                result.exportsDeleted +
                (result.buildsDeleted ?? 0);
            if (removed > 0 || result.bytesFreed > 0) {
                const mb = (result.bytesFreed / 1024 / 1024).toFixed(2);
                process.stderr.write(
                    `[harness-fe] auto-purge (${trigger}): freed ${mb} MB · ` +
                        `${result.sessionsDeleted} sessions, ` +
                        `${result.recordingsDeleted} rrweb chunks, ` +
                        `${result.buildsDeleted ?? 0} builds, ` +
                        `${result.exportsDeleted} exports\n`,
                );
            }
        } catch (err) {
            process.stderr.write(
                `[harness-fe] auto-purge failed (${trigger}): ${
                    err instanceof Error ? err.message : String(err)
                }\n`,
            );
        }
    }

    /**
     * Broadcast a `dashboard.update` frame to every subscribed dashboard SPA.
     *
     * `kind: 'session.update'` is debounced per-sessionId (200ms) so chatty
     * rrweb chunk appends don't spam every subscriber. Other kinds fire
     * immediately because they represent rare state transitions.
     */
    notifyDashboard(payload: {
        kind: 'session.new' | 'session.update' | 'session.closed' | 'project.update' | 'export.new';
        sessionId?: string;
        projectId?: string;
    }): void {
        if (this.dashboardSubscribers.size === 0) return;
        const debounceKey = payload.kind === 'session.update'
            ? `${payload.kind}:${payload.sessionId ?? ''}`
            : undefined;
        if (debounceKey) {
            const existing = this.dashboardDebounceTimers.get(debounceKey);
            if (existing) clearTimeout(existing);
            const timer = setTimeout(() => {
                this.dashboardDebounceTimers.delete(debounceKey);
                this.flushDashboardUpdate(payload);
            }, 200);
            this.dashboardDebounceTimers.set(debounceKey, timer);
            return;
        }
        this.flushDashboardUpdate(payload);
    }

    private flushDashboardUpdate(payload: {
        kind: 'session.new' | 'session.update' | 'session.closed' | 'project.update' | 'export.new';
        sessionId?: string;
        projectId?: string;
    }): void {
        const frame = {
            type: 'dashboard.update' as const,
            id: randomUUID(),
            kind: payload.kind,
            sessionId: payload.sessionId,
            projectId: payload.projectId,
            ts: Date.now(),
        };
        const json = JSON.stringify(frame);
        for (const sock of this.dashboardSubscribers) {
            try {
                if (sock.isOpen) sock.send(json);
            } catch {
                // Failed sends will be cleaned up on next close event.
            }
        }
    }

    onEvent(listener: EventListener): () => void {
        this.eventListeners.add(listener);
        return () => this.eventListeners.delete(listener);
    }

    /**
     * Handle an HTTP-batch ingest (Edge Runtime path). The gateway terminates
     * the POST /events request and calls this with the parsed hello + events.
     *
     * Stateless: each call is a self-contained hello+events sequence.
     */
    handleHttpBatch(
        hello: HttpBatch['hello'],
        events: HttpBatch['events'],
    ): void {
        const projectId = hello.projectId;
        const sessionId = hello.sessionId ?? `server-orphans:${sanitizeStoreId(projectId)}`;

        // Persist to store if available
        if (this.store) {
            if (hello.displayName !== undefined) {
                try {
                    this.store.upsertProject(projectId, {
                        displayName: hello.displayName,
                    });
                } catch {
                    // ignore cycle / validation errors
                }
            }

            this.store.upsertSession(sessionId, {
                tabId: 'http-batch',
                startedAt: Date.now(),
                participants: [{ projectId, buildId: hello.buildId, joinedAt: Date.now() }],
            });

            for (const ev of events) {
                const evName: string = typeof ev.name === 'string' ? ev.name : 'unknown';
                const evType: string = evName === 'app.log' ? 'app-log' : evName;
                this.store.appendEvent(sessionId, {
                    ts: typeof ev.ts === 'number' ? ev.ts : Date.now(),
                    t: evType,
                    projectId,
                    buildId: ev.buildId ?? hello.buildId,
                    d: ev.payload,
                });
            }
        }

        // Fire event listeners so capability tails observe HTTP-batch events live.
        for (const ev of events) {
            const evName: string = typeof ev.name === 'string' ? ev.name : 'unknown';
            const fullFrame: EventFrame = {
                type: 'event',
                id: ev.id ?? randomUUID(),
                name: evName,
                ts: typeof ev.ts === 'number' ? ev.ts : Date.now(),
                projectId,
                sessionId,
                buildId: ev.buildId ?? hello.buildId,
                payload: ev.payload,
            };
            const syntheticPeer: PeerSession = {
                connectionId: `http:${sessionId}`,
                role: 'node-runtime',
                projectId,
                tabId: undefined,
                sessionId,
                visitorId: undefined,
                userId: hello.userId,
                page: undefined,
                lastActive: Date.now(),
            };
            for (const listener of this.eventListeners) {
                try {
                    listener(fullFrame, syntheticPeer);
                } catch {
                    /* swallow */
                }
            }
        }

        process.stderr.write(
            `[harness-fe] http-batch: project=${projectId}` +
            ` session=${sessionId.slice(0, 8)} events=${events.length}\n`,
        );
    }

    async listTabs(): Promise<TabInfo[]> {
        return this.router.listTabs();
    }

    async listTasks(
        filter: { status?: TaskStatus | 'all'; limit?: number } = {},
    ): Promise<Task[]> {
        const status = filter.status ?? 'pending';
        const limit = filter.limit ?? 50;
        const all = Array.from(this.tasks.values());
        const filtered = status === 'all' ? all : all.filter((t) => t.status === status);
        filtered.sort((a, b) => b.createdAt - a.createdAt);
        return filtered.slice(0, limit);
    }

    async claimTask(id: string, principal?: Principal): Promise<Task | undefined> {
        const task = this.tasks.get(id);
        if (!task) return undefined;
        task.status = 'claimed';
        task.claimedAt = Date.now();
        // Tag which agent picked it up. The per-call principal wins; no-caller
        // falls back to the trusted local principal.
        task.agentId = (principal ?? this.defaultPrincipal).id;
        this.persistTasks();
        this.persistTaskEvent(task, 'task:claim');
        return task;
    }

    async getTaskAttachmentData(taskId: string, attachmentId: string): Promise<string | null> {
        const task = this.tasks.get(taskId);
        if (!task) return null;
        return this.readTaskAttachment(task.projectId, taskId, attachmentId);
    }

    async resolveTask(
        id: string,
        note?: string,
        resolution?: TaskResolution,
        principal?: Principal,
    ): Promise<Task | undefined> {
        const task = this.tasks.get(id);
        if (!task) return undefined;
        task.status = 'resolved';
        task.resolvedAt = Date.now();
        if (note !== undefined) task.note = note;
        if (resolution) {
            // Default verifiedAt when a verification session is supplied without one —
            // verification happened at resolve time.
            const verifiedAt =
                resolution.verificationSessionId !== undefined && resolution.verifiedAt === undefined
                    ? Date.now()
                    : resolution.verifiedAt;
            task.resolution = { ...resolution, ...(verifiedAt !== undefined ? { verifiedAt } : {}) };
        }
        if (!task.agentId) task.agentId = (principal ?? this.defaultPrincipal).id;
        this.persistTasks();
        this.persistTaskEvent(task, 'task:resolve');
        return task;
    }

    private persistTasks(projectId?: string): void {
        if (!this.taskStore) return;
        if (projectId) {
            const projectTasks = Array.from(this.tasks.values()).filter(
                (t) => t.projectId === projectId,
            );
            this.taskStore.saveTasks(projectId, projectTasks);
        } else {
            const byProject = new Map<string, Task[]>();
            for (const task of this.tasks.values()) {
                const pid = task.projectId;
                if (!byProject.has(pid)) byProject.set(pid, []);
                byProject.get(pid)!.push(task);
            }
            for (const [pid, projectTasks] of byProject) {
                this.taskStore.saveTasks(pid, projectTasks);
            }
        }
    }

    /**
     * Load tasks for a specific project from the task store into the in-memory
     * map. Called when a project connects so its tasks are available immediately.
     */
    private loadTasksForProject(projectId: string): void {
        if (!this.taskStore) return;
        const projectTasks = this.taskStore.loadTasks(projectId);
        for (const task of projectTasks) {
            if (task && typeof task.id === 'string') {
                this.tasks.set(task.id, task);
            }
        }
    }

    private taskDedupKey(tabId: string, payload: { question: string; selector: { css?: string; comp?: string; loc?: string } }): string {
        const sel = payload.selector;
        const selKey = sel.loc ?? sel.comp ?? sel.css ?? '';
        return `${tabId}::${selKey}::${payload.question.trim()}`;
    }

    private persistTaskEvent(task: Task, eventType: string): void {
        if (!this.store) return;
        const sessions = this.store.listSessions({ projectId: task.projectId, limit: 1 });
        const sessionId = sessions[0]?.id;
        if (!sessionId) return;
        this.store.appendEvent(sessionId, {
            ts: Date.now(),
            t: eventType,
            tab: task.tabId,
            load: task.sessionId,
            d: {
                id: task.id,
                status: task.status,
                question: task.question,
                note: task.note,
                ...(task.resolution ? { resolution: task.resolution } : {}),
            },
        });
    }

    private recordTask(frame: EventFrame, peer: PeerSession): void {
        const parsed = taskSubmitPayloadSchema.safeParse(frame.payload);
        if (!parsed.success) return;
        const tabId = peer.tabId ?? frame.tabId ?? 'unknown';
        // Dedup: collapse a fresh submit onto an existing pending task with
        // identical tab + selector + question.
        const dedupKey = this.taskDedupKey(tabId, parsed.data);
        for (const existing of this.tasks.values()) {
            if (existing.status !== 'pending') continue;
            if (this.taskDedupKey(existing.tabId, existing) !== dedupKey) continue;
            existing.createdAt = frame.ts ?? Date.now();
            existing.element = parsed.data.element;
            existing.url = parsed.data.url;
            this.persistTasks();
            return;
        }
        const id = randomUUID().slice(0, 10);
        const projectId = peer.projectId ?? frame.projectId ?? 'unknown';

        let persistedAttachments: TaskAttachment[] | undefined;
        if (parsed.data.attachments && parsed.data.attachments.length > 0) {
            persistedAttachments = this.writeTaskAttachments(projectId, id, parsed.data.attachments);
        }

        const task: Task = {
            id,
            tabId,
            sessionId: peer.sessionId,
            visitorId: peer.visitorId,
            userId: peer.userId,
            projectId,
            url: parsed.data.url,
            status: 'pending',
            question: parsed.data.question,
            selector: parsed.data.selector,
            element: parsed.data.element,
            createdAt: frame.ts ?? Date.now(),
            attachments: persistedAttachments,
        };
        this.tasks.set(id, task);
        if (this.tasks.size > TASK_QUEUE_CAP) {
            const oldest = this.tasks.keys().next().value;
            if (oldest !== undefined) this.tasks.delete(oldest);
        }
        this.persistTasks();
    }

    /**
     * Write attachment data to disk and return persisted pointer objects.
     * Drops attachments if the total decoded size exceeds 4 MB.
     */
    private writeTaskAttachments(projectId: string, taskId: string, attachments: TaskAttachment[]): TaskAttachment[] {
        const MAX_BYTES = 4 * 1024 * 1024;
        const result: TaskAttachment[] = [];

        let totalBytes = 0;
        const buffers: Buffer[] = [];
        for (const att of attachments) {
            if (!att.data) continue;
            try {
                const buf = Buffer.from(att.data, 'base64');
                totalBytes += buf.length;
                buffers.push(buf);
            } catch {
                buffers.push(Buffer.alloc(0));
            }
        }

        if (totalBytes > MAX_BYTES) {
            process.stderr.write(
                `[harness-fe] task ${taskId}: attachments total ${(totalBytes / 1024 / 1024).toFixed(2)} MB exceeds 4 MB limit — dropping attachments\n`,
            );
            return [];
        }

        const attachDir = joinPath(this.attachDataDir, 'projects', sanitizeStoreId(projectId), 'task-attachments', taskId);
        try {
            mkdirSync(attachDir, { recursive: true });
        } catch {
            return [];
        }

        let bufIdx = 0;
        for (const att of attachments) {
            if (!att.data) {
                bufIdx++;
                continue;
            }
            const buf = buffers[bufIdx++];
            if (!buf || buf.length === 0) continue;
            const filePath = joinPath(attachDir, `${att.id}.png`);
            try {
                writeFileSync(filePath, buf);
                const relPath = `task-attachments/${taskId}/${att.id}.png`;
                result.push({
                    id: att.id,
                    kind: att.kind,
                    width: att.width,
                    height: att.height,
                    path: relPath,
                    // data is intentionally omitted — tasks.json stays small
                });
            } catch (err) {
                process.stderr.write(
                    `[harness-fe] failed to write attachment ${att.id}: ${err instanceof Error ? err.message : String(err)}\n`,
                );
            }
        }
        return result;
    }

    /**
     * Read an attachment from disk for a given task. Returns the base64 data if
     * found, null otherwise.
     */
    readTaskAttachment(projectId: string, taskId: string, attachmentId: string): string | null {
        const filePath = joinPath(
            this.attachDataDir,
            'projects',
            sanitizeStoreId(projectId),
            'task-attachments',
            taskId,
            `${attachmentId}.png`,
        );
        if (!existsSync(filePath)) return null;
        try {
            const buf = readFileSync(filePath);
            return buf.toString('base64');
        } catch {
            return null;
        }
    }

    /**
     * Send a command to a specific tab and await its response.
     * `tabId` falls back to the most-recent active tab if omitted.
     */
    async sendCommand(
        command: string,
        args: unknown,
        opts: SendCommandOptions = {},
    ): Promise<unknown> {
        const target = opts.target ?? 'runtime-client';
        // Command-target scoping: explicit opts.principal wins, else the ambient
        // caller. undefined ⇒ no scoping, original behaviour.
        const principal = opts.principal ?? currentCaller();
        const session =
            target === 'vite-plugin'
                ? this.router.findVitePlugin(opts.projectId)
                : this.router.findTab(opts.tabId, principal);
        if (!session) {
            throw new Error(
                target === 'vite-plugin'
                    ? 'bridge: no vite-plugin connected. Start the dev server first.'
                    : opts.tabId
                      ? `bridge: no runtime-client connected for tabId="${opts.tabId}"`
                      : 'bridge: no runtime-client connected. Open the dev page first.',
            );
        }
        const socket = this.sockets.get(session.connectionId);
        if (!socket || !socket.isOpen) {
            throw new Error('bridge: target socket is not open');
        }

        const id = randomUUID();
        const cmdTs = Date.now();
        const frame: CommandFrame = {
            type: 'command',
            id,
            tabId: session.tabId,
            command,
            args,
        };

        // Persist command to store — runtime-client connections store a sessionId.
        const storeId = this.connToStoreId.get(session.connectionId);
        const storeSessionId = (session.role === 'runtime-client') ? storeId : undefined;
        if (this.store && storeSessionId) {
            this.store.appendEvent(storeSessionId, {
                ts: cmdTs, t: 'cmd', tab: session.tabId,
                d: { id, command, args, target },
            });
        }

        const timeoutMs = opts.timeoutMs ?? COMMAND_TIMEOUT_MS;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                if (this.store && storeSessionId) {
                    this.store.appendEvent(storeSessionId, {
                        ts: Date.now(), t: 'resp', tab: session.tabId,
                        d: { id, ok: false, error: `timeout after ${timeoutMs}ms`, durationMs: timeoutMs },
                    });
                }
                reject(new Error(`bridge: command "${command}" timed out after ${timeoutMs}ms`));
            }, timeoutMs);
            this.pending.set(id, {
                resolve: (result) => {
                    if (this.store && storeSessionId) {
                        const safeResult = stripLargePayloads(result);
                        this.store.appendEvent(storeSessionId, {
                            ts: Date.now(), t: 'resp', tab: session.tabId,
                            d: { id, ok: true, result: safeResult, durationMs: Date.now() - cmdTs },
                        });
                    }
                    resolve(result);
                },
                reject: (err) => {
                    if (this.store && storeSessionId) {
                        this.store.appendEvent(storeSessionId, {
                            ts: Date.now(), t: 'resp', tab: session.tabId,
                            d: { id, ok: false, error: err.message, durationMs: Date.now() - cmdTs },
                        });
                    }
                    reject(err);
                },
                timer,
            });
            try {
                socket.send(JSON.stringify(frame));
            } catch (err) {
                clearTimeout(timer);
                this.pending.delete(id);
                reject(err as Error);
            }
        });
    }

    /**
     * Accept a peer connection. The gateway resolves the caller's identity and
     * adapts the transport to {@link PeerSocket} before calling this — core
     * never sees the raw socket or the auth handshake.
     */
    acceptPeer(socket: PeerSocket, principal: Principal = LOCAL_PRINCIPAL): void {
        const connectionId = randomUUID();
        this.sockets.set(connectionId, socket);
        this.connToPrincipal.set(connectionId, principal);

        socket.onMessage((raw) => {
            let parsed: unknown;
            try {
                parsed = JSON.parse(raw);
            } catch {
                return; // ignore non-JSON
            }
            const frame = frameSchema.safeParse(parsed);
            if (!frame.success) return;
            this.handleFrame(connectionId, socket, frame.data);
        });

        socket.onClose(() => {
            this.sockets.delete(connectionId);
            this.warnedNoSession.delete(connectionId);
            this.dashboardSubscribers.delete(socket);
            const storeId = this.connToStoreId.get(connectionId);
            if (storeId && this.store) {
                const peer = this.router.getByConnectionId(connectionId);
                if (peer?.role === 'runtime-client' && peer.tabId) {
                    this.store.closeSession(storeId);
                    this.store.closeTab(peer.tabId);
                    this.connToStoreId.delete(connectionId);
                    this.notifyDashboard({
                        kind: 'session.closed',
                        sessionId: storeId,
                        projectId: peer.projectId,
                    });
                } else if (peer?.role === 'vite-plugin' || peer?.role === 'webpack-plugin') {
                    const projectId = peer.projectId;
                    if (projectId) {
                        const closedAt = Date.now();
                        this.pendingEndBuild.set(projectId, { buildId: storeId, closedAt });
                        const timer = setTimeout(() => {
                            this.graceTimers.delete(projectId);
                            const pending = this.pendingEndBuild.get(projectId);
                            if (pending && pending.buildId === storeId) {
                                this.pendingEndBuild.delete(projectId);
                                this.store?.closeBuild(storeId, pending.closedAt);
                            }
                        }, 30_000);
                        this.graceTimers.set(projectId, timer);
                    } else {
                        this.store.closeBuild(storeId);
                    }
                    this.connToStoreId.delete(connectionId);
                }
            }
            this.router.unregister(connectionId);
            this.connToPrincipal.delete(connectionId);
        });
    }

    private handleFrame(connectionId: string, socket: PeerSocket, frame: Frame): void {
        switch (frame.type) {
            case 'hello': {
                // Dashboard-client is a read-only subscriber — it never sends
                // commands or events. Skip router/session setup; register for
                // broadcast and ack.
                if (frame.role === 'dashboard-client') {
                    this.dashboardSubscribers.add(socket);
                    const ack: HelloAckFrame = {
                        type: 'hello.ack',
                        id: frame.id,
                        serverVersion: PROTOCOL_VERSION,
                    };
                    try { socket.send(JSON.stringify(ack)); } catch { /* swallow */ }
                    return;
                }

                // Runtime-client MUST carry a sessionId so every emitted event is
                // attributable to a specific page load.
                if (frame.role === 'runtime-client' && !frame.sessionId) {
                    console.warn(
                        '[harness-fe] rejecting runtime-client hello — missing sessionId',
                        { projectId: frame.projectId, tabId: frame.tabId },
                    );
                    const errorAck: HelloAckFrame = {
                        type: 'hello.ack',
                        id: frame.id,
                        serverVersion: PROTOCOL_VERSION,
                        error: 'runtime-client hello missing sessionId',
                    };
                    socket.send(JSON.stringify(errorAck));
                    return;
                }

                const principal = this.connToPrincipal.get(connectionId) ?? LOCAL_PRINCIPAL;
                const session = this.router.register({
                    role: frame.role,
                    projectId: frame.projectId,
                    tabId: frame.tabId,
                    sessionId: frame.sessionId,
                    visitorId: frame.visitorId,
                    userId: frame.userId,
                    connectionId,
                    page: frame.page,
                    principal,
                });
                if (this.store) {
                    if (
                        frame.parentProjectId !== undefined ||
                        frame.displayName !== undefined
                    ) {
                        try {
                            this.store.upsertProject(frame.projectId, {
                                parentProjectId: frame.parentProjectId,
                                displayName: frame.displayName,
                                createdBy: principal.id,
                            });
                        } catch (err) {
                            console.warn(
                                '[harness-fe] upsertProject failed:',
                                err instanceof Error ? err.message : err,
                            );
                        }
                    }
                    if (frame.buildId && frame.role === 'runtime-client') {
                        this.store.upsertBuild(frame.projectId, frame.buildId, {
                            bundler: undefined,
                        });
                    }
                    if (frame.visitorId && frame.role === 'runtime-client') {
                        try {
                            this.store.upsertVisitor(frame.visitorId, {
                                userId: frame.userId,
                                incrementSession: true,
                                addTabId: frame.tabId,
                                addProjectId: frame.projectId,
                                lastEnv: frame.env,
                            });
                        } catch (err) {
                            console.warn(
                                '[harness-fe] upsertVisitor failed:',
                                err instanceof Error ? err.message : err,
                            );
                        }
                    }

                    if (frame.role === 'vite-plugin' || frame.role === 'webpack-plugin') {
                        const projectId = frame.projectId;
                        const pendingTimer = projectId ? this.graceTimers.get(projectId) : undefined;
                        const pendingBuild = projectId ? this.pendingEndBuild.get(projectId) : undefined;
                        if (pendingTimer !== undefined && pendingBuild !== undefined && projectId) {
                            clearTimeout(pendingTimer);
                            this.graceTimers.delete(projectId);
                            this.pendingEndBuild.delete(projectId);
                            this.connToStoreId.set(connectionId, pendingBuild.buildId);
                        } else {
                            const buildId = this.store.openBuild(frame.projectId, {
                                bundler: frame.role === 'vite-plugin' ? 'vite' : 'webpack',
                            });
                            this.connToStoreId.set(connectionId, buildId);
                        }
                    } else if (frame.role === 'runtime-client' && frame.tabId) {
                        const sessionId = frame.sessionId ?? randomUUID();
                        this.store.upsertTab(frame.tabId, {
                            connectedAt: Date.now(),
                            userAgent: frame.page?.userAgent,
                        });
                        const participants: Array<{ projectId: string; buildId?: string; joinedAt: number }> = [
                            { projectId: frame.projectId, buildId: frame.buildId, joinedAt: Date.now() },
                        ];
                        const sessionExisted = this.store.getSession(sessionId) !== undefined;
                        this.store.upsertSession(sessionId, {
                            tabId: frame.tabId,
                            startedAt: Date.now(),
                            url: frame.page?.url,
                            title: frame.page?.title,
                            referrer: undefined,
                            userAgent: frame.page?.userAgent,
                            participants,
                            createdBy: principal.id,
                        });
                        this.connToStoreId.set(connectionId, sessionId);
                        this.notifyDashboard({
                            kind: sessionExisted ? 'session.update' : 'session.new',
                            sessionId,
                            projectId: frame.projectId,
                        });
                    } else if (frame.role === 'node-runtime') {
                        const sessionId = frame.sessionId
                            ?? `server-orphans:${sanitizeStoreId(frame.projectId)}`;
                        if (!frame.sessionId) {
                            this.store.upsertSession(sessionId, {
                                tabId: 'server-orphans',
                                startedAt: Date.now(),
                                participants: [{ projectId: frame.projectId, joinedAt: Date.now() }],
                            });
                        }
                        this.connToStoreId.set(connectionId, sessionId);
                    }
                }
                // If store is null but taskStore is available, load tasks for build
                // plugins and node-runtime so capability tasks serve from both.
                if (!this.store && this.taskStore && (
                    frame.role === 'vite-plugin' ||
                    frame.role === 'webpack-plugin' ||
                    frame.role === 'node-runtime'
                )) {
                    const projectId = frame.projectId;
                    if (projectId) this.loadTasksForProject(projectId);
                }
                const ack: HelloAckFrame = {
                    type: 'hello.ack',
                    id: frame.id,
                    tabId: session.tabId,
                    serverVersion: PROTOCOL_VERSION,
                    consent: this.consentPolicy,
                };
                socket.send(JSON.stringify(ack));
                process.stderr.write(
                    `[harness-fe] peer connected: role=${frame.role} project=${frame.projectId}` +
                    `${frame.tabId ? ` tab=${frame.tabId.slice(0, 8)}` : ''}` +
                    `${frame.sessionId ? ` load=${frame.sessionId.slice(0, 8)}` : ''}\n`,
                );
                break;
            }
            case 'response': {
                const pending = this.pending.get(frame.id);
                if (!pending) return; // late response or unknown; drop
                clearTimeout(pending.timer);
                this.pending.delete(frame.id);
                if (frame.ok) pending.resolve(frame.result);
                else
                    pending.reject(
                        new Error(frame.error?.message ?? 'unknown bridge error'),
                    );
                break;
            }
            case 'event': {
                this.router.touch(connectionId);
                const peer = this.router.getByConnectionId(connectionId);
                if (!peer) return;
                if (frame.name === EVENT_NAME.TASK_SUBMIT) {
                    this.recordTask(frame, peer);
                }
                if (this.store) {
                    const storeId = this.connToStoreId.get(connectionId);
                    let storeSessionId: string | undefined;
                    if (peer.role === 'runtime-client' || peer.role === 'node-runtime') {
                        storeSessionId = storeId;
                    } else if (storeId) {
                        const sessions = this.store.listSessions({ projectId: peer.projectId, limit: 1 });
                        storeSessionId = sessions[0]?.id;
                    }

                    if (!storeSessionId) {
                        if (!this.warnedNoSession.has(connectionId)) {
                            this.warnedNoSession.add(connectionId);
                            console.warn(
                                '[harness-fe] dropping event — no store session for connection',
                                { projectId: peer.projectId, role: peer.role, eventName: frame.name },
                            );
                        }
                    }
                    if (storeSessionId) {
                        const tabId = frame.tabId ?? peer.tabId;
                        const projectId = peer.projectId;
                        const buildId = (peer.role === 'vite-plugin' || peer.role === 'webpack-plugin')
                            ? storeId
                            : (frame.buildId ?? undefined);
                        const visitorId = frame.visitorId ?? peer.visitorId;

                        if (frame.name === EVENT_NAME.PAGE_LOAD && tabId) {
                            const parsed = pageLoadPayloadSchema.safeParse(frame.payload);
                            const ts = frame.ts ?? Date.now();
                            const page = parsed.success ? parsed.data.page : undefined;
                            const viewport = parsed.success ? parsed.data.viewport : undefined;
                            const storageData = parsed.success ? parsed.data.storage : undefined;
                            this.store.upsertSession(storeSessionId, {
                                tabId: tabId,
                                startedAt: ts,
                                url: page?.url ?? peer.page?.url,
                                title: page?.title ?? peer.page?.title,
                                referrer: page?.referrer,
                                userAgent: page?.userAgent ?? peer.page?.userAgent,
                                initial: {
                                    viewport,
                                    storageKeys: storageData
                                        ? {
                                            local: storageData.local ? Object.keys(storageData.local).length : 0,
                                            session: storageData.session ? Object.keys(storageData.session).length : 0,
                                            cookie: storageData.cookie ? storageData.cookie.length : 0,
                                        }
                                        : undefined,
                                    storageTruncated: storageData?.truncated,
                                },
                            });
                            this.store.appendEvent(storeSessionId, {
                                ts, t: 'load', tab: tabId,
                                projectId, buildId, visitorId,
                                d: frame.payload,
                            });
                        } else if (frame.name === EVENT_NAME.RRWEB && tabId) {
                            const parsed = rrwebChunkPayloadSchema.safeParse(frame.payload);
                            if (parsed.success) {
                                this.store.appendRecording(storeSessionId, parsed.data);
                                this.notifyDashboard({
                                    kind: 'session.update',
                                    sessionId: storeSessionId,
                                    projectId,
                                });
                                this.store.appendEvent(storeSessionId, {
                                    ts: frame.ts ?? Date.now(),
                                    t: 'rrweb',
                                    tab: tabId,
                                    projectId,
                                    buildId,
                                    visitorId,
                                    d: {
                                        chunkId: parsed.data.chunkId,
                                        startTs: parsed.data.startTs,
                                        endTs: parsed.data.endTs,
                                        eventCount: parsed.data.eventCount,
                                    },
                                });
                            }
                        } else {
                            const eventType: string = frame.name === 'app.log' ? 'app-log' : frame.name as string;
                            this.store.appendEvent(storeSessionId, {
                                ts: frame.ts ?? Date.now(),
                                t: eventType,
                                tab: tabId,
                                projectId,
                                buildId,
                                visitorId,
                                d: frame.payload,
                            });
                        }
                        const marker = deriveRecordingMarker(frame, tabId);
                        if (marker) {
                            this.store.appendEvent(storeSessionId, {
                                ts: frame.ts ?? Date.now(),
                                t: 'rrweb:marker',
                                tab: tabId,
                                projectId,
                                buildId,
                                d: marker,
                            });
                        }
                    }
                }
                for (const listener of this.eventListeners) {
                    try {
                        listener(frame, peer);
                    } catch {
                        /* swallow listener errors */
                    }
                }
                break;
            }
            case 'query': {
                void this.handleQuery(socket, connectionId, frame);
                break;
            }
            case 'hello.ack':
            case 'command':
            case 'mcp.call':
            case 'mcp.return':
            case 'query.response':
                // core does not act on these inbound from a peer; ignore.
                break;
        }
    }

    /**
     * Runtime → core query dispatcher. Whitelisted methods only. Owner check:
     * tasks.update / tasks.get / tasks.delete refuse to touch tasks whose
     * `visitorId` doesn't match the caller's `peer.visitorId`.
     */
    private async handleQuery(socket: PeerSocket, connectionId: string, frame: QueryFrame): Promise<void> {
        const reply = (body: Omit<QueryResponseFrame, 'type' | 'id'>): void => {
            if (!socket.isOpen) return;
            const out: QueryResponseFrame = { type: 'query.response', id: frame.id, ...body };
            try { socket.send(JSON.stringify(out)); } catch { /* swallow */ }
        };
        const peer = this.router.getByConnectionId(connectionId);
        if (!peer) {
            reply({ ok: false, error: { code: 'unauthenticated', message: 'no peer for connection' } });
            return;
        }
        if (peer.role !== 'runtime-client' || !peer.visitorId) {
            reply({ ok: false, error: { code: 'forbidden', message: 'only runtime-client with visitorId may query' } });
            return;
        }
        if (!this.taskStore) {
            reply({ ok: false, error: { code: 'unavailable', message: 'no task store' } });
            return;
        }
        const projectId = peer.projectId;
        const callerVisitor = peer.visitorId;

        try {
            switch (frame.method) {
                case 'tasks.mine': {
                    const args = (frame.args ?? {}) as { status?: string; limit?: number };
                    const all = this.taskStore.loadTasks(projectId);
                    let mine = all.filter((t) => t.visitorId === callerVisitor);
                    if (args.status) mine = mine.filter((t) => t.status === args.status);
                    mine.sort((a, b) => b.createdAt - a.createdAt);
                    if (args.limit) mine = mine.slice(0, args.limit);
                    const MAX_INLINE = 200 * 1024; // base64 chars
                    const withThumbs = mine.map((t) => {
                        if (!t.attachments || t.attachments.length === 0) return t;
                        const first = t.attachments[0];
                        if (!first.path) return t;
                        const b64 = this.readTaskAttachment(t.projectId, t.id, first.id);
                        if (!b64 || b64.length > MAX_INLINE) return t;
                        const inlined = { ...first, data: b64 };
                        return { ...t, attachments: [inlined, ...t.attachments.slice(1)] };
                    });
                    reply({ ok: true, result: { tasks: withThumbs } });
                    return;
                }
                case 'tasks.get': {
                    const args = (frame.args ?? {}) as { id?: string };
                    if (!args.id) {
                        reply({ ok: false, error: { code: 'bad_request', message: 'id required' } });
                        return;
                    }
                    const task = this.taskStore.loadTasks(projectId).find((t) => t.id === args.id);
                    if (!task) {
                        reply({ ok: false, error: { code: 'not_found', message: `no task ${args.id}` } });
                        return;
                    }
                    if (task.visitorId !== callerVisitor) {
                        reply({ ok: false, error: { code: 'forbidden', message: 'not your task' } });
                        return;
                    }
                    reply({ ok: true, result: { task } });
                    return;
                }
                case 'tasks.update': {
                    const args = (frame.args ?? {}) as { id?: string; question?: string };
                    if (!args.id || typeof args.question !== 'string') {
                        reply({ ok: false, error: { code: 'bad_request', message: 'id + question required' } });
                        return;
                    }
                    const tasks = this.taskStore.loadTasks(projectId);
                    const idx = tasks.findIndex((t) => t.id === args.id);
                    if (idx === -1) {
                        reply({ ok: false, error: { code: 'not_found', message: `no task ${args.id}` } });
                        return;
                    }
                    if (tasks[idx].visitorId !== callerVisitor) {
                        reply({ ok: false, error: { code: 'forbidden', message: 'not your task' } });
                        return;
                    }
                    tasks[idx] = { ...tasks[idx], question: args.question.trim(), updatedAt: Date.now() };
                    this.taskStore.saveTasks(projectId, tasks);
                    reply({ ok: true, result: { task: tasks[idx] } });
                    return;
                }
                case 'tasks.delete': {
                    const args = (frame.args ?? {}) as { id?: string };
                    if (!args.id) {
                        reply({ ok: false, error: { code: 'bad_request', message: 'id required' } });
                        return;
                    }
                    const tasks = this.taskStore.loadTasks(projectId);
                    const target = tasks.find((t) => t.id === args.id);
                    if (!target) {
                        reply({ ok: false, error: { code: 'not_found', message: `no task ${args.id}` } });
                        return;
                    }
                    if (target.visitorId !== callerVisitor) {
                        reply({ ok: false, error: { code: 'forbidden', message: 'not your task' } });
                        return;
                    }
                    const remaining = tasks.filter((t) => t.id !== args.id);
                    this.taskStore.saveTasks(projectId, remaining);
                    this.tasks.delete(args.id);
                    reply({ ok: true, result: { deleted: args.id } });
                    return;
                }
                default:
                    reply({ ok: false, error: { code: 'unknown_method', message: `unknown query method` } });
            }
        } catch (err) {
            reply({
                ok: false,
                error: { code: 'internal', message: err instanceof Error ? err.message : String(err) },
            });
        }
    }
}

function deriveRecordingMarker(frame: EventFrame, tabId?: string): Record<string, unknown> | undefined {
    if (!tabId) return undefined;

    if (frame.name === 'error') {
        const payload = frame.payload as { message?: unknown; source?: unknown } | undefined;
        return {
            markerId: `rrm_${frame.id}`,
            kind: 'error',
            ts: frame.ts,
            tabId,
            label: typeof payload?.message === 'string' ? payload.message : 'Runtime error',
            relatedEventType: 'error',
            source: typeof payload?.source === 'string' ? payload.source : undefined,
        };
    }

    if (frame.name === 'network') {
        const payload = frame.payload as { status?: unknown; method?: unknown; url?: unknown } | undefined;
        const status = typeof payload?.status === 'number' ? payload.status : undefined;
        if (status === undefined || (status > 0 && status < 400)) return undefined;
        const method = typeof payload?.method === 'string' ? payload.method : 'REQUEST';
        const url = typeof payload?.url === 'string' ? payload.url : 'unknown URL';
        return {
            markerId: `rrm_${frame.id}`,
            kind: 'network',
            ts: frame.ts,
            tabId,
            label: `${method} ${url} -> ${status ?? 'ERR'}`,
            relatedEventType: 'network',
            status,
        };
    }

    if (frame.name === 'console') {
        const payload = frame.payload as { level?: unknown; args?: unknown } | undefined;
        if (payload?.level !== 'error') return undefined;
        const firstArg = Array.isArray(payload.args) ? payload.args[0] : undefined;
        return {
            markerId: `rrm_${frame.id}`,
            kind: 'console',
            ts: frame.ts,
            tabId,
            label: typeof firstArg === 'string' ? firstArg : 'console.error',
            relatedEventType: 'console',
        };
    }

    if (frame.name === EVENT_NAME.TASK_SUBMIT) {
        const parsed = taskSubmitPayloadSchema.safeParse(frame.payload);
        if (!parsed.success) return undefined;
        return {
            markerId: `rrm_${frame.id}`,
            kind: 'task',
            ts: frame.ts,
            tabId,
            label: parsed.data.question,
            relatedEventType: EVENT_NAME.TASK_SUBMIT,
        };
    }

    return undefined;
}

/**
 * Strip large binary payloads (e.g. screenshot dataUrls) from command results
 * before persisting to the store, to avoid bloating timeline files.
 */
function stripLargePayloads(value: unknown): unknown {
    if (typeof value === 'string' && value.startsWith('data:') && value.length > 1024) {
        return '[large data url omitted]';
    }
    if (value !== null && typeof value === 'object') {
        const result: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
            result[k] = stripLargePayloads(v);
        }
        return result;
    }
    return value;
}
