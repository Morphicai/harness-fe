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
import type { IMemoryStore } from './store/index.js';

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

    constructor(opts: RemoteBridgeOptions) {
        const host = opts.host ?? '127.0.0.1';
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

    getMemoryStore(): IMemoryStore {
        throw new Error('remote-bridge: getMemoryStore() is not available in follower mode');
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
