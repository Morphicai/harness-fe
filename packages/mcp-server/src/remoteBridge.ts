/**
 * RemoteBridge — IBridge implementation backed by a WS connection to an
 * already-running daemon (leader).
 *
 * Used when this process starts as a follower: another cli.js is already
 * listening on :47729, so we attach as a ws client and proxy every MCP tool
 * call through the new `mcp.call` / `mcp.return` control frames.
 */

import { WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import {
    type McpCallFrame,
    type McpReturnFrame,
    type TabInfo,
    type Task,
    type TaskStatus,
    frameSchema,
} from '@morphixai/harnessa-fe.protocol';
import type { IBridge, SendCommandOptions } from './bridge.js';
import type {
    IMemoryStore,
    IStore,
    LoadMeta,
    MemoryEntry,
    ProjectMeta,
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
} from './store/index.js';

const DEFAULT_CALL_TIMEOUT_MS = 30_000;

interface PendingCall {
    resolve(value: unknown): void;
    reject(err: Error): void;
    timer: NodeJS.Timeout;
}

export interface RemoteBridgeOptions {
    port: number;
    host?: string;
    /** Per-call timeout. Must be ≥ daemon's command timeout to surface upstream errors first. */
    callTimeoutMs?: number;
}

export class RemoteBridge implements IBridge {
    private ws?: WebSocket;
    private pending = new Map<string, PendingCall>();
    private closed = false;
    private readonly url: string;
    private readonly callTimeoutMs: number;
    private readonly host: string;
    private readonly port: number;

    constructor(opts: RemoteBridgeOptions) {
        const host = opts.host ?? '127.0.0.1';
        this.host = host;
        this.port = opts.port;
        this.url = `ws://${host}:${opts.port}`;
        this.callTimeoutMs = opts.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;
    }

    async connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            const ws = new WebSocket(this.url);
            this.ws = ws;
            const onOpen = () => {
                ws.off('error', onErr);
                this.attachHandlers(ws);
                resolve();
            };
            const onErr = (err: Error) => {
                ws.off('open', onOpen);
                reject(err);
            };
            ws.once('open', onOpen);
            ws.once('error', onErr);
        });
    }

    async stop(): Promise<void> {
        this.closed = true;
        const ws = this.ws;
        if (!ws) return;
        try {
            ws.close();
        } catch {
            /* swallow */
        }
    }

    sendCommand(command: string, args: unknown, opts?: SendCommandOptions): Promise<unknown> {
        return this.invoke('sendCommand', { command, args, opts });
    }

    listTabs(): Promise<TabInfo[]> {
        return this.invoke('listTabs', {}) as Promise<TabInfo[]>;
    }

    listTasks(filter: { status?: TaskStatus | 'all'; limit?: number } = {}): Promise<Task[]> {
        return this.invoke('listTasks', filter) as Promise<Task[]>;
    }

    claimTask(id: string): Promise<Task | undefined> {
        return this.invoke('claimTask', { id }) as Promise<Task | undefined>;
    }

    resolveTask(id: string, note?: string): Promise<Task | undefined> {
        return this.invoke('resolveTask', { id, note }) as Promise<Task | undefined>;
    }

    /**
     * Returns a RemoteMemoryStore that proxies all memory operations to the
     * leader via the mcp.call channel. This allows follower instances to use
     * the same project.memory.* tools as the leader.
     */
    getMemoryStore(): IMemoryStore {
        return new RemoteMemoryStore(this);
    }

    getViewerBaseUrl(): string | undefined {
        // Followers share the same WS/HTTP port as the leader.
        return `http://${this.host}:${this.port}`;
    }

    /**
     * Returns a RemoteStore that proxies all store read/query operations to
     * the leader via the mcp.call channel. Write operations (openSession,
     * append, etc.) are not proxied — followers are read-only.
     */
    getStore(): IStore {
        return new RemoteStore(this);
    }

    /** @internal — used by RemoteMemoryStore and RemoteStore */
    invokeRemote(method: McpCallFrame['method'], args: unknown): Promise<unknown> {
        return this.invoke(method, args);
    }

    private invoke(method: McpCallFrame['method'], args: unknown): Promise<unknown> {
        const ws = this.ws;
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            return Promise.reject(new Error('remote-bridge: not connected'));
        }
        const id = randomUUID();
        const frame: McpCallFrame = { type: 'mcp.call', id, method, args };
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`remote-bridge: "${method}" timed out after ${this.callTimeoutMs}ms`));
            }, this.callTimeoutMs);
            this.pending.set(id, { resolve, reject, timer });
            try {
                ws.send(JSON.stringify(frame));
            } catch (err) {
                clearTimeout(timer);
                this.pending.delete(id);
                reject(err as Error);
            }
        });
    }

    private attachHandlers(ws: WebSocket): void {
        ws.on('message', (raw) => {
            let parsed: unknown;
            try {
                parsed = JSON.parse(raw.toString());
            } catch {
                return;
            }
            const frame = frameSchema.safeParse(parsed);
            if (!frame.success) return;
            if (frame.data.type !== 'mcp.return') return;
            this.handleReturn(frame.data);
        });
        ws.on('close', () => this.handleClose());
        ws.on('error', () => {
            /* close will follow */
        });
    }

    private handleReturn(frame: McpReturnFrame): void {
        const p = this.pending.get(frame.id);
        if (!p) return;
        clearTimeout(p.timer);
        this.pending.delete(frame.id);
        if (frame.ok) {
            p.resolve(frame.result);
        } else {
            p.reject(new Error(frame.error?.message ?? 'remote-bridge: unknown error'));
        }
    }

    private handleClose(): void {
        const err = new Error(
            this.closed
                ? 'remote-bridge: connection closed'
                : 'remote-bridge: lost connection to daemon',
        );
        for (const p of this.pending.values()) {
            clearTimeout(p.timer);
            p.reject(err);
        }
        this.pending.clear();
    }
}

// ─── RemoteMemoryStore ────────────────────────────────────────────────────────
//
// Proxies IMemoryStore operations to the leader via mcp.call frames.
// Used by follower instances so project.memory.* tools work in all windows.

class RemoteMemoryStore implements IMemoryStore {
    constructor(private readonly bridge: RemoteBridge) {}

    get(projectId: string, key: string): MemoryEntry | undefined {
        // Synchronous interface — not directly awaitable. The MCP tool layer
        // wraps calls in async handlers, so we return a thenable-compatible
        // object. In practice mcp.ts awaits the result via the async handler.
        // We throw here to signal that callers must use the async path.
        throw new Error(
            'RemoteMemoryStore.get() must be called via the async MCP tool handler. ' +
            'Use remoteMemoryStore.getAsync() instead.',
        );
    }

    /** Async variant used by the MCP tool handlers in mcp.ts. */
    async getAsync(projectId: string, key: string): Promise<MemoryEntry | undefined> {
        return this.bridge.invokeRemote('memoryGet', { projectId, key }) as Promise<MemoryEntry | undefined>;
    }

    set(projectId: string, key: string, value: string): MemoryEntry {
        throw new Error('RemoteMemoryStore.set() must be called via setAsync().');
    }

    async setAsync(projectId: string, key: string, value: string): Promise<MemoryEntry> {
        return this.bridge.invokeRemote('memorySet', { projectId, key, value }) as Promise<MemoryEntry>;
    }

    delete(projectId: string, key: string): boolean {
        throw new Error('RemoteMemoryStore.delete() must be called via deleteAsync().');
    }

    async deleteAsync(projectId: string, key: string): Promise<boolean> {
        return this.bridge.invokeRemote('memoryDelete', { projectId, key }) as Promise<boolean>;
    }

    list(projectId: string): MemoryEntry[] {
        throw new Error('RemoteMemoryStore.list() must be called via listAsync().');
    }

    async listAsync(projectId: string): Promise<MemoryEntry[]> {
        return this.bridge.invokeRemote('memoryList', { projectId }) as Promise<MemoryEntry[]>;
    }
}

// ─── RemoteStore ──────────────────────────────────────────────────────────────
//
// Proxies IStore read operations to the leader via mcp.call frames.
// Write operations throw — followers are read-only for the store.

class RemoteStore implements IStore {
    constructor(private readonly bridge: RemoteBridge) {}

    // ── Read operations (proxied) ──────────────────────────────────────────

    async listProjectsAsync(): Promise<ProjectMeta[]> {
        return this.bridge.invokeRemote('storeListProjects', {}) as Promise<ProjectMeta[]>;
    }

    async listSessionsAsync(projectId: string, limit?: number): Promise<SessionMeta[]> {
        return this.bridge.invokeRemote('storeListSessions', { projectId, limit }) as Promise<SessionMeta[]>;
    }

    async summaryAsync(sessionId: string): Promise<SessionSummary> {
        return this.bridge.invokeRemote('storeSummary', { sessionId }) as Promise<SessionSummary>;
    }

    async tailAsync(sessionId: string, opts?: TailOptions, tabId?: string): Promise<StoreEvent[]> {
        return this.bridge.invokeRemote('storeTail', { sessionId, opts, tabId }) as Promise<StoreEvent[]>;
    }

    async searchAsync(sessionId: string, query: string, opts?: SearchOptions, tabId?: string): Promise<StoreEvent[]> {
        return this.bridge.invokeRemote('storeSearch', { sessionId, query, opts, tabId }) as Promise<StoreEvent[]>;
    }

    async listRecordingsAsync(sessionId: string, tabId?: string): Promise<RecordingChunkSummary[]> {
        return this.bridge.invokeRemote('storeRecordingsList', { sessionId, tabId }) as Promise<RecordingChunkSummary[]>;
    }

    async sliceRecordingsAsync(sessionId: string, since: number, until: number, tabId?: string): Promise<RecordingChunk[]> {
        return this.bridge.invokeRemote(
            'storeRecordingsSlice',
            { sessionId, since, until, tabId },
        ) as Promise<RecordingChunk[]>;
    }

    async replayCreateAsync(args: {
        sessionId: string;
        tabId?: string;
        ts?: number;
        windowMs?: number;
        since?: number;
        until?: number;
        label?: string;
    }): Promise<unknown> {
        return this.bridge.invokeRemote('storeReplayCreate', args);
    }

    async purgeAsync(policy?: RetentionPolicy): Promise<PurgeResult> {
        return this.bridge.invokeRemote('storePurge', policy ?? {}) as Promise<PurgeResult>;
    }

    // ── Synchronous IStore interface stubs (not used by follower) ─────────
    // These satisfy the interface but throw — the MCP tool handlers in mcp.ts
    // use the async variants above when running in follower mode.

    listProjects(): ProjectMeta[] { throw notSupported('listProjects'); }
    listSessions(_p: string, _l?: number): SessionMeta[] { throw notSupported('listSessions'); }
    getSession(_id: string): SessionMeta | undefined { throw notSupported('getSession'); }
    tail(_s: string, _o?: TailOptions, _t?: string): StoreEvent[] { throw notSupported('tail'); }
    search(_s: string, _q: string, _o?: SearchOptions, _t?: string): StoreEvent[] { throw notSupported('search'); }
    listRecordings(_s: string, _t?: string): RecordingChunkSummary[] { throw notSupported('listRecordings'); }
    sliceRecordings(_s: string, _since: number, _until: number, _t?: string): RecordingChunk[] { throw notSupported('sliceRecordings'); }
    listLoads(_s: string, _t: string): LoadMeta[] { throw notSupported('listLoads'); }
    getLoad(_s: string, _t: string, _l: string): LoadMeta | undefined { throw notSupported('getLoad'); }
    sliceRecordingsByLoad(_s: string, _t: string, _l: string): RecordingChunk[] { throw notSupported('sliceRecordingsByLoad'); }
    summary(_s: string): SessionSummary { throw notSupported('summary'); }
    purge(_p?: RetentionPolicy): PurgeResult { throw notSupported('purge'); }
    listNotes(_p: string): Array<{ key: string; value: string; ts: number }> { throw notSupported('listNotes'); }

    // Write operations — not available in follower mode
    openSession(_p: string, _m: Omit<SessionMeta, 'id' | 'projectId' | 'startedAt'>): string { throw notSupported('openSession'); }
    closeSession(_s: string, _c?: number): void { throw notSupported('closeSession'); }
    openTab(_s: string, _t: Omit<TabMeta, 'sessionId' | 'connectedAt'>): void { throw notSupported('openTab'); }
    closeTab(_s: string, _t: string): void { throw notSupported('closeTab'); }
    openLoad(_s: string, _t: string, _m: Omit<LoadMeta, 'tabId' | 'sessionId' | 'endedAt'>): void { throw notSupported('openLoad'); }
    closeLatestLoad(_s: string, _t: string, _e?: number): void { throw notSupported('closeLatestLoad'); }
    append(_s: string, _e: StoreEvent, _t?: string): void { throw notSupported('append'); }
    appendBatch(_s: string, _e: StoreEvent[], _t?: string): void { throw notSupported('appendBatch'); }
    appendRecording(_s: string, _t: string, _c: unknown): void { throw notSupported('appendRecording'); }
    writeNote(_p: string, _k: string, _v: string): void { throw notSupported('writeNote'); }
    writeExport(_i: Parameters<IStore['writeExport']>[0]): ReplayExportMeta { throw notSupported('writeExport'); }
    getExport(_id: string): ReplayExportMeta | undefined { throw notSupported('getExport'); }
    readExportEvents(_id: string): unknown[] | undefined { throw notSupported('readExportEvents'); }
    listExports(_p: string, _l?: number): ReplayExportMeta[] { throw notSupported('listExports'); }
    close(): void { /* no-op for remote */ }
}

function notSupported(method: string): Error {
    return new Error(`remote-bridge: IStore.${method}() is not available in follower mode`);
}
