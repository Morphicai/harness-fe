/**
 * Runtime client core. Connects to the MCP server over WS, executes
 * commands dispatched by the server, and forwards page events back.
 *
 * Started lazily by `auto-start.ts` when the script is imported.
 */

import {
    ALWAYS_CONFIRM_COMMANDS,
    COMMAND,
    DEFAULT_WS_PORT,
    EVENT_NAME,
    requiresConsent,
    type CommandFrame,
    type ConsentDecision,
    type ConsentMode,
    type ConsentRequest,
    type EventFrame,
    type Frame,
    type HelloAckFrame,
    type HelloFrame,
    type ResponseFrame,
    frameSchema,
} from '@harness-fe/protocol';
import { getCaptureStore } from './capture.js';
import { commandHandlers, type CommandContext } from './commands.js';
import { Outbox } from './outbox.js';
import { RrwebRecorder } from './recording.js';
import { chunkHasFullSnapshot } from './rrweb-types.js';
import { collectPageLoadSnapshot } from './snapshot.js';
import {
    collectEnv,
    getOrCreateVisitorId,
    publishVisitorIdToWindow,
    tryInheritVisitorFromParent,
} from './visitor.js';
import type { QueryFrame, QueryMethod, QueryResponseFrame } from '@harness-fe/protocol';

export interface ClientOptions {
    projectId: string;
    mcpUrl?: string;
    /**
     * Build artifact id, threaded through `window.__HARNESS_FE__.buildId`.
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
     * by visitorId). Propagated by HarnessScript via window.__HARNESS_FE__.userId.
     */
    userId?: string;
    /**
     * How often (in ms) rrweb should emit a fresh FullSnapshot baseline.
     * Defaults to 30 minutes. Set to 0 to disable periodic baselines (the
     * recorder still emits one at start() and one per ws reconnect).
     * See {@link RrwebRecorderOptions.checkoutEveryNms} for the trade-off.
     */
    rrwebCheckoutEveryNms?: number;
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

/**
 * Attempt to read a server-generated sessionId from `window.__HARNESS_FE_SEED__`
 * or from `window.__HARNESS_FE__.sessionId` (both written by `<HarnessScript>`).
 *
 * When found, the client adopts that id instead of generating its own. This
 * ensures server-side events emitted by `@harness-fe/node-runtime` during
 * the same request and client-side events all land in the same
 * `sessions/{sessionId}/timeline.jsonl` on the daemon.
 *
 * Returns `undefined` when no seed is present (e.g. app doesn't use
 * `<HarnessScript>` or running outside a browser).
 */
function tryAdoptServerSeed(): string | undefined {
    if (typeof window === 'undefined') return undefined;
    const w = window as unknown as {
        __HARNESS_FE_SEED__?: { sessionId?: string };
        __HARNESS_FE__?: { sessionId?: string };
    };
    return w.__HARNESS_FE_SEED__?.sessionId ?? w.__HARNESS_FE__?.sessionId;
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
    get mcpUrl(): string | undefined { return this.opts.mcpUrl; }
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
    // Browser consent (4.0 · P2). Mode comes from the daemon in hello.ack;
    // default `off` so a daemon that never sends a policy (or loopback solo
    // dev) keeps running control commands without prompting.
    private consentMode: ConsentMode = 'off';
    /** Set once the user grants blanket control for this pageload (mode=session). */
    private consentSessionGranted = false;
    /** Set by the overlay to collect the user's decision. Absent ⇒ fail-safe deny. */
    private consentPrompter?: (req: ConsentRequest) => Promise<ConsentDecision>;
    private readonly ctx: CommandContext = { capture: getCaptureStore() };
    // Initialized in constructor (parameter property `opts` isn't readable at
    // class-field-initializer time — field initializers run before parameter
    // property assignment).
    private readonly recorder: RrwebRecorder;
    private reconnectAttempts = 0;
    private closed = false;
    private static readonly MAX_OUTBOX_FRAMES = 500;
    private static readonly MAX_OUTBOX_BYTES = 8 * 1024 * 1024;
    private readonly outbox = new Outbox(
        RuntimeClient.MAX_OUTBOX_FRAMES,
        RuntimeClient.MAX_OUTBOX_BYTES,
    );

    constructor(private readonly opts: ClientOptions) {
        const inherited = _tryInheritFromParent();
        this.tabId = inherited.tabId ?? getOrCreateTabId();
        // Priority: iframe parent seed > server seed > fresh generation.
        this.sessionId = inherited.sessionId ?? tryAdoptServerSeed() ?? generateSessionId();
        // Explicit option wins over runtime auto-detection.
        this.parentProjectId = opts.parentProjectId ?? inherited.parentProjectId;
        // Same-origin iframes share a visitorId so the journey stitches across
        // micro-frontends. Cross-origin children fall back to their own.
        const inheritedVisitor = tryInheritVisitorFromParent();
        this.visitorId = inheritedVisitor ?? getOrCreateVisitorId();
        publishVisitorIdToWindow(this.visitorId);
        this.recorder = new RrwebRecorder(
            (chunk) => this.sendEvent(EVENT_NAME.RRWEB, chunk),
            { checkoutEveryNms: opts.rrwebCheckoutEveryNms },
        );
    }


    start(): void {
        const daemonUrl = this.opts.mcpUrl ?? `ws://127.0.0.1:${DEFAULT_WS_PORT}/ws`;
        this.ctx.capture.install(
            (name, payload) => this.sendEvent(name, payload),
            { daemonUrl },
        );
        this.recorder.start();
        this.connect();
    }

    stop(): void {
        this.closed = true;
        this.recorder.stop();
        this.ws?.close();
    }

    private connect(): void {
        const url = this.opts.mcpUrl ?? `ws://127.0.0.1:${DEFAULT_WS_PORT}/ws`;
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

    /**
     * Register the consent prompter (the overlay installs this). When the
     * policy is on and a control command arrives, the client asks this for the
     * user's decision. Without it, gated commands are denied (fail-safe).
     */
    setConsentPrompter(fn: (req: ConsentRequest) => Promise<ConsentDecision>): void {
        this.consentPrompter = fn;
    }

    private onHelloAck(frame: HelloAckFrame): void {
        if (frame.error) {
            // Bridge rejected this hello — do not send PAGE_LOAD.
            return;
        }
        // Adopt the daemon's consent policy for this connection (4.0 · P2).
        this.consentMode = frame.consent?.mode ?? 'off';
        // Force a fresh rrweb FullSnapshot on every ack — including reconnects
        // after daemon restart, network blips, or page-recovery from sleep.
        // Without this, the only baseline for the session is whatever rrweb
        // emitted at start(); if that chunk was evicted from the outbox
        // (FIFO overflow during a long disconnect) or the daemon was down at
        // the critical moment, the session is unreplayable forever.
        // Safe to call on every ack: rrweb emits another type:2, replay
        // engines treat additional baselines as a checkpoint reset.
        this.recorder.takeFullSnapshot();

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
        // Browser-consent gate (4.0 · P2): control commands need the user's
        // OK in the page before they run when the daemon enabled consent.
        if (requiresConsent(frame.command, this.consentMode, this.consentSessionGranted)) {
            const decision = await this.requestConsent(frame);
            if (decision === 'deny') {
                this.send({
                    type: 'response',
                    id: frame.id,
                    ok: false,
                    error: { code: 'CONSENT_DENIED', message: `user denied "${frame.command}"` },
                } satisfies ResponseFrame);
                return;
            }
            if (decision === 'session') this.consentSessionGranted = true;
            // 'once' → run this one without granting the rest of the session.
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

    /**
     * Ask the user (via the overlay-registered prompter) to approve a control
     * command. Fail-safe: if no prompter is registered, or it throws, deny —
     * a consent policy that can't ask must not silently allow.
     */
    private async requestConsent(frame: CommandFrame): Promise<ConsentDecision> {
        if (!this.consentPrompter) return 'deny';
        const req: ConsentRequest = {
            command: frame.command,
            args: frame.args,
            tabId: this.tabId,
            alwaysConfirm: ALWAYS_CONFIRM_COMMANDS.has(frame.command),
        };
        try {
            return await this.consentPrompter(req);
        } catch {
            return 'deny';
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
                reject(new Error(`harness-fe query "${method}" timed out after ${timeoutMs}ms`));
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
        this.outbox.enqueue(payload, isStickyFrame(frame));
    }

    private drainOutbox(): void {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        this.outbox.flush((payload) => {
            this.ws!.send(payload);
        });
    }
}

/**
 * Decide whether an outgoing frame must survive outbox eviction.
 *
 * Today: any rrweb chunk that contains a FullSnapshot (type:2). Without
 * this, the FullSnapshot — being the *first* rrweb frame emitted at
 * recorder start — was always the oldest in the outbox and the FIFO
 * evictor dropped it first when the daemon was unreachable. That left the
 * session unreplayable for its entire life.
 */
function isStickyFrame(frame: Frame): boolean {
    if (frame.type !== 'event') return false;
    if (frame.name !== EVENT_NAME.RRWEB) return false;
    const payload = frame.payload as { events?: unknown[] } | undefined;
    if (!payload || !Array.isArray(payload.events)) return false;
    return chunkHasFullSnapshot(payload as { events: unknown[] });
}

/** Pull the well-known config object planted by the Vite plugin on window. */
export function readInjectedConfig(): ClientOptions {
    const w = window as unknown as {
        __HARNESS_FE__?: {
            projectId?: string;
            mcpUrl?: string;
            buildId?: string;
            parentProjectId?: string;
            displayName?: string;
            userId?: string;
            sessionId?: string;
        };
    };
    return {
        projectId: w.__HARNESS_FE__?.projectId ?? 'unknown-project',
        mcpUrl: w.__HARNESS_FE__?.mcpUrl,
        buildId: w.__HARNESS_FE__?.buildId,
        parentProjectId: w.__HARNESS_FE__?.parentProjectId,
        displayName: w.__HARNESS_FE__?.displayName,
        userId: w.__HARNESS_FE__?.userId,
    };
}

/** Re-export command names for outside callers. */
export { COMMAND };
