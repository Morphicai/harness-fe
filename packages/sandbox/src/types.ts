/**
 * @harness-fe/sandbox public types.
 *
 * The lib provides two layers of API per channel:
 *   1. Observer: pure side-channel notification of what happened.
 *   2. Interceptor: synchronous (or async on fetch/xhr/ws) hooks that can
 *      MUTATE the operation — rewrite args, block, short-circuit.
 *
 * Failure of any patch step never throws to caller code — every channel
 * degrades silently and the affected `enabled[channel]` flag turns false.
 */

/** Where an operation originates in caller code. Best-effort. */
export interface Initiator {
    /** Trimmed JS stack — first frame is the caller of the wrapped API. */
    stack?: string;
}

/** Optional attribution to a build-time-injected module id. v0 placeholder. */
export interface ModuleAttribution {
    /** Reserved for the future build plugin. Always undefined in pure runtime use. */
    moduleId?: string;
}

/** Context passed to every interceptor and observer. */
export interface SandboxCtx extends ModuleAttribution {
    /** Channel name, e.g. 'fetch' / 'storage'. */
    channel: SandboxChannel;
    /** Sub-kind within the channel, e.g. 'req' / 'res' / 'set' / 'recv'. */
    kind: string;
    /** Caller stack at the call site. May be empty if `captureInitiator: false`. */
    initiator: Initiator;
    /** UTC ms timestamp at the call entry. */
    ts: number;
}

export type SandboxChannel =
    | 'fetch'
    | 'xhr'
    | 'ws'
    | 'storage'
    | 'navigation'
    | 'console'
    | 'errors'
    | 'globals'
    | 'indexeddb'
    | 'dialogs';

// ───────────────────────────────────────────────────────────────────
// Channel observation shapes (what the observer onEvent receives)
// ───────────────────────────────────────────────────────────────────

export interface FetchReqObservation {
    id: string;
    method: string;
    url: string;
    headers?: Record<string, string>;
    body?: unknown;
    bodyTruncated?: boolean;
}

export interface FetchResObservation {
    id: string;
    method: string;
    url: string;
    status?: number;
    headers?: Record<string, string>;
    body?: unknown;
    bodyTruncated?: boolean;
    durationMs?: number;
    error?: string;
}

export interface XhrReqObservation extends FetchReqObservation {}
export interface XhrResObservation extends FetchResObservation {}

export interface WsObservation {
    id: string;
    phase: 'open' | 'send' | 'recv' | 'close';
    url: string;
    protocols?: string[];
    payload?: unknown;
    payloadTruncated?: boolean;
    code?: number;
    reason?: string;
    wasClean?: boolean;
}

export interface StorageObservation {
    op: 'get' | 'set' | 'remove' | 'clear';
    which: 'local' | 'session' | 'cookie';
    key?: string;
    value?: string;
    /** True when the change came from another tab via the native `storage` event. */
    crossTab?: boolean;
}

export interface NavigationObservation {
    /**
     * - push    : history.pushState
     * - replace : history.replaceState
     * - pop     : popstate event (browser back/forward)
     * - hash    : hashchange event / location.hash setter
     * - assign  : location.href setter / location.assign() / location.replace()
     */
    kind: 'push' | 'replace' | 'pop' | 'hash' | 'assign';
    url?: string;
    state?: unknown;
    /** true for replace-style operations (no new history entry). */
    replace?: boolean;
}

export interface ConsoleObservation {
    level: 'log' | 'info' | 'warn' | 'error' | 'debug';
    args: unknown[];
}

export interface ErrorObservation {
    kind: 'error' | 'unhandledrejection';
    message: string;
    stack?: string;
    source?: string;
}

// ─── globals (window.X) ───────────────────────────────────────────
export interface GlobalsObservation {
    op: 'get' | 'set' | 'delete';
    key: string;
    value?: unknown;
    /** Previous value seen at the time of set, if known. */
    previousValue?: unknown;
}

// ─── dialogs ─────────────────────────────────────────────────────
export interface DialogsObservation {
    /**
     * - alert        : window.alert() — agent triggered, suppressed
     * - confirm      : window.confirm() — agent triggered, returns preset or false
     * - prompt       : window.prompt() — agent triggered, returns preset or null
     * - print        : window.print() — agent triggered, suppressed
     * - file_input_click : HTMLInputElement(type=file).click() — agent triggered
     * - beforeunload : beforeunload event fired while agent is in progress
     */
    type: 'alert' | 'confirm' | 'prompt' | 'print' | 'file_input_click' | 'beforeunload';
    /** The message string for alert/confirm/prompt. */
    message?: string;
    /** The value returned to the caller (confirm → boolean, prompt → string | null). */
    returnValue?: boolean | string | null;
    /** Best-effort CSS selector for the file input element that was clicked. */
    selector?: string;
}

// ─── indexeddb ────────────────────────────────────────────────────
export interface IndexedDbObservation {
    op: 'open' | 'put' | 'add' | 'get' | 'getAll' | 'delete' | 'clear' | 'cursor';
    /** Database name. */
    db?: string;
    /** Version (for open). */
    version?: number;
    /** Object store name (for non-open). */
    store?: string;
    /** Key being operated on. */
    key?: unknown;
    /** Value being written (for put/add). */
    value?: unknown;
    /** True when the request resolves with success. */
    success?: boolean;
    /** Error message when the request fails. */
    error?: string;
}

// ───────────────────────────────────────────────────────────────────
// SandboxEvent discriminated union
// ───────────────────────────────────────────────────────────────────

export type SandboxEvent =
    | { ts: number; source: 'fetch'; kind: 'req' | 'res'; data: FetchReqObservation | FetchResObservation; initiator?: Initiator; moduleId?: string }
    | { ts: number; source: 'xhr'; kind: 'req' | 'res'; data: XhrReqObservation | XhrResObservation; initiator?: Initiator; moduleId?: string }
    | { ts: number; source: 'ws'; kind: WsObservation['phase']; data: WsObservation; initiator?: Initiator; moduleId?: string }
    | { ts: number; source: 'storage'; kind: StorageObservation['op']; data: StorageObservation; initiator?: Initiator; moduleId?: string }
    | { ts: number; source: 'navigation'; kind: NavigationObservation['kind']; data: NavigationObservation; initiator?: Initiator; moduleId?: string }
    | { ts: number; source: 'console'; kind: ConsoleObservation['level']; data: ConsoleObservation; initiator?: Initiator; moduleId?: string }
    | { ts: number; source: 'errors'; kind: ErrorObservation['kind']; data: ErrorObservation; initiator?: Initiator; moduleId?: string }
    | { ts: number; source: 'globals'; kind: GlobalsObservation['op']; data: GlobalsObservation; initiator?: Initiator; moduleId?: string }
    | { ts: number; source: 'indexeddb'; kind: IndexedDbObservation['op']; data: IndexedDbObservation; initiator?: Initiator; moduleId?: string }
    | { ts: number; source: 'dialogs'; kind: DialogsObservation['type']; data: DialogsObservation; initiator?: Initiator; moduleId?: string };

// ───────────────────────────────────────────────────────────────────
// Interceptor hooks per channel
// ───────────────────────────────────────────────────────────────────

/**
 * Common return semantics across interceptors:
 *   - returning `undefined` / `void` → pass through unchanged.
 *   - returning a new value object → use the new value.
 *   - returning `false` → block the operation entirely (no side effect, observer
 *                        still sees a "blocked" observation).
 *   - returning a "short-circuit" value (channel-specific, e.g. a Response for
 *                        fetch) → skip native operation and use this result.
 */
export type InterceptResult<T> = T | false | undefined | void;

export interface FetchInterceptor {
    /** Called BEFORE native fetch. Can rewrite the request, abort (false), or short-circuit (Response). */
    onRequest?(req: FetchReqObservation, ctx: SandboxCtx): InterceptResult<FetchReqObservation | Response> | Promise<InterceptResult<FetchReqObservation | Response>>;
    /** Called AFTER native fetch resolves. Can rewrite response or short-circuit with a new Response. */
    onResponse?(res: Response, req: FetchReqObservation, ctx: SandboxCtx): Response | Promise<Response> | undefined | void;
}

export interface XhrInterceptor {
    onRequest?(req: XhrReqObservation, ctx: SandboxCtx): InterceptResult<XhrReqObservation> | Promise<InterceptResult<XhrReqObservation>>;
    onResponse?(res: XhrResObservation, ctx: SandboxCtx): XhrResObservation | undefined | void;
}

export interface WsInterceptor {
    /** Before `new OriginalWebSocket(...)`. Return false to skip; or a new instance to substitute. */
    onConstruct?(url: string, protocols: string[] | undefined, ctx: SandboxCtx): InterceptResult<{ url: string; protocols?: string[] }>;
    /** Before frame goes out. Return false to drop; return new payload to rewrite. */
    onSend?(payload: unknown, wsId: string, ctx: SandboxCtx): InterceptResult<unknown>;
    /** Before frame is delivered to listeners. Return false to drop; return new payload to rewrite. */
    onMessage?(payload: unknown, wsId: string, ctx: SandboxCtx): InterceptResult<unknown>;
    /** Observe-only close. */
    onClose?(code: number | undefined, reason: string | undefined, wsId: string, ctx: SandboxCtx): void;
}

export interface StorageInterceptor {
    /** Override get. Return a string to substitute; undefined to passthrough. */
    onGet?(key: string, which: StorageObservation['which'], ctx: SandboxCtx): string | null | undefined;
    /** Before set. Return false to block; return { key, value } to rewrite. */
    onSet?(key: string, value: string, which: StorageObservation['which'], ctx: SandboxCtx): InterceptResult<{ key: string; value: string }>;
    /** Before remove. Return false to block. */
    onRemove?(key: string, which: StorageObservation['which'], ctx: SandboxCtx): InterceptResult<void>;
    /** Before clear. Return false to block. */
    onClear?(which: StorageObservation['which'], ctx: SandboxCtx): InterceptResult<void>;
}

export interface NavigationInterceptor {
    /** Before history.pushState. */
    onPush?(url: string | undefined, state: unknown, ctx: SandboxCtx): InterceptResult<{ url?: string; state?: unknown }>;
    /** Before history.replaceState. */
    onReplace?(url: string | undefined, state: unknown, ctx: SandboxCtx): InterceptResult<{ url?: string; state?: unknown }>;
    /** Before location.href = ..., location.assign() or location.replace(). */
    onAssign?(url: string, replace: boolean, ctx: SandboxCtx): InterceptResult<string>;
    /** Before location.hash = .... */
    onHash?(hash: string, ctx: SandboxCtx): InterceptResult<string>;
}

export interface GlobalsInterceptor {
    /**
     * Keys on `window` to watch. Default empty (nothing observed). Pre-installed
     * keys (`location`, `document`, etc.) cannot be watched — they're skipped silently.
     */
    watch?: string[];
    /** Override read. Return undefined for passthrough. */
    onGet?(key: string, value: unknown, ctx: SandboxCtx): unknown | undefined;
    /** Hook write. Return false to block, a new value to rewrite. */
    onSet?(key: string, value: unknown, ctx: SandboxCtx): InterceptResult<unknown>;
    /** Hook delete (`delete window.foo`). Return false to block. */
    onDelete?(key: string, ctx: SandboxCtx): InterceptResult<void>;
}

export interface IndexedDbInterceptor {
    /** Hook database open. Return { name?, version? } to rewrite. */
    onOpen?(name: string, version: number | undefined, ctx: SandboxCtx): InterceptResult<{ name?: string; version?: number }>;
    /** Hook put / add. Return { value, key? } to rewrite, false to block. */
    onPut?(store: string, key: unknown, value: unknown, ctx: SandboxCtx): InterceptResult<{ key?: unknown; value?: unknown }>;
    /** Hook get. Return a value to short-circuit (the IDBRequest resolves with it). */
    onGet?(store: string, key: unknown, ctx: SandboxCtx): unknown | undefined;
    /** Hook delete. Return false to block. */
    onDelete?(store: string, key: unknown, ctx: SandboxCtx): InterceptResult<void>;
    /** Hook clear. Return false to block. */
    onClear?(store: string, ctx: SandboxCtx): InterceptResult<void>;
}

// ───────────────────────────────────────────────────────────────────
// Top-level options & handle
// ───────────────────────────────────────────────────────────────────

export interface SandboxOptions {
    /** Pure cross-channel observer. Called after interceptors have run. */
    onEvent?: (event: SandboxEvent) => void;

    fetch?: FetchInterceptor;
    xhr?: XhrInterceptor;
    ws?: WsInterceptor;
    storage?: StorageInterceptor;
    navigation?: NavigationInterceptor;
    globals?: GlobalsInterceptor;
    indexeddb?: IndexedDbInterceptor;

    /**
     * Allowlist of channels to enable. When set, ALL channels NOT in the list
     * stay completely uninstalled — their patches are never even applied to
     * the page. This is the "I only need fetch" mode.
     *
     * Mutually exclusive with `observe`: when both are set, `only` wins and
     * `observe` is ignored.
     */
    only?: SandboxChannel[];

    /**
     * Selectively disable channels. All default to enabled. Use this as a
     * denylist when you want most channels but specifically NOT one or two.
     *
     * Example: `observe: { storage: false }` enables 8 channels, skips storage.
     */
    observe?: Partial<Record<SandboxChannel, boolean>>;

    /** Per-body byte cap for fetch/xhr/ws payloads. Default 256 KB. */
    bodyCap?: number;

    /** URL patterns (regex strings) the patches should skip entirely. */
    denylist?: RegExp[];

    /** URLs to fully skip wrapping — typically the daemon URL to avoid self-loop. */
    selfUrls?: string[];

    /** Disable initiator stack capture. Default: true. */
    captureInitiator?: boolean;
}

export interface SandboxHandle {
    /** Dispose this install. LIFO with respect to multi-install chain. */
    dispose(): void;

    /** Pause event emission for this install (patches remain). */
    pause(): void;
    resume(): void;

    /** Per-channel runtime status: true if successfully patched. */
    readonly enabled: Readonly<Record<SandboxChannel, boolean>>;
}
