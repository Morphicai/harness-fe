/**
 * WS bridge — accepts connections from vite-plugin and runtime-client.
 *
 * Protocol: see @harnessa-fe/protocol.
 *
 * Responsibilities:
 *   - Handshake: `hello` frame → register peer in SessionRouter, reply `hello.ack`
 *   - sendCommand(): forward a CommandFrame to the target tab, return a
 *     Promise that resolves when the matching ResponseFrame arrives
 *   - onEvent(): broadcast event frames to subscribers (mcp tools / future
 *     recorder)
 */

import { WebSocket, WebSocketServer } from 'ws';
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http';
import { join as joinPath } from 'node:path';
import { homedir } from 'node:os';
import {
    DEFAULT_WS_PORT,
    EVENT_NAME,
    PROTOCOL_VERSION,
    pageLoadPayloadSchema,
    rrwebChunkPayloadSchema,
    taskSubmitPayloadSchema,
    type CommandFrame,
    type EventFrame,
    type Frame,
    type HelloAckFrame,
    type McpCallFrame,
    type McpReturnFrame,
    type TabInfo,
    type Task,
    type TaskStatus,
    frameSchema,
} from '@harnessa-fe/protocol';
import { SessionRouter, type PeerSession } from './sessionRouter.js';
import { createReplayHandler } from './replayViewer.js';
import { createDashboardHandler } from './dashboard.js';
import {
    JsonlStore,
    JsonTaskStore,
    JsonMemoryStore,
    type IStore,
    type ITaskStore,
    type IMemoryStore,
    type RetentionPolicy,
} from './store/index.js';

/**
 * Surface used by the stdio MCP layer. Same shape whether the underlying
 * implementation is an in-process `Bridge` (leader) or a `RemoteBridge`
 * proxying over WS to another daemon (follower).
 *
 * All methods are async so the same call site works in both modes.
 */
export interface IBridge {
    sendCommand(
        command: string,
        args: unknown,
        opts?: SendCommandOptions,
    ): Promise<unknown>;
    listTabs(): Promise<TabInfo[]>;
    listTasks(filter?: { status?: TaskStatus | 'all'; limit?: number }): Promise<Task[]>;
    claimTask(id: string): Promise<Task | undefined>;
    resolveTask(id: string, note?: string): Promise<Task | undefined>;
    getMemoryStore(): IMemoryStore;
    /**
     * Base URL (e.g. http://127.0.0.1:47729) where the replay viewer is reachable.
     * Returns undefined when the bridge does not serve HTTP (e.g. follower mode).
     */
    getViewerBaseUrl(): string | undefined;
}

export interface SendCommandOptions {
    tabId?: string;
    timeoutMs?: number;
    target?: 'runtime-client' | 'vite-plugin';
    projectId?: string;
}

const COMMAND_TIMEOUT_MS = 30_000;
const TASK_QUEUE_CAP = 200;

/** Default data directory for all persistence stores. */
const DEFAULT_DATA_DIR = joinPath(homedir(), '.harnessa', 'data');

interface PendingCommand {
    resolve(payload: unknown): void;
    reject(err: Error): void;
    timer: NodeJS.Timeout;
}

export interface BridgeOptions {
    port?: number;
    /** Bind address. Default 127.0.0.1 (no remote exposure). */
    host?: string;
    /**
     * Store instance for JSONL persistence. If omitted, a default JsonlStore
     * is created at ~/.harnessa/data. Pass null to disable persistence.
     */
    store?: IStore | null;
    /**
     * Task store instance for JSON task persistence. If omitted, a default
     * JsonTaskStore is created at ~/.harnessa/data. Pass null to disable
     * task persistence (useful in tests).
     */
    taskStore?: ITaskStore | null;
    /**
     * Memory store instance for agent memory persistence. If omitted, a default
     * JsonMemoryStore is created at ~/.harnessa/data. Pass null to disable
     * memory persistence (useful in tests).
     */
    memoryStore?: IMemoryStore | null;
    /**
     * Automatic retention policy enforcement.
     *
     * Without this, manual `session.purge` MCP calls are the only thing that
     * trims the on-disk store — so a long-running daemon will eventually fill
     * the user's disk. Default: run `store.purge()` once shortly after start
     * and every hour thereafter. Set `enabled: false` for tests / one-shot runs.
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

export class Bridge implements IBridge {
    readonly router = new SessionRouter();
    readonly store: IStore | null;
    readonly taskStore: ITaskStore | null;
    readonly memoryStore: IMemoryStore;
    private wss?: WebSocketServer;
    private httpServer?: HttpServer;
    /**
     * Optional HTTP handler invoked for non-WebSocket requests. Set via
     * `setHttpHandler()`. Allows higher layers (e.g. replay viewer) to serve
     * routes on the same port as the WS bridge without coupling Bridge to them.
     */
    private httpHandler?: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
    private sockets = new Map<string, WebSocket>();
    private pending = new Map<string, PendingCommand>();
    private eventListeners = new Set<EventListener>();
    private tasks = new Map<string, Task>();
    private opts: Required<Omit<BridgeOptions, 'store' | 'taskStore' | 'memoryStore' | 'autoPurge'>>;
    private autoPurgeOpts: Required<NonNullable<BridgeOptions['autoPurge']>>;
    /** Set by start() when auto-purge is enabled; cleared by stop(). */
    private autoPurgeTimer?: NodeJS.Timeout;
    /**
     * Map from connectionId → buildId (for build-plugin connections)
     * or sessionId (for runtime-client connections).
     */
    private connToStoreId = new Map<string, string>();
    /** Connections that already logged a "no store session" warning. */
    private warnedNoSession = new Set<string>();
    /**
     * Grace period timers: projectId → timer handle.
     * When a build plugin disconnects, a 30-second timer is started.
     * If the same project reconnects within that window, the timer is cancelled.
     */
    private graceTimers = new Map<string, NodeJS.Timeout>();
    /**
     * Pending build end info: projectId → { buildId, closedAt }.
     * Tracks builds waiting for the grace period to expire.
     */
    private pendingEndBuild = new Map<string, { buildId: string; closedAt: number }>();

    constructor(opts: BridgeOptions = {}) {
        this.store = opts.store === null ? null : (opts.store ?? new JsonlStore());
        this.taskStore = opts.taskStore === null ? null : (opts.taskStore ?? new JsonTaskStore(DEFAULT_DATA_DIR));
        this.memoryStore = opts.memoryStore === null
            ? new JsonMemoryStore(DEFAULT_DATA_DIR)
            : (opts.memoryStore ?? new JsonMemoryStore(DEFAULT_DATA_DIR));
        this.opts = {
            port: opts.port ?? DEFAULT_WS_PORT,
            host: opts.host ?? '127.0.0.1',
        };
        // Default auto-purge ON. CI / tests pass `enabled: false` (or set
        // env HARNESSA_FE_PURGE_DISABLED=1) to opt out.
        const envDisabled = process.env.HARNESSA_FE_PURGE_DISABLED === '1';
        this.autoPurgeOpts = {
            enabled: opts.autoPurge?.enabled ?? !envDisabled,
            intervalMs: opts.autoPurge?.intervalMs ?? 60 * 60 * 1000,
            policy: opts.autoPurge?.policy ?? {},
            skipInitial: opts.autoPurge?.skipInitial ?? false,
        };
        this.loadTasks();

        // Auto-install dashboard + replay viewer HTTP handlers when a store is present.
        if (this.store) {
            const store = this.store;
            const replay = createReplayHandler(store);
            const dashboard = createDashboardHandler(store, () => this.getViewerBaseUrl());
            this.setHttpHandler(async (req, res) => {
                if (replay(req, res)) return;
                if (await dashboard(req, res)) return;
                res.statusCode = 404;
                res.setHeader('content-type', 'text/plain; charset=utf-8');
                res.end('Not Found');
            });
        }
    }

    /**
     * Returns the memory store instance for use by mcp.ts and other callers.
     */
    getMemoryStore(): IMemoryStore {
        return this.memoryStore;
    }

    private loadTasks(): void {
        // Tasks are loaded lazily per-project when a project connects.
        // See loadTasksForProject() which is called in handleFrame on hello.
    }

    private persistTasks(projectId?: string): void {
        if (!this.taskStore) return;
        if (projectId) {
            // Save only the tasks for the given project
            const projectTasks = Array.from(this.tasks.values()).filter(
                (t) => t.projectId === projectId,
            );
            this.taskStore.saveTasks(projectId, projectTasks);
        } else {
            // Group all tasks by projectId and save each group
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
     * Load tasks for a specific project from the task store into the in-memory map.
     * Called when a project connects so its tasks are available immediately.
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

    /**
     * Register an HTTP request handler that runs for non-WebSocket requests on
     * the same port. Only one handler is supported; later calls replace prior
     * ones. WS upgrades bypass this handler.
     */
    setHttpHandler(handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>): void {
        this.httpHandler = handler;
    }

    async start(): Promise<void> {
        await new Promise<void>((resolve, reject) => {
            const httpServer = createServer((req, res) => {
                if (this.httpHandler) {
                    Promise.resolve(this.httpHandler(req, res)).catch((err) => {
                        if (!res.headersSent) {
                            res.statusCode = 500;
                            res.setHeader('content-type', 'text/plain; charset=utf-8');
                            res.end(`Internal error: ${err instanceof Error ? err.message : String(err)}`);
                        } else {
                            try { res.end(); } catch { /* swallow */ }
                        }
                    });
                    return;
                }
                res.statusCode = 404;
                res.setHeader('content-type', 'text/plain; charset=utf-8');
                res.end('Not Found');
            });

            const wss = new WebSocketServer({ noServer: true });
            wss.on('connection', (ws) => this.onConnection(ws));

            httpServer.on('upgrade', (req, socket, head) => {
                wss.handleUpgrade(req, socket, head, (ws) => {
                    wss.emit('connection', ws, req);
                });
            });

            httpServer.once('error', reject);
            httpServer.listen(this.opts.port, this.opts.host, () => {
                this.httpServer = httpServer;
                this.wss = wss;
                httpServer.off('error', reject);
                resolve();
            });
        });

        // Schedule auto-purge after the listen socket is up. Skipped when:
        //   - no store configured (in-memory only)
        //   - explicitly disabled via opts / env
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

    async stop(): Promise<void> {
        if (this.autoPurgeTimer) {
            clearInterval(this.autoPurgeTimer);
            this.autoPurgeTimer = undefined;
        }
        for (const ws of this.sockets.values()) {
            try {
                ws.close();
            } catch {
                /* swallow */
            }
        }
        this.sockets.clear();
        await new Promise<void>((resolve) => {
            if (!this.wss) return resolve();
            this.wss.close(() => resolve());
        });
        await new Promise<void>((resolve) => {
            if (!this.httpServer) return resolve();
            this.httpServer.close(() => resolve());
        });
    }

    /**
     * Run `store.purge()` defensively. Errors are logged but never bubble out
     * — the daemon must continue serving even if disk is full or files are
     * locked.
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
                    `[harnessa-fe] auto-purge (${trigger}): freed ${mb} MB · ` +
                        `${result.sessionsDeleted} sessions, ` +
                        `${result.recordingsDeleted} rrweb chunks, ` +
                        `${result.buildsDeleted ?? 0} builds, ` +
                        `${result.exportsDeleted} exports\n`,
                );
            }
        } catch (err) {
            process.stderr.write(
                `[harnessa-fe] auto-purge failed (${trigger}): ${
                    err instanceof Error ? err.message : String(err)
                }\n`,
            );
        }
    }

    /** Expose the bound port (useful when port:0 was passed for tests). */
    getBoundPort(): number | undefined {
        if (!this.httpServer) return undefined;
        const addr = this.httpServer.address();
        if (addr && typeof addr === 'object') return addr.port;
        return undefined;
    }

    getViewerBaseUrl(): string | undefined {
        const port = this.getBoundPort() ?? this.opts.port;
        if (!port) return undefined;
        return `http://${this.opts.host}:${port}`;
    }

    onEvent(listener: EventListener): () => void {
        this.eventListeners.add(listener);
        return () => this.eventListeners.delete(listener);
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

    async claimTask(id: string): Promise<Task | undefined> {
        const task = this.tasks.get(id);
        if (!task) return undefined;
        task.status = 'claimed';
        task.claimedAt = Date.now();
        this.persistTasks();
        // Persist status change to store
        this.persistTaskEvent(task, 'task:claim');
        return task;
    }

    async resolveTask(id: string, note?: string): Promise<Task | undefined> {
        const task = this.tasks.get(id);
        if (!task) return undefined;
        task.status = 'resolved';
        task.resolvedAt = Date.now();
        if (note !== undefined) task.note = note;
        this.persistTasks();
        // Persist status change to store
        this.persistTaskEvent(task, 'task:resolve');
        return task;
    }

    private persistTaskEvent(task: Task, eventType: string): void {
        if (!this.store) return;
        // Find the most recent session for this task's project
        const sessions = this.store.listSessions({ projectId: task.projectId, limit: 1 });
        const sessionId = sessions[0]?.id;
        if (!sessionId) return;
        this.store.appendEvent(sessionId, {
            ts: Date.now(),
            t: eventType,
            tab: task.tabId,
            load: task.sessionId,
            d: { id: task.id, status: task.status, question: task.question, note: task.note },
        });
    }

    private recordTask(frame: EventFrame, peer: PeerSession): void {
        const parsed = taskSubmitPayloadSchema.safeParse(frame.payload);
        if (!parsed.success) return;
        const tabId = peer.tabId ?? frame.tabId ?? 'unknown';
        // Dedup: collapse a fresh submit onto an existing pending task with
        // identical tab + selector + question. Refresh its timestamp and
        // overwrite the captured element snapshot, but keep the same id so
        // claim/resolve flows don't fork.
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
        const task: Task = {
            id,
            tabId,
            sessionId: peer.sessionId,
            projectId: peer.projectId ?? frame.projectId ?? 'unknown',
            url: parsed.data.url,
            status: 'pending',
            question: parsed.data.question,
            selector: parsed.data.selector,
            element: parsed.data.element,
            createdAt: frame.ts ?? Date.now(),
        };
        this.tasks.set(id, task);
        if (this.tasks.size > TASK_QUEUE_CAP) {
            // FIFO eviction by insertion order.
            const oldest = this.tasks.keys().next().value;
            if (oldest !== undefined) this.tasks.delete(oldest);
        }
        this.persistTasks();
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
        const session =
            target === 'vite-plugin'
                ? this.router.findVitePlugin(opts.projectId)
                : this.router.findTab(opts.tabId);
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
        if (!socket || socket.readyState !== WebSocket.OPEN) {
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

        // Persist command to store — runtime-client connections store a sessionId
        const storeId = this.connToStoreId.get(session.connectionId);
        // For runtime-client, storeId is the sessionId; for plugins storeId is the buildId.
        // Commands are sent to runtime-clients, so storeId here is always a sessionId.
        const storeSessionId = (session.role === 'runtime-client') ? storeId : undefined;
        const loadId = session.sessionId;
        if (this.store && storeSessionId) {
            this.store.appendEvent(storeSessionId, {
                ts: cmdTs, t: 'cmd', tab: session.tabId, load: loadId,
                d: { id, command, args, target },
            });
        }

        const timeoutMs = opts.timeoutMs ?? COMMAND_TIMEOUT_MS;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                // Persist timeout as failed response
                if (this.store && storeSessionId) {
                    this.store.appendEvent(storeSessionId, {
                        ts: Date.now(), t: 'resp', tab: session.tabId, load: loadId,
                        d: { id, ok: false, error: `timeout after ${timeoutMs}ms`, durationMs: timeoutMs },
                    });
                }
                reject(new Error(`bridge: command "${command}" timed out after ${timeoutMs}ms`));
            }, timeoutMs);
            this.pending.set(id, {
                resolve: (result) => {
                    // Persist successful response (strip screenshot dataUrl to save space)
                    if (this.store && storeSessionId) {
                        const safeResult = stripLargePayloads(result);
                        this.store.appendEvent(storeSessionId, {
                            ts: Date.now(), t: 'resp', tab: session.tabId, load: loadId,
                            d: { id, ok: true, result: safeResult, durationMs: Date.now() - cmdTs },
                        });
                    }
                    resolve(result);
                },
                reject: (err) => {
                    // Persist error response
                    if (this.store && storeSessionId) {
                        this.store.appendEvent(storeSessionId, {
                            ts: Date.now(), t: 'resp', tab: session.tabId, load: loadId,
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
     * Returns true if there is an active build for the given projectId.
     * Checks both in-memory grace period builds and the store.
     */
    private hasActiveBuild(projectId: string): boolean {
        // Check if there's a build in the grace period (still considered active)
        if (this.pendingEndBuild.has(projectId)) return true;
        // Check if any connection currently maps to a build for this project
        for (const [connId] of this.connToStoreId) {
            const peer = this.router.getByConnectionId(connId);
            if (peer?.projectId === projectId && (peer.role === 'vite-plugin' || peer.role === 'webpack-plugin')) {
                return true;
            }
        }
        return false;
    }

    private onConnection(ws: WebSocket): void {
        const connectionId = randomUUID();
        this.sockets.set(connectionId, ws);

        ws.on('message', (raw) => {
            let parsed: unknown;
            try {
                parsed = JSON.parse(raw.toString());
            } catch {
                return; // ignore non-JSON
            }
            const frame = frameSchema.safeParse(parsed);
            if (!frame.success) return;
            this.handleFrame(connectionId, ws, frame.data);
        });

        ws.on('close', () => {
            this.sockets.delete(connectionId);
            this.warnedNoSession.delete(connectionId);
            // Close store session/tab if applicable
            const storeId = this.connToStoreId.get(connectionId);
            if (storeId && this.store) {
                const peer = this.router.getByConnectionId(connectionId);
                if (peer?.role === 'runtime-client' && peer.tabId) {
                    // Close the session and tab for this runtime-client.
                    // storeId is the sessionId for runtime-clients.
                    this.store.closeSession(storeId);
                    this.store.closeTab(peer.tabId);
                    this.connToStoreId.delete(connectionId);
                } else if (peer?.role === 'vite-plugin' || peer?.role === 'webpack-plugin') {
                    // storeId is the buildId for build-plugins.
                    // Start grace period instead of closing build immediately.
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
                        // No projectId — close build immediately
                        this.store.closeBuild(storeId);
                    }
                    this.connToStoreId.delete(connectionId);
                }
            }
            this.router.unregister(connectionId);
        });

        ws.on('error', () => {
            /* swallow; close will follow */
        });
    }

    private handleFrame(connectionId: string, ws: WebSocket, frame: Frame): void {
        switch (frame.type) {
            case 'hello': {
                // Runtime-client MUST carry a sessionId so every emitted event is
                // attributable to a specific page load. Reject explicitly so
                // misconfigured clients surface during development.
                if (frame.role === 'runtime-client' && !frame.sessionId) {
                    console.warn(
                        '[harnessa-fe] rejecting runtime-client hello — missing sessionId',
                        { projectId: frame.projectId, tabId: frame.tabId },
                    );
                    const errorAck: HelloAckFrame = {
                        type: 'hello.ack',
                        id: frame.id,
                        serverVersion: PROTOCOL_VERSION,
                        error: 'runtime-client hello missing sessionId',
                    };
                    ws.send(JSON.stringify(errorAck));
                    return;
                }

                // NOTE: runtime-client is allowed to bootstrap a project on its
                // own (no plugin required). This is the standard mode for the
                // @harnessa-fe/next + jsxImportSource integration and for any
                // production / staging deployment where the bundler plugin is
                // absent. The runtime-client branch below opens its own store
                // session if one does not already exist for this project.

                const session = this.router.register({
                    role: frame.role,
                    projectId: frame.projectId,
                    tabId: frame.tabId,
                    sessionId: frame.sessionId,
                    connectionId,
                    page: frame.page,
                });
                // Persist to store
                if (this.store) {
                    // Project tree: record parentProjectId / displayName / tags
                    // the moment we learn about them via any hello frame.
                    if (
                        frame.parentProjectId !== undefined ||
                        frame.displayName !== undefined
                    ) {
                        try {
                            this.store.upsertProject(frame.projectId, {
                                parentProjectId: frame.parentProjectId,
                                displayName: frame.displayName,
                            });
                        } catch (err) {
                            // Cycle detection or other validation failure —
                            // log and continue; the peer still gets registered.
                            console.warn(
                                '[harnessa-fe] upsertProject failed:',
                                err instanceof Error ? err.message : err,
                            );
                        }
                    }
                    // Build artifact: record buildId metadata on first sight (runtime-client only;
                    // plugin openBuild() already handles the build-plugin case).
                    if (frame.buildId && frame.role === 'runtime-client') {
                        this.store.upsertBuild(frame.projectId, frame.buildId, {
                            bundler: undefined,
                        });
                    }

                    if (frame.role === 'vite-plugin' || frame.role === 'webpack-plugin') {
                        const projectId = frame.projectId;
                        // Check if there's a pending grace period for this project
                        const pendingTimer = projectId ? this.graceTimers.get(projectId) : undefined;
                        const pendingBuild = projectId ? this.pendingEndBuild.get(projectId) : undefined;
                        if (pendingTimer !== undefined && pendingBuild !== undefined && projectId) {
                            // Reconnect within grace period — cancel timer and reuse existing build
                            clearTimeout(pendingTimer);
                            this.graceTimers.delete(projectId);
                            this.pendingEndBuild.delete(projectId);
                            this.connToStoreId.set(connectionId, pendingBuild.buildId);
                        } else {
                            // Open a new build for this dev-server start
                            const buildId = this.store.openBuild(frame.projectId, {
                                bundler: frame.role === 'vite-plugin' ? 'vite' : 'webpack',
                            });
                            this.connToStoreId.set(connectionId, buildId);
                        }
                    } else if (frame.role === 'runtime-client' && frame.tabId) {
                        // Runtime-client: upsert the pageload session identified by frame.sessionId.
                        // frame.sessionId is the shared sessionId (shared across same-origin iframes).
                        const sessionId = frame.sessionId ?? randomUUID();
                        this.store.upsertTab(frame.tabId, {
                            connectedAt: Date.now(),
                            userAgent: frame.page?.userAgent,
                        });
                        // Build participants list: use frame.buildId if the plugin already told us about it
                        const participants: Array<{ projectId: string; buildId?: string; joinedAt: number }> = [
                            { projectId: frame.projectId, buildId: frame.buildId, joinedAt: Date.now() },
                        ];
                        this.store.upsertSession(sessionId, {
                            tabId: frame.tabId,
                            startedAt: Date.now(),
                            url: frame.page?.url,
                            title: frame.page?.title,
                            referrer: undefined,
                            userAgent: frame.page?.userAgent,
                            participants,
                        });
                        this.connToStoreId.set(connectionId, sessionId);
                    }
                }
                // If store is null but taskStore is available, still load tasks for build plugins
                if (!this.store && this.taskStore && (frame.role === 'vite-plugin' || frame.role === 'webpack-plugin')) {
                    const projectId = frame.projectId;
                    if (projectId) this.loadTasksForProject(projectId);
                }
                const ack: HelloAckFrame = {
                    type: 'hello.ack',
                    id: frame.id,
                    tabId: session.tabId,
                    serverVersion: PROTOCOL_VERSION,
                };
                ws.send(JSON.stringify(ack));
                // One concise line per accepted peer. Visibility for "is the
                // runtime actually talking to me?" without needing wireshark.
                process.stderr.write(
                    `[harnessa-fe] peer connected: role=${frame.role} project=${frame.projectId}` +
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
                // Persist to store
                if (this.store) {
                    const storeId = this.connToStoreId.get(connectionId);
                    // For runtime-clients storeId is the sessionId.
                    // For build plugins storeId is the buildId — events from plugins
                    // are appended to the most recent session for that project.
                    let storeSessionId: string | undefined;
                    if (peer.role === 'runtime-client') {
                        storeSessionId = storeId;
                    } else if (storeId) {
                        // Build plugin: find most recent session for this project
                        const sessions = this.store.listSessions({ projectId: peer.projectId, limit: 1 });
                        storeSessionId = sessions[0]?.id;
                    }

                    if (!storeSessionId) {
                        // Should not happen after the hello-time bootstrap above.
                        // Warn once per connection so silent data loss surfaces.
                        if (!this.warnedNoSession.has(connectionId)) {
                            this.warnedNoSession.add(connectionId);
                            console.warn(
                                '[harnessa-fe] dropping event — no store session for connection',
                                { projectId: peer.projectId, role: peer.role, eventName: frame.name },
                            );
                        }
                    }
                    if (storeSessionId) {
                        const tabId = frame.tabId ?? peer.tabId;
                        const loadId = tabId ? peer.sessionId : undefined;
                        // Row-level stamps for multi-project mixed timelines
                        const projectId = peer.projectId;
                        const buildId = (peer.role === 'vite-plugin' || peer.role === 'webpack-plugin')
                            ? storeId
                            : undefined;

                        if (frame.name === EVENT_NAME.PAGE_LOAD && tabId) {
                            const parsed = pageLoadPayloadSchema.safeParse(frame.payload);
                            const ts = frame.ts ?? Date.now();
                            const page = parsed.success ? parsed.data.page : undefined;
                            const viewport = parsed.success ? parsed.data.viewport : undefined;
                            const storageData = parsed.success ? parsed.data.storage : undefined;
                            // Update session meta with page info
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
                                ts, t: 'load', tab: tabId, load: loadId,
                                projectId, buildId,
                                d: frame.payload,
                            });
                        } else if (frame.name === EVENT_NAME.RRWEB && tabId) {
                            const parsed = rrwebChunkPayloadSchema.safeParse(frame.payload);
                            if (parsed.success) {
                                // v0.4.0: each session has one recording.jsonl — no tabId/loadId needed
                                this.store.appendRecording(storeSessionId, parsed.data);
                                this.store.appendEvent(storeSessionId, {
                                    ts: frame.ts ?? Date.now(),
                                    t: 'rrweb',
                                    tab: tabId,
                                    load: loadId,
                                    projectId,
                                    buildId,
                                    d: {
                                        chunkId: parsed.data.chunkId,
                                        startTs: parsed.data.startTs,
                                        endTs: parsed.data.endTs,
                                        eventCount: parsed.data.eventCount,
                                    },
                                });
                            }
                        } else {
                            this.store.appendEvent(storeSessionId, {
                                ts: frame.ts ?? Date.now(),
                                t: frame.name as string,
                                tab: tabId,
                                load: loadId,
                                projectId,
                                buildId,
                                d: frame.payload,
                            });
                        }
                        const marker = deriveRecordingMarker(frame, tabId);
                        if (marker) {
                            this.store.appendEvent(storeSessionId, {
                                ts: frame.ts ?? Date.now(),
                                t: 'rrweb:marker',
                                tab: tabId,
                                load: loadId,
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
            case 'mcp.call': {
                void this.handleMcpCall(ws, frame);
                break;
            }
            case 'hello.ack':
            case 'command':
            case 'mcp.return':
                // Server doesn't expect to receive these; ignore.
                break;
        }
    }

    private async handleMcpCall(ws: WebSocket, frame: McpCallFrame): Promise<void> {
        const reply = (payload: Omit<McpReturnFrame, 'type' | 'id'>): void => {
            if (ws.readyState !== WebSocket.OPEN) return;
            const out: McpReturnFrame = { type: 'mcp.return', id: frame.id, ...payload };
            try {
                ws.send(JSON.stringify(out));
            } catch {
                /* swallow */
            }
        };
        try {
            const result = await this.invokeMcpMethod(frame.method, frame.args);
            reply({ ok: true, result });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            reply({ ok: false, error: { message } });
        }
    }

    private async invokeMcpMethod(method: McpCallFrame['method'], args: unknown): Promise<unknown> {
        switch (method) {
            case 'sendCommand': {
                const a = (args ?? {}) as {
                    command: string;
                    args?: unknown;
                    opts?: SendCommandOptions;
                };
                return this.sendCommand(a.command, a.args, a.opts);
            }
            case 'listTabs':
                return this.listTabs();
            case 'listTasks': {
                const a = (args ?? {}) as { status?: TaskStatus | 'all'; limit?: number };
                return this.listTasks(a);
            }
            case 'claimTask': {
                const a = args as { id: string };
                return this.claimTask(a.id);
            }
            case 'resolveTask': {
                const a = args as { id: string; note?: string };
                return this.resolveTask(a.id, a.note);
            }
            // ─── Store methods (proxied from follower) ─────────────────────
            case 'storeListProjects': {
                if (!this.store) throw new Error('bridge: store is not enabled');
                return this.store.listProjects();
            }
            case 'storeListSessions': {
                if (!this.store) throw new Error('bridge: store is not enabled');
                const a = args as { projectId?: string; tabId?: string; buildId?: string; limit?: number };
                return this.store.listSessions({ projectId: a.projectId, tabId: a.tabId, buildId: a.buildId, limit: a.limit });
            }
            case 'storeSummary': {
                if (!this.store) throw new Error('bridge: store is not enabled');
                const a = args as { sessionId: string };
                return this.store.summary(a.sessionId);
            }
            case 'storeTail': {
                if (!this.store) throw new Error('bridge: store is not enabled');
                const a = args as {
                    sessionId: string;
                    opts?: import('./store/index.js').TailOptions;
                };
                return this.store.tail(a.sessionId, a.opts);
            }
            case 'storeSearch': {
                if (!this.store) throw new Error('bridge: store is not enabled');
                const a = args as {
                    sessionId: string;
                    query: string;
                    opts?: import('./store/index.js').SearchOptions;
                };
                return this.store.search(a.sessionId, a.query, a.opts);
            }
            case 'storeRecordingsList': {
                if (!this.store) throw new Error('bridge: store is not enabled');
                const a = args as { sessionId: string };
                return this.store.listRecordings(a.sessionId);
            }
            case 'storeRecordingsSlice': {
                if (!this.store) throw new Error('bridge: store is not enabled');
                const a = args as { sessionId: string; since: number; until: number };
                return this.store.sliceRecordings(a.sessionId, a.since, a.until);
            }
            case 'storeReplayCreate': {
                if (!this.store) throw new Error('bridge: store is not enabled');
                const { createReplayExport } = await import('./replayCreate.js');
                return createReplayExport(this.store, this.getViewerBaseUrl(), args as Parameters<typeof createReplayExport>[2]);
            }
            case 'storePurge': {
                if (!this.store) throw new Error('bridge: store is not enabled');
                const a = (args ?? {}) as import('./store/index.js').RetentionPolicy;
                return this.store.purge(a);
            }
            // ─── Memory methods (proxied from follower) ────────────────────
            case 'memorySet': {
                const a = args as { projectId: string; key: string; value: string };
                return this.memoryStore.set(a.projectId, a.key, a.value);
            }
            case 'memoryGet': {
                const a = args as { projectId: string; key: string };
                return this.memoryStore.get(a.projectId, a.key);
            }
            case 'memoryList': {
                const a = args as { projectId: string };
                return this.memoryStore.list(a.projectId);
            }
            case 'memoryDelete': {
                const a = args as { projectId: string; key: string };
                return this.memoryStore.delete(a.projectId, a.key);
            }
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
