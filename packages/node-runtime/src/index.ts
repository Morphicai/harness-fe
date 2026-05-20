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
     * Default: off. Set `HARNESSA_FE_NODE_CONSOLE=1` env var to enable at
     * runtime without touching code.
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
 * Returns the sessionId for the currently executing async context, or
 * `undefined` when called outside a traced request (e.g. process-level handlers).
 *
 * Node-runtime re-exports / mirrors `getSessionId` from `@harnessa-fe/next`
 * so that both can share the same session bucket without a circular dep.
 */
export function getRequestSessionId(): string | undefined {
    return als.getStore()?.sessionId;
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

    installProcessHandlers();

    const captureConsole = opts.captureConsole ?? process.env.HARNESSA_FE_NODE_CONSOLE === '1';
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
