/**
 * WS bridge — accepts connections from vite-plugin and runtime-client.
 *
 * Protocol: see @morphixai/harnessa-fe.protocol.
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
} from '@morphixai/harnessa-fe.protocol';
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
    private opts: Required<Omit<BridgeOptions, 'store' | 'taskStore' | 'memoryStore'>>;
    /** Map from connectionId → sessionId in the store */
    private connToStoreSession = new Map<string, string>();
    /**
     * Grace period timers: projectId → timer handle.
     * When a build plugin disconnects, a 30-second timer is started.
     * If the same project reconnects within that window, the timer is cancelled.
     */
    private graceTimers = new Map<string, NodeJS.Timeout>();
    /**
     * Pending session end info: projectId → { sessionId, closedAt }.
     * Tracks sessions waiting for the grace period to expire.
     */
    private pendingEndSession = new Map<string, { sessionId: string; closedAt: number }>();

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
        return new Promise((resolve, reject) => {
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
    }

    async stop(): Promise<void> {
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
        // Find the store session for this task's project
        const sessions = this.store.listSessions(task.projectId, 1);
        const storeSessionId = sessions[0]?.id;
        if (!storeSessionId) return;
        this.store.append(
            storeSessionId,
            { ts: Date.now(), t: eventType, tab: task.tabId, d: { id: task.id, status: task.status, question: task.question, note: task.note } },
            task.tabId,
        );
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

        // Persist command to store
        const storeSessionId = this.connToStoreSession.get(session.connectionId);
        if (this.store && storeSessionId) {
            this.store.append(
                storeSessionId,
                { ts: cmdTs, t: 'cmd', tab: session.tabId, d: { id, command, args, target } },
                session.tabId,
            );
        }

        const timeoutMs = opts.timeoutMs ?? COMMAND_TIMEOUT_MS;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                // Persist timeout as failed response
                if (this.store && storeSessionId) {
                    this.store.append(
                        storeSessionId,
                        { ts: Date.now(), t: 'resp', tab: session.tabId, d: { id, ok: false, error: `timeout after ${timeoutMs}ms`, durationMs: timeoutMs } },
                        session.tabId,
                    );
                }
                reject(new Error(`bridge: command "${command}" timed out after ${timeoutMs}ms`));
            }, timeoutMs);
            this.pending.set(id, {
                resolve: (result) => {
                    // Persist successful response (strip screenshot dataUrl to save space)
                    if (this.store && storeSessionId) {
                        const safeResult = stripLargePayloads(result);
                        this.store.append(
                            storeSessionId,
                            { ts: Date.now(), t: 'resp', tab: session.tabId, d: { id, ok: true, result: safeResult, durationMs: Date.now() - cmdTs } },
                            session.tabId,
                        );
                    }
                    resolve(result);
                },
                reject: (err) => {
                    // Persist error response
                    if (this.store && storeSessionId) {
                        this.store.append(
                            storeSessionId,
                            { ts: Date.now(), t: 'resp', tab: session.tabId, d: { id, ok: false, error: err.message, durationMs: Date.now() - cmdTs } },
                            session.tabId,
                        );
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
     * Returns true if there is an active (non-ended) session for the given projectId.
     * Checks both in-memory grace period sessions and the store.
     */
    private hasActiveSession(projectId: string): boolean {
        // Check if there's a session in the grace period (still considered active)
        if (this.pendingEndSession.has(projectId)) return true;
        // Check if any connection currently maps to a session for this project
        for (const [connId] of this.connToStoreSession) {
            const peer = this.router.getByConnectionId(connId);
            if (peer?.projectId === projectId && (peer.role === 'vite-plugin' || peer.role === 'webpack-plugin')) {
                return true;
            }
        }
        // Fall back to store: check if there's a session without endedAt
        if (this.store) {
            const sessions = this.store.listSessions(projectId, 1);
            const latest = sessions[0];
            if (latest && latest.endedAt === undefined) return true;
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
            // Close store session/tab if applicable
            const storeSessionId = this.connToStoreSession.get(connectionId);
            if (storeSessionId && this.store) {
                const peer = this.router.getByConnectionId(connectionId);
                if (peer?.role === 'runtime-client' && peer.tabId) {
                    this.store.closeTab(storeSessionId, peer.tabId);
                    this.connToStoreSession.delete(connectionId);
                } else if (peer?.role === 'vite-plugin' || peer?.role === 'webpack-plugin') {
                    // Start grace period instead of closing session immediately
                    const projectId = peer.projectId;
                    if (projectId) {
                        const closedAt = Date.now();
                        this.pendingEndSession.set(projectId, { sessionId: storeSessionId, closedAt });
                        const timer = setTimeout(() => {
                            this.graceTimers.delete(projectId);
                            const pending = this.pendingEndSession.get(projectId);
                            if (pending && pending.sessionId === storeSessionId) {
                                this.pendingEndSession.delete(projectId);
                                this.store?.closeSession(storeSessionId, pending.closedAt);
                            }
                        }, 30_000);
                        this.graceTimers.set(projectId, timer);
                    } else {
                        // No projectId — close session immediately
                        this.store.closeSession(storeSessionId);
                    }
                    this.connToStoreSession.delete(connectionId);
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
                // For runtime-client: check if an active session exists before registering.
                // Only enforced when the store is active (persistence enabled).
                if (frame.role === 'runtime-client' && this.store) {
                    const hasActiveSession = this.hasActiveSession(frame.projectId);
                    if (!hasActiveSession) {
                        const errorAck: HelloAckFrame = {
                            type: 'hello.ack',
                            id: frame.id,
                            serverVersion: PROTOCOL_VERSION,
                            error: `no active session for projectId="${frame.projectId}"; start the dev server first`,
                        };
                        ws.send(JSON.stringify(errorAck));
                        return;
                    }
                }

                const session = this.router.register({
                    role: frame.role,
                    projectId: frame.projectId,
                    tabId: frame.tabId,
                    connectionId,
                    page: frame.page,
                });
                // Persist to store
                if (this.store) {
                    if (frame.role === 'vite-plugin' || frame.role === 'webpack-plugin') {
                        const projectId = frame.projectId;
                        // Check if there's a pending grace period for this project
                        const pendingTimer = projectId ? this.graceTimers.get(projectId) : undefined;
                        const pendingSession = projectId ? this.pendingEndSession.get(projectId) : undefined;
                        if (pendingTimer !== undefined && pendingSession !== undefined && projectId) {
                            // Reconnect within grace period — cancel timer and reuse existing session
                            clearTimeout(pendingTimer);
                            this.graceTimers.delete(projectId);
                            this.pendingEndSession.delete(projectId);
                            this.connToStoreSession.set(connectionId, pendingSession.sessionId);
                        } else {
                            // New session
                            const storeSessionId = this.store.openSession(frame.projectId, {
                                peerRole: frame.role,
                                metadata: { role: frame.role },
                            });
                            this.connToStoreSession.set(connectionId, storeSessionId);
                        }
                    } else if (frame.role === 'runtime-client' && frame.tabId) {
                        // Find the store session for this project
                        const sessions = this.store.listSessions(frame.projectId, 1);
                        const storeSessionId = sessions[0]?.id;
                        if (storeSessionId) {
                            this.connToStoreSession.set(connectionId, storeSessionId);
                            this.store.openTab(storeSessionId, {
                                id: frame.tabId,
                                url: frame.page?.url,
                                title: frame.page?.title,
                                userAgent: frame.page?.userAgent,
                            });
                        }
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
                    const storeSessionId = this.connToStoreSession.get(connectionId);
                    if (storeSessionId) {
                        const tabId = frame.tabId ?? peer.tabId;
                        if (frame.name === EVENT_NAME.RRWEB && tabId) {
                            const parsed = rrwebChunkPayloadSchema.safeParse(frame.payload);
                            if (parsed.success) {
                                this.store.appendRecording(storeSessionId, tabId, parsed.data);
                                this.store.append(
                                    storeSessionId,
                                    {
                                        ts: frame.ts ?? Date.now(),
                                        t: 'rrweb',
                                        tab: tabId,
                                        d: {
                                            chunkId: parsed.data.chunkId,
                                            startTs: parsed.data.startTs,
                                            endTs: parsed.data.endTs,
                                            eventCount: parsed.data.eventCount,
                                        },
                                    },
                                    tabId,
                                );
                            }
                        } else {
                            this.store.append(
                                storeSessionId,
                                {
                                    ts: frame.ts ?? Date.now(),
                                    t: frame.name as string,
                                    tab: tabId,
                                    d: frame.payload,
                                },
                                tabId,
                            );
                        }
                        const marker = deriveRecordingMarker(frame, tabId);
                        if (marker) {
                            this.store.append(
                                storeSessionId,
                                {
                                    ts: frame.ts ?? Date.now(),
                                    t: 'rrweb:marker',
                                    tab: tabId,
                                    d: marker,
                                },
                                tabId,
                            );
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
                const a = args as { projectId: string; limit?: number };
                return this.store.listSessions(a.projectId, a.limit);
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
                    tabId?: string;
                };
                return this.store.tail(a.sessionId, a.opts, a.tabId);
            }
            case 'storeSearch': {
                if (!this.store) throw new Error('bridge: store is not enabled');
                const a = args as {
                    sessionId: string;
                    query: string;
                    opts?: import('./store/index.js').SearchOptions;
                    tabId?: string;
                };
                return this.store.search(a.sessionId, a.query, a.opts, a.tabId);
            }
            case 'storeRecordingsList': {
                if (!this.store) throw new Error('bridge: store is not enabled');
                const a = args as { sessionId: string; tabId?: string };
                return this.store.listRecordings(a.sessionId, a.tabId);
            }
            case 'storeRecordingsSlice': {
                if (!this.store) throw new Error('bridge: store is not enabled');
                const a = args as { sessionId: string; since: number; until: number; tabId?: string };
                return this.store.sliceRecordings(a.sessionId, a.since, a.until, a.tabId);
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
