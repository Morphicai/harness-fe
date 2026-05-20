/**
 * Runtime client core. Connects to the MCP server over WS, executes
 * commands dispatched by the server, and forwards page events back.
 *
 * Started lazily by `auto-start.ts` when the script is imported.
 */

import {
    COMMAND,
    DEFAULT_WS_PORT,
    EVENT_NAME,
    type CommandFrame,
    type EventFrame,
    type Frame,
    type HelloAckFrame,
    type HelloFrame,
    type ResponseFrame,
    frameSchema,
} from '@harnessa-fe/protocol';
import { getCaptureStore } from './capture.js';
import { commandHandlers, type CommandContext } from './commands.js';
import { RrwebRecorder } from './recording.js';
import { collectPageLoadSnapshot } from './snapshot.js';
import {
    collectEnv,
    getOrCreateVisitorId,
    publishVisitorIdToWindow,
    tryInheritVisitorFromParent,
} from './visitor.js';
import type { QueryFrame, QueryMethod, QueryResponseFrame } from '@harnessa-fe/protocol';

export interface ClientOptions {
    projectId: string;
    mcpUrl?: string;
    /**
     * Build artifact id, threaded through `window.__HARNESSA_FE__.buildId`.
     * Stamped on every event so agents can trace "what code was running".
     */
    buildId?: string;
    /**
     * Parent project's id. Set by the plugin when the host app declares it,
     * or auto-inferred at runtime via `tryInheritFromParent()` when this
     * runtime is loaded inside a same-origin iframe.
     */
    parentProjectId?: string;
    /** Optional human-readable name; mostly used by the project tree. */
    displayName?: string;
    /**
     * App-supplied user identifier (e.g. supabase.user.id, auth0 sub, …).
     * Optional. When absent, traffic is treated as anonymous (only stitched
     * by visitorId). Propagated by HarnessaScript via window.__HARNESSA_FE__.userId.
     */
    userId?: string;
}

const TAB_ID_KEY = '__hfe_tab_id__';

function getOrCreateTabId(): string {
    try {
        const existing = sessionStorage.getItem(TAB_ID_KEY);
        if (existing) return existing;
        const id = `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
        sessionStorage.setItem(TAB_ID_KEY, id);
        return id;
    } catch {
        return `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
    }
}

/**
 * Generate a fresh sessionId for this page load. Intentionally NOT persisted
 * to sessionStorage — a refresh MUST yield a new id. WebSocket reconnects
 * within the same page load reuse this in-memory value.
 *
 * (Previously called `loadId`; renamed to align with the narrative model
 *  where one page-load = one "session" of user activity.)
 */
function generateSessionId(): string {
    try {
        return crypto.randomUUID();
    } catch {
        return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    }
}

// Re-export inheritance helper. Implementation lives in parent-inherit.ts
// so its unit tests can import it without dragging the rrweb-dependent
// recorder module into the test runtime.
export { tryInheritFromParent } from './parent-inherit.js';
export type { ParentInheritance } from './parent-inherit.js';
import { tryInheritFromParent as _tryInheritFromParent } from './parent-inherit.js';

export class RuntimeClient {
    private ws?: WebSocket;
    readonly tabId: string;
    readonly sessionId: string;
    readonly visitorId: string;
    readonly parentProjectId?: string;

    /** Read-only accessors exposed for the in-page info panel. */
    get projectId(): string { return this.opts.projectId; }
    get buildId(): string | undefined { return this.opts.buildId; }
    get displayName(): string | undefined { return this.opts.displayName; }
    get userId(): string | undefined { return this.opts.userId; }
    /** WebSocket state: 'connecting' | 'open' | 'closed'. */
    getConnectionState(): 'connecting' | 'open' | 'closed' {
        if (!this.ws) return 'closed';
        switch (this.ws.readyState) {
            case WebSocket.OPEN: return 'open';
            case WebSocket.CONNECTING: return 'connecting';
            default: return 'closed';
        }
    }
    private pageLoadSent = false;
    private readonly ctx: CommandContext = { capture: getCaptureStore() };
    private readonly recorder = new RrwebRecorder((chunk) => this.sendEvent(EVENT_NAME.RRWEB, chunk));
    private reconnectAttempts = 0;
    private closed = false;
    /**
     * Pre-handshake / reconnect outbox.
     *
     * Frames produced before the WebSocket reaches OPEN (or while it is
     * temporarily down during reconnect) used to be silently dropped. That
     * was particularly bad for rrweb: the *very first* chunk contains the
     * Meta + FullSnapshot baseline frames — without it, every later
     * incremental snapshot is useless for replay. We now buffer in FIFO order
     * and flush on `open`. Capped to defend against OOM if the bridge is
     * unreachable for an extended period.
     */
    private outbox: string[] = [];
    private outboxBytes = 0;
    private static readonly MAX_OUTBOX_FRAMES = 500;
    private static readonly MAX_OUTBOX_BYTES = 8 * 1024 * 1024;

    constructor(private readonly opts: ClientOptions) {
        const inherited = _tryInheritFromParent();
        this.tabId = inherited.tabId ?? getOrCreateTabId();
        this.sessionId = inherited.sessionId ?? generateSessionId();
        // Explicit option wins over runtime auto-detection.
        this.parentProjectId = opts.parentProjectId ?? inherited.parentProjectId;
        // Same-origin iframes share a visitorId so the journey stitches across
        // micro-frontends. Cross-origin children fall back to their own.
        const inheritedVisitor = tryInheritVisitorFromParent();
        this.visitorId = inheritedVisitor ?? getOrCreateVisitorId();
        publishVisitorIdToWindow(this.visitorId);
    }


    start(): void {
        this.ctx.capture.install((name, payload) => this.sendEvent(name, payload));
        this.recorder.start();
        this.connect();
    }

    stop(): void {
        this.closed = true;
        this.recorder.stop();
        this.ws?.close();
    }

    private connect(): void {
        const url = this.opts.mcpUrl ?? `ws://127.0.0.1:${DEFAULT_WS_PORT}`;
        try {
            this.ws = new WebSocket(url);
        } catch (err) {
            console.warn('[morphix-dev-bridge] failed to construct WebSocket', err);
            return;
        }
        this.ws.addEventListener('open', () => this.onOpen());
        this.ws.addEventListener('message', (ev) => this.onMessage(ev));
        this.ws.addEventListener('close', () => this.onClose());
        this.ws.addEventListener('error', () => {
            /* close will follow */
        });
    }

    private onOpen(): void {
        this.reconnectAttempts = 0;
        const hello: HelloFrame = {
            type: 'hello',
            id: crypto.randomUUID(),
            role: 'runtime-client',
            projectId: this.opts.projectId,
            parentProjectId: this.parentProjectId,
            displayName: this.opts.displayName,
            buildId: this.opts.buildId,
            tabId: this.tabId,
            sessionId: this.sessionId,
            visitorId: this.visitorId,
            userId: this.opts.userId,
            env: collectEnv(),
            page: {
                url: location.href,
                title: document.title,
                userAgent: navigator.userAgent,
            },
        };
        this.send(hello);
        // Any pre-OPEN frames (rrweb chunk 1 with the Meta+FullSnapshot
        // baseline is the canonical example) get flushed *after* hello, so
        // the daemon has a registered peer before they arrive.
        this.drainOutbox();
    }

    private onClose(): void {
        if (this.closed) return;
        const delay = Math.min(15_000, 500 * 2 ** Math.min(this.reconnectAttempts, 5));
        this.reconnectAttempts++;
        setTimeout(() => {
            if (!this.closed) this.connect();
        }, delay);
    }

    private onMessage(ev: MessageEvent): void {
        let parsed: unknown;
        try {
            parsed = JSON.parse(String(ev.data));
        } catch {
            return;
        }
        const result = frameSchema.safeParse(parsed);
        if (!result.success) return;
        const frame = result.data;
        if (frame.type === 'command') this.handleCommand(frame);
        else if (frame.type === 'hello.ack') this.onHelloAck(frame);
        else if (frame.type === 'query.response') this.onQueryResponse(frame);
    }

    private onQueryResponse(frame: QueryResponseFrame): void {
        const pending = this.pendingQueries.get(frame.id);
        if (!pending) return;
        this.pendingQueries.delete(frame.id);
        if (frame.ok) {
            pending.resolve(frame.result);
        } else {
            pending.reject(new Error(frame.error?.message ?? 'query failed'));
        }
    }

    private onHelloAck(frame: HelloAckFrame): void {
        if (frame.error) {
            // Bridge rejected this hello — do not send PAGE_LOAD.
            return;
        }
        // Send the page-load snapshot exactly once per load. The reconnect
        // path also lands here; emit only on the first ack of this load.
        if (this.pageLoadSent) return;
        this.pageLoadSent = true;
        try {
            const payload = collectPageLoadSnapshot(this.sessionId);
            this.sendEvent(EVENT_NAME.PAGE_LOAD, payload);
        } catch {
            /* snapshot failures must not propagate */
        }
    }

    private async handleCommand(frame: CommandFrame): Promise<void> {
        const handler = commandHandlers[frame.command];
        if (!handler) {
            this.send({
                type: 'response',
                id: frame.id,
                ok: false,
                error: { code: 'UNKNOWN_COMMAND', message: `no handler for "${frame.command}"` },
            } satisfies ResponseFrame);
            return;
        }
        try {
            const result = await handler(frame.args ?? {}, this.ctx);
            this.send({
                type: 'response',
                id: frame.id,
                ok: true,
                result,
            } satisfies ResponseFrame);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.send({
                type: 'response',
                id: frame.id,
                ok: false,
                error: { message },
            } satisfies ResponseFrame);
        }
    }

    sendEvent(name: string, payload: unknown): void {
        const event: EventFrame = {
            type: 'event',
            id: crypto.randomUUID(),
            tabId: this.tabId,
            projectId: this.opts.projectId,
            // v0.2: stamp every event with sessionId + buildId so cross-project
            // queries (`session.timeline`, `build.timeline`) can filter without
            // extra lookups. v0.5 also stamps visitorId so visitor-scoped
            // filtering ("show me everything from this user") is row-level too.
            sessionId: this.sessionId,
            buildId: this.opts.buildId,
            visitorId: this.visitorId,
            name,
            ts: Date.now(),
            payload,
        };
        this.send(event);
    }

    /**
     * Request/reply RPC to the daemon. Currently used by the in-page
     * overlay to fetch / mutate the visitor's own tasks. Resolves with the
     * remote `result`, rejects with the remote `error.message` (or a
     * timeout after 10 s).
     */
    query<TResult = unknown>(method: QueryMethod, args?: unknown, timeoutMs = 10_000): Promise<TResult> {
        const id = crypto.randomUUID();
        const frame: QueryFrame = { type: 'query', id, method, args };
        return new Promise<TResult>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pendingQueries.delete(id);
                reject(new Error(`harnessa-fe query "${method}" timed out after ${timeoutMs}ms`));
            }, timeoutMs);
            this.pendingQueries.set(id, {
                resolve: (v: unknown) => { clearTimeout(timer); resolve(v as TResult); },
                reject: (e: Error) => { clearTimeout(timer); reject(e); },
            });
            this.send(frame);
        });
    }
    private pendingQueries = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

    private send(frame: Frame): void {
        let payload: string;
        try {
            payload = JSON.stringify(frame);
        } catch {
            return; // unserializable; drop
        }
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            try {
                this.ws.send(payload);
                return;
            } catch {
                // write failed mid-stream — fall through and buffer for retry
            }
        }
        this.enqueue(payload);
    }

    private enqueue(payload: string): void {
        this.outbox.push(payload);
        this.outboxBytes += payload.length;
        while (
            this.outbox.length > RuntimeClient.MAX_OUTBOX_FRAMES ||
            this.outboxBytes > RuntimeClient.MAX_OUTBOX_BYTES
        ) {
            const dropped = this.outbox.shift();
            if (dropped === undefined) break;
            this.outboxBytes -= dropped.length;
        }
    }

    private drainOutbox(): void {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        while (this.outbox.length > 0) {
            const payload = this.outbox[0]!;
            try {
                this.ws.send(payload);
            } catch {
                // Underlying socket failed; keep what remains for next drain.
                return;
            }
            this.outbox.shift();
            this.outboxBytes -= payload.length;
        }
    }
}

/** Pull the well-known config object planted by the Vite plugin on window. */
export function readInjectedConfig(): ClientOptions {
    const w = window as unknown as {
        __HARNESSA_FE__?: {
            projectId?: string;
            mcpUrl?: string;
            buildId?: string;
            parentProjectId?: string;
            displayName?: string;
            userId?: string;
        };
    };
    return {
        projectId: w.__HARNESSA_FE__?.projectId ?? 'unknown-project',
        mcpUrl: w.__HARNESSA_FE__?.mcpUrl,
        buildId: w.__HARNESSA_FE__?.buildId,
        parentProjectId: w.__HARNESSA_FE__?.parentProjectId,
        displayName: w.__HARNESSA_FE__?.displayName,
        userId: w.__HARNESSA_FE__?.userId,
    };
}

/** Re-export command names for outside callers. */
export { COMMAND };
