// AI-generated
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Internal event shape passed from the logger to the emit path.
 * sessionId is intentionally absent here — it is resolved INSIDE the
 * emit function at call time (never closed over) to guarantee per-request
 * isolation on the server side.
 */
export interface LogEvent {
    level: LogLevel;
    /** All variadic args passed to the log call. */
    args: unknown[];
    /** Dot-separated scope prefix, e.g. "cart.checkout". */
    scope?: string;
    /** Unix timestamp ms, captured at the logger call site. */
    ts: number;
}

/**
 * Public Logger interface. Isomorphic — same import works on server and client.
 */
export interface Logger {
    debug(...args: unknown[]): void;
    info(...args: unknown[]): void;
    /** Alias of info — matches console.log muscle memory. */
    log(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    error(...args: unknown[]): void;
    /**
     * Returns a new Logger that prefixes every emitted event with
     * `scope=name`. Scopes chain: `log.scope('a').scope('b')` emits
     * with `scope='a.b'`.
     */
    scope(name: string): Logger;
}
