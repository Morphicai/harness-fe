/**
 * Transport abstraction for @harness-fe/node-runtime.
 *
 * Two implementations:
 *   WsTransport    — persistent WebSocket; existing behaviour.
 *   HttpBatchTransport — fetch-based batching; used in Edge Runtime where ws
 *                        is unavailable, or when HARNESS_FE_TRANSPORT=http.
 */

import { randomUUID } from 'node:crypto';
import type { RegisterOptions } from './index.js';
import type { EventFrame, HelloFrame } from '@harness-fe/protocol';
import { DEFAULT_WS_PORT } from '@harness-fe/protocol';

// ─── Interface ────────────────────────────────────────────────────────────────

export interface Transport {
    open(hello: HelloFrame): Promise<void>;
    send(frame: EventFrame): void;
    close(): void;
}

// ─── WsTransport ─────────────────────────────────────────────────────────────

const MAX_RECONNECT_DELAY_MS = 30_000;

export class WsTransport implements Transport {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private ws: any; // typed as any to avoid hard import of 'ws' at module level
    private hello?: HelloFrame;
    private reconnectAttempts = 0;
    private reconnectTimer?: ReturnType<typeof setTimeout>;
    private closed = false;

    constructor(private readonly opts: RegisterOptions) {}

    open(hello: HelloFrame): Promise<void> {
        this.hello = hello;
        this.closed = false;
        this._connect();
        return Promise.resolve();
    }

    private _connect(): void {
        if (this.closed) return;
        const url = this.opts.mcpUrl ?? `ws://127.0.0.1:${DEFAULT_WS_PORT}`;
        // Dynamic require so edge bundlers never pull 'ws' into their bundle
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { WebSocket } = require('ws') as typeof import('ws');
        const socket = new WebSocket(url);
        this.ws = socket;

        socket.on('open', () => {
            this.reconnectAttempts = 0;
            socket.send(JSON.stringify(this.hello));
        });

        socket.on('close', () => {
            this.ws = undefined;
            if (!this.closed) this._scheduleReconnect();
        });

        socket.on('error', () => {
            this.ws = undefined;
            // close event will follow
        });
    }

    private _scheduleReconnect(): void {
        if (this.reconnectTimer) return;
        this.reconnectAttempts++;
        const delay = Math.min(
            500 * Math.pow(2, this.reconnectAttempts - 1),
            MAX_RECONNECT_DELAY_MS,
        );
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = undefined;
            this._connect();
        }, delay);
    }

    send(frame: EventFrame): void {
        if (!this.ws || this.ws.readyState !== 1 /* OPEN */) return;
        try {
            this.ws.send(JSON.stringify(frame));
        } catch {
            // swallow — dev tool, must not throw
        }
    }

    close(): void {
        this.closed = true;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = undefined;
        }
        if (this.ws) {
            try { this.ws.removeAllListeners?.(); } catch { /* ignore */ }
            try { this.ws.terminate?.(); } catch { /* ignore */ }
            this.ws = undefined;
        }
    }
}

// ─── HttpBatchTransport ───────────────────────────────────────────────────────

/** How long (ms) to buffer before a flush is triggered. Env override: HARNESS_FE_HTTP_FLUSH_MS */
const DEFAULT_FLUSH_MS = 500;
/** Max buffered events before an immediate flush. Env override: HARNESS_FE_HTTP_BATCH_SIZE */
const DEFAULT_BATCH_SIZE = 50;
/** Max events in outbox before oldest are dropped. */
const OUTBOX_CAP_EVENTS = 500;
/** Max bytes in outbox before oldest are dropped (~4 MB). */
const OUTBOX_CAP_BYTES = 4 * 1024 * 1024;
/** No-events hello ping interval (ms). */
const HELLO_PING_INTERVAL_MS = 30_000;
/** Retry parameters. */
const MAX_RETRY_ATTEMPTS = 5;
const RETRY_BASE_MS = 250;
const RETRY_MAX_MS = 30_000;

export class HttpBatchTransport implements Transport {
    private hello?: HelloFrame;
    private outbox: EventFrame[] = [];
    private outboxBytes = 0;
    private flushTimer?: ReturnType<typeof setTimeout>;
    private helloPingTimer?: ReturnType<typeof setTimeout>;
    private helloPingSent = false;
    private closed = false;
    private readonly baseUrl: string;
    private readonly flushMs: number;
    private readonly batchSize: number;

    constructor(private readonly opts: RegisterOptions) {
        // Derive base URL from mcpUrl (ws://host:port → http://host:port) or explicit baseUrl
        const explicitBaseUrl = (opts as RegisterOptions & { baseUrl?: string }).baseUrl;
        if (explicitBaseUrl) {
            this.baseUrl = explicitBaseUrl;
        } else if (opts.mcpUrl) {
            this.baseUrl = opts.mcpUrl.replace(/^ws(s?):\/\//, 'http$1://');
        } else {
            this.baseUrl = `http://127.0.0.1:${DEFAULT_WS_PORT}`;
        }
        this.flushMs = (() => {
            const v = parseInt(process.env.HARNESS_FE_HTTP_FLUSH_MS ?? '', 10);
            return isNaN(v) ? DEFAULT_FLUSH_MS : v;
        })();
        this.batchSize = (() => {
            const v = parseInt(process.env.HARNESS_FE_HTTP_BATCH_SIZE ?? '', 10);
            return isNaN(v) ? DEFAULT_BATCH_SIZE : v;
        })();
    }

    open(hello: HelloFrame): Promise<void> {
        this.hello = hello;
        this.closed = false;
        // Schedule a hello-only ping if no events arrive within 30s
        this._scheduleHelloPing();
        return Promise.resolve();
    }

    send(frame: EventFrame): void {
        if (this.closed) return;

        // Cap outbox by event count and byte size
        const frameBytes = Buffer.byteLength(JSON.stringify(frame), 'utf-8');
        while (
            this.outbox.length >= OUTBOX_CAP_EVENTS ||
            this.outboxBytes + frameBytes > OUTBOX_CAP_BYTES
        ) {
            const dropped = this.outbox.shift();
            if (dropped) {
                this.outboxBytes -= Buffer.byteLength(JSON.stringify(dropped), 'utf-8');
                if (this.outboxBytes < 0) this.outboxBytes = 0;
            } else {
                break;
            }
        }
        this.outbox.push(frame);
        this.outboxBytes += frameBytes;

        if (this.outbox.length >= this.batchSize) {
            this._flush();
        } else {
            this._scheduleFlush();
        }
    }

    close(): void {
        this.closed = true;
        if (this.flushTimer) {
            clearTimeout(this.flushTimer);
            this.flushTimer = undefined;
        }
        if (this.helloPingTimer) {
            clearTimeout(this.helloPingTimer);
            this.helloPingTimer = undefined;
        }
        // Best-effort final flush
        if (this.outbox.length > 0 || !this.helloPingSent) {
            void this._doFlush(this.outbox.splice(0));
            this.outboxBytes = 0;
        }
    }

    private _scheduleFlush(): void {
        if (this.flushTimer) return;
        this.flushTimer = setTimeout(() => {
            this.flushTimer = undefined;
            this._flush();
        }, this.flushMs);
    }

    private _scheduleHelloPing(): void {
        if (this.helloPingTimer) return;
        this.helloPingTimer = setTimeout(() => {
            this.helloPingTimer = undefined;
            if (!this.helloPingSent && this.outbox.length === 0) {
                // Send a hello-only POST so the daemon knows about this peer
                void this._doFlush([]);
            }
        }, HELLO_PING_INTERVAL_MS);
    }

    private _flush(): void {
        if (this.closed) return;
        const batch = this.outbox.splice(0);
        this.outboxBytes = 0;
        void this._doFlush(batch);
    }

    private async _doFlush(events: EventFrame[]): Promise<void> {
        if (!this.hello) return;
        this.helloPingSent = true;
        const body = JSON.stringify({
            hello: this.hello,
            events,
        });
        let attempt = 0;
        while (attempt < MAX_RETRY_ATTEMPTS) {
            try {
                // Use globalThis.fetch (available in Node 18+ and all edge runtimes)
                const resp = await globalThis.fetch(`${this.baseUrl}/events`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body,
                });
                if (resp.ok || resp.status === 204) return; // success
                if (resp.status >= 400 && resp.status < 500) {
                    // Client error — no point retrying
                    process.stderr.write(
                        `[harness-fe] http-batch rejected (${resp.status}) — dropping ${events.length} events\n`,
                    );
                    return;
                }
                // 5xx: retry
            } catch {
                // Network error: retry
            }
            attempt++;
            if (attempt >= MAX_RETRY_ATTEMPTS) {
                process.stderr.write(
                    `[harness-fe] http-batch: max retries exceeded — dropping ${events.length} events\n`,
                );
                return;
            }
            const delay = Math.min(RETRY_BASE_MS * Math.pow(2, attempt - 1), RETRY_MAX_MS);
            await new Promise<void>((res) => setTimeout(res, delay));
        }
    }
}

// ─── Transport selector ───────────────────────────────────────────────────────

function canLoadWs(): boolean {
    try {
        require('ws');
        return true;
    } catch {
        return false;
    }
}

export function selectTransport(opts: RegisterOptions): Transport {
    const forceHttp =
        process.env.NEXT_RUNTIME === 'edge' ||
        process.env.HARNESS_FE_TRANSPORT === 'http';
    if (forceHttp) return new HttpBatchTransport(opts);
    try {
        if (canLoadWs()) return new WsTransport(opts);
    } catch {
        // fall through
    }
    return new HttpBatchTransport(opts);
}
