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
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import { tmpdir } from 'node:os';
import {
    DEFAULT_WS_PORT,
    EVENT_NAME,
    PROTOCOL_VERSION,
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
import { JsonlStore, type IStore } from './store/index.js';

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
}

export interface SendCommandOptions {
    tabId?: string;
    timeoutMs?: number;
    target?: 'runtime-client' | 'vite-plugin';
    projectId?: string;
}

const COMMAND_TIMEOUT_MS = 30_000;
const TASK_QUEUE_CAP = 200;

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
     * File to persist the task queue across daemon restarts. Defaults to
     * `$MORPHIX_DEV_BRIDGE_TASKS_FILE` or `<tmpdir>/morphix-dev-bridge-tasks.json`.
     * Pass an empty string to disable persistence (useful in tests).
     */
    tasksFile?: string;
    /**
     * Store instance for JSONL persistence. If omitted, a default JsonlStore
     * is created at ~/.harnessa-fe/data. Pass null to disable persistence.
     */
    store?: IStore | null;
}

const DEFAULT_TASKS_FILE = resolvePath(tmpdir(), 'morphix-dev-bridge-tasks.json');

export type EventListener = (event: EventFrame, session: PeerSession) => void;

export class Bridge implements IBridge {
    readonly router = new SessionRouter();
    readonly store: IStore | null;
    private wss?: WebSocketServer;
    private sockets = new Map<string, WebSocket>();
    private pending = new Map<string, PendingCommand>();
    private eventListeners = new Set<EventListener>();
    private tasks = new Map<string, Task>();
    private opts: Required<Omit<BridgeOptions, 'store'>>;
    /** Map from connectionId → sessionId in the store */
    private connToStoreSession = new Map<string, string>();

    constructor(opts: BridgeOptions = {}) {
        const envFile = process.env.MORPHIX_DEV_BRIDGE_TASKS_FILE;
        this.store = opts.store === null ? null : (opts.store ?? new JsonlStore());
        this.opts = {
            port: opts.port ?? DEFAULT_WS_PORT,
            host: opts.host ?? '127.0.0.1',
            tasksFile: opts.tasksFile ?? envFile ?? DEFAULT_TASKS_FILE,
        };
        this.loadTasks();
    }

    private loadTasks(): void {
        const file = this.opts.tasksFile;
        if (!file || !existsSync(file)) return;
        try {
            const raw = readFileSync(file, 'utf-8');
            const parsed = JSON.parse(raw) as { tasks?: Task[] };
            for (const task of parsed.tasks ?? []) {
                if (task && typeof task.id === 'string') this.tasks.set(task.id, task);
            }
        } catch {
            /* corrupt file — ignore, will be overwritten on next persist */
        }
    }

    private persistTasks(): void {
        const file = this.opts.tasksFile;
        if (!file) return;
        try {
            mkdirSync(dirname(file), { recursive: true });
            const payload = JSON.stringify({ tasks: Array.from(this.tasks.values()) });
            const tmp = `${file}.tmp`;
            writeFileSync(tmp, payload, 'utf-8');
            renameSync(tmp, file);
        } catch {
            /* best-effort — losing one persist is not fatal */
        }
    }

    private taskDedupKey(tabId: string, payload: { question: string; selector: { css?: string; comp?: string; loc?: string } }): string {
        const sel = payload.selector;
        const selKey = sel.loc ?? sel.comp ?? sel.css ?? '';
        return `${tabId}::${selKey}::${payload.question.trim()}`;
    }

    async start(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.wss = new WebSocketServer({
                port: this.opts.port,
                host: this.opts.host,
            });
            this.wss.on('listening', () => resolve());
            this.wss.on('error', reject);
            this.wss.on('connection', (ws) => this.onConnection(ws));
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
        return new Promise((resolve) => {
            if (!this.wss) return resolve();
            this.wss.close(() => resolve());
        });
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
        return task;
    }

    async resolveTask(id: string, note?: string): Promise<Task | undefined> {
        const task = this.tasks.get(id);
        if (!task) return undefined;
        task.status = 'resolved';
        task.resolvedAt = Date.now();
        if (note !== undefined) task.note = note;
        this.persistTasks();
        return task;
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
        const frame: CommandFrame = {
            type: 'command',
            id,
            tabId: session.tabId,
            command,
            args,
        };
        const timeoutMs = opts.timeoutMs ?? COMMAND_TIMEOUT_MS;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`bridge: command "${command}" timed out after ${timeoutMs}ms`));
            }, timeoutMs);
            this.pending.set(id, { resolve, reject, timer });
            try {
                socket.send(JSON.stringify(frame));
            } catch (err) {
                clearTimeout(timer);
                this.pending.delete(id);
                reject(err as Error);
            }
        });
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
                } else if (peer?.role === 'vite-plugin' || peer?.role === 'webpack-plugin') {
                    this.store.closeSession(storeSessionId);
                }
                this.connToStoreSession.delete(connectionId);
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
                        const storeSessionId = this.store.openSession(frame.projectId, {
                            peerRole: frame.role,
                            metadata: { role: frame.role },
                        });
                        this.connToStoreSession.set(connectionId, storeSessionId);
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
                        this.store.append(
                            storeSessionId,
                            {
                                ts: frame.ts ?? Date.now(),
                                t: frame.name as string,
                                tab: frame.tabId ?? peer.tabId,
                                d: frame.payload,
                            },
                            frame.tabId ?? peer.tabId,
                        );
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
        }
    }
}
