/**
 * @harnessa-fe/node-runtime
 *
 * Node.js server-side SDK. Connects to the Harnessa-FE daemon (morphix-dev-bridge)
 * with `role: 'node-runtime'`, captures server errors and optionally console
 * output, and links events to the per-request sessionId so server and client
 * events land in the same `~/.harnessa/data/sessions/{id}/timeline.jsonl`.
 *
 * Usage (Path A — explicit):
 *   // instrumentation.ts (Next.js 15+)
 *   export async function register() {
 *     if (process.env.NEXT_RUNTIME === 'nodejs') {
 *       const { register } = await import('@harnessa-fe/node-runtime');
 *       register({ projectId: 'my-app' });
 *     }
 *   }
 *
 * Usage (Path B — via withHarnessa):
 *   // next.config.mjs
 *   import { withHarnessa } from '@harnessa-fe/next/config';
 *   export default withHarnessa({ ... });
 *   // withHarnessa injects `import '@harnessa-fe/node-runtime/auto'` into the
 *   // server bundle, which auto-calls register() from env vars.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import {
    PROTOCOL_VERSION,
    type EventFrame,
    type HelloAckFrame,
} from '@harnessa-fe/protocol';
import { selectTransport, type Transport } from './transport.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RegisterOptions {
    /** Stable project id — typically the `name` from your package.json. */
    projectId: string;
    /** Human-readable display name. Defaults to projectId. */
    displayName?: string;
    /** Build artifact id — e.g. a git SHA. */
    buildId?: string;
    /** Daemon WebSocket URL. Defaults to `ws://127.0.0.1:47729`. */
    mcpUrl?: string;
    /** Daemon HTTP base URL (for HttpBatchTransport). Derived from mcpUrl when absent. */
    baseUrl?: string;
    /**
     * Capture `console.*` output and forward to daemon as `server-log` events.
     * Default: **on**. Set `HARNESSA_FE_NODE_CONSOLE=0` env var to disable
     * (or pass `captureConsole: false` here) when you don't want auto
     * forwarding — useful in noisy frameworks where you'd rather use
     * `@harnessa-fe/log` exclusively for structured logs.
     */
    captureConsole?: boolean;
}

export interface EventContext {
    /** Per-request sessionId. When provided, event is stored in the session timeline. */
    sessionId?: string;
    /** URL being handled. */
    url?: string;
}

// ── AsyncLocalStorage for request-scoped sessionId ───────────────────────────

/**
 * ALS store: maps the current async execution context to a request-scoped sessionId.
 * Set inside `withHarnessaTracing()` HOC or via `setRequestSessionId()`.
 */
const als = new AsyncLocalStorage<{ sessionId: string }>();

/**
 * Lazy-cached reference to `@harnessa-fe/next`'s React `cache()`-backed
 * sessionId getter. Primed asynchronously in `register()` and consulted
 * synchronously thereafter so the console-capture path can read it
 * without paying an `await` per log call.
 *
 * - `undefined` = not yet primed (very early calls miss this layer)
 * - `null`      = @harnessa-fe/next not installed → permanently fall through
 * - function    = ready; calling it returns the current request's sessionId
 *                 if we're inside a Server Component render, else undefined
 */
let cachedNextGetter: (() => string | undefined) | null | undefined = undefined;

async function primeNextSessionGetter(): Promise<void> {
    if (cachedNextGetter !== undefined) return;
    try {
        const mod = (await import('@harnessa-fe/next/sessionId')) as {
            getSessionId?: () => string;
        };
        cachedNextGetter = mod.getSessionId ?? null;
    } catch {
        cachedNextGetter = null;
    }
}

/**
 * Returns the sessionId for the currently executing request, or `undefined`
 * outside any traced scope.
 *
 * Resolution order:
 *   1. AsyncLocalStorage (populated by `withHarnessaTracing()` HOC)
 *   2. React `cache()` via `@harnessa-fe/next/sessionId` — automatic inside
 *      any Server Component render, Route Handler, or Server Action
 *
 * The `console.*` capture path calls this synchronously on every log; once
 * `register()` has primed the next-getter (a one-time async import), this
 * function is fully sync and adds only a single optional-chain check vs
 * the previous ALS-only implementation.
 */
export function getRequestSessionId(): string | undefined {
    // ALS wins because it's explicit user intent — if they bothered to wrap
    // a handler with withHarnessaTracing, respect that.
    const fromAls = als.getStore()?.sessionId;
    if (fromAls !== undefined) return fromAls;
    // Fall back to React cache() if it's primed and we're in a render scope.
    if (cachedNextGetter) {
        try {
            return cachedNextGetter();
        } catch {
            // cache() can throw if invoked outside a React render scope on
            // some React/Next combinations. Treat as "no sessionId here".
            return undefined;
        }
    }
    return undefined;
}

// ── SDK state ──────────────────────────────────────────────────────────────────

let transport: Transport | undefined;
let isRegistered = false;
let registeredOpts: RegisterOptions | undefined;

// ── Core send helper ──────────────────────────────────────────────────────────

function sendEvent(name: string, payload: unknown, ctx?: EventContext): void {
    if (!transport) return;
    const frame: EventFrame = {
        type: 'event',
        id: randomUUID(),
        name,
        ts: Date.now(),
        projectId: registeredOpts?.projectId,
        buildId: registeredOpts?.buildId,
        sessionId: ctx?.sessionId ?? getRequestSessionId(),
        payload,
    };
    transport.send(frame);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Reset internal SDK state. FOR TESTING ONLY — do not call in production.
 * Allows test suites to re-register with a different config.
 */
export function _resetForTest(): void {
    if (transport) {
        transport.close();
        transport = undefined;
    }
    isRegistered = false;
    registeredOpts = undefined;
    cachedNextGetter = undefined;
}

/**
 * Register the node-runtime SDK. Idempotent — safe to call multiple times;
 * only the first invocation has effect.
 *
 * Selects a transport automatically:
 *   - Edge Runtime (NEXT_RUNTIME=edge) or HARNESSA_FE_TRANSPORT=http → HttpBatchTransport
 *   - `ws` module available → WsTransport
 *   - Fallback → HttpBatchTransport
 *
 * Installs `process.on('uncaughtException')` + `unhandledRejection` handlers,
 * and optionally intercepts `console.*`.
 */
export function register(opts: RegisterOptions): void {
    if (isRegistered) return;
    isRegistered = true;
    registeredOpts = opts;

    const hello = {
        type: 'hello' as const,
        id: randomUUID(),
        role: 'node-runtime' as const,
        protocolVersion: PROTOCOL_VERSION,
        projectId: opts.projectId,
        displayName: opts.displayName ?? opts.projectId,
        buildId: opts.buildId,
    };

    transport = selectTransport(opts);
    void transport.open(hello);

    // Prime the React cache()-backed sessionId getter for the
    // synchronous console-capture path. One-time dynamic import, cached
    // for the lifetime of the process. Fires-and-forgets — if it loses
    // a race with the very first console.* call, that one falls through
    // to ALS / undefined gracefully.
    void primeNextSessionGetter();

    installProcessHandlers();

    // Default-on. Opt out via captureConsole: false OR HARNESSA_FE_NODE_CONSOLE=0.
    const captureConsole = opts.captureConsole ??
        (process.env.HARNESSA_FE_NODE_CONSOLE !== '0');
    if (captureConsole) {
        installConsoleCapture();
    }
}

/**
 * Explicitly report an error to the daemon.
 *
 * Called automatically for `uncaughtException` / `unhandledRejection`.
 * Use this in catch blocks to report handled errors with full context.
 */
export function reportError(err: unknown, ctx?: EventContext): void {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    sendEvent('server-err', { message, stack }, ctx);
}

/**
 * Explicitly report a log line to the daemon.
 *
 * Used internally by the console capture; also callable directly.
 */
export function reportLog(
    level: 'log' | 'info' | 'warn' | 'error' | 'debug',
    args: unknown[],
    ctx?: EventContext,
): void {
    sendEvent('server-log', { level, args: args.map((a) => String(a)) }, ctx);
}

/**
 * Context for an explicit app-log event emitted by `@harnessa-fe/log`.
 *
 * Distinct from `EventContext` (which is for auto-captured events) so the
 * bridge can write a separate `t: 'app-log'` row. The `scope` field comes
 * from the logger's scope chain; `ts` is the timestamp captured at the
 * logger call site.
 */
export interface AppLogContext {
    /** Per-request sessionId. Read fresh via getRequestSessionId() in @harnessa-fe/log/node-emit. */
    sessionId?: string;
    /** Dot-separated logger scope, e.g. "cart.checkout". */
    scope?: string;
    /** Unix timestamp ms from the log call site. */
    ts?: number;
}

/**
 * Report an explicit app log line to the daemon as an `app.log` event.
 *
 * Called by `@harnessa-fe/log`'s node-emit path — not for console capture.
 * Emits `name: 'app.log'` so the bridge writes a `t: 'app-log'` row,
 * distinguishable from auto-captured `server-log` rows.
 *
 * args are stored as-is (not stringified) so structured objects are preserved
 * in the JSONL payload for agent consumption.
 */
export function reportAppLog(
    level: 'log' | 'info' | 'warn' | 'error' | 'debug',
    args: unknown[],
    ctx?: AppLogContext,
): void {
    sendEvent('app.log', { level, args, scope: ctx?.scope }, {
        sessionId: ctx?.sessionId,
    });
}

/**
 * Higher-order component for Next.js Route Handlers and Server Actions.
 *
 * Wraps `handler` in:
 *   1. An AsyncLocalStorage run scope so `getRequestSessionId()` works inside.
 *   2. A try/catch that auto-reports errors via `reportError()`.
 *   3. A duration timer that emits a `server-action` event on completion.
 *
 * The `sessionId` is read from the request's `x-hfe-session-id` header when
 * present (set by the browser-side RuntimeClient's XHR/fetch wrapper). Falls
 * back to a fresh UUID if the header is absent.
 *
 * Usage:
 *   export const GET = withHarnessaTracing(async (req) => {
 *     return new Response('ok');
 *   });
 */
export function withHarnessaTracing<
    Args extends unknown[],
    Return,
>(handler: (...args: Args) => Promise<Return>): (...args: Args) => Promise<Return> {
    return async (...args: Args): Promise<Return> => {
        // Try to extract sessionId from a Request object in args (Next.js pattern).
        let sessionId: string | undefined;
        const maybeReq = args[0];
        if (
            maybeReq != null &&
            typeof maybeReq === 'object' &&
            'headers' in maybeReq &&
            typeof (maybeReq as { headers: unknown }).headers === 'object'
        ) {
            const headers = (maybeReq as { headers: { get?: (k: string) => string | null } }).headers;
            const headerVal = typeof headers.get === 'function' ? headers.get('x-hfe-session-id') : null;
            sessionId = headerVal ?? undefined;
        }
        sessionId = sessionId ?? randomUUID();

        const startTs = Date.now();
        return als.run({ sessionId }, async () => {
            try {
                const result = await handler(...args);
                sendEvent('server-action', {
                    durationMs: Date.now() - startTs,
                    status: 'ok',
                }, { sessionId });
                return result;
            } catch (err) {
                reportError(err, { sessionId });
                sendEvent('server-action', {
                    durationMs: Date.now() - startTs,
                    status: 'error',
                    error: err instanceof Error ? err.message : String(err),
                }, { sessionId });
                throw err;
            }
        });
    };
}

// ── Internal: process-level error capture ────────────────────────────────────

function installProcessHandlers(): void {
    process.on('uncaughtException', (err: Error) => {
        reportError(err, { sessionId: getRequestSessionId() });
    });
    process.on('unhandledRejection', (reason: unknown) => {
        reportError(reason, { sessionId: getRequestSessionId() });
    });
}

// ── Internal: console capture ─────────────────────────────────────────────────

type ConsoleLevel = 'log' | 'info' | 'warn' | 'error' | 'debug';
const CONSOLE_LEVELS: ConsoleLevel[] = ['log', 'info', 'warn', 'error', 'debug'];

function installConsoleCapture(): void {
    for (const level of CONSOLE_LEVELS) {
        const original = console[level].bind(console);
        console[level] = (...args: unknown[]) => {
            reportLog(level, args, { sessionId: getRequestSessionId() });
            original(...args);
        };
    }
}

// Re-export HelloAckFrame type for callers that type-guard WS frames
export type { HelloAckFrame };
