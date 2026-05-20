// AI-generated
export type { LogLevel, LogEvent, Logger } from './types.js';

import type { LogEvent, LogLevel, Logger } from './types.js';

/**
 * Cached emit function. Set once on first call, reused on subsequent calls.
 *
 * We cache the imported module's emit function rather than the module itself
 * so the call overhead after initialisation is a single null-check + call.
 *
 * IMPORTANT: the cache stores the FUNCTION, not an identity context.
 *   - Browser: window.__harnessa_fe_client__ is read inside browser-emit.emit()
 *     on every call, so late-loading the RuntimeClient still works.
 *   - Server: node-emit.emit() reads getRequestSessionId() on every call,
 *     inside the then() microtask, never in module scope.
 */
let cachedEmit: ((evt: LogEvent) => void) | null = null;

async function getEmit(): Promise<((evt: LogEvent) => void) | null> {
    if (cachedEmit !== null) return cachedEmit;
    try {
        if (typeof window !== 'undefined') {
            const mod = await import('./browser-emit.js');
            cachedEmit = mod.emit;
        } else {
            const mod = await import('./node-emit.js');
            cachedEmit = mod.emit;
        }
    } catch {
        // Dynamic import failed (bundler tree-shake, missing optional dep, etc.)
        // Set a no-op so we don't retry on every call.
        cachedEmit = () => { /* noop */ };
    }
    return cachedEmit;
}

/**
 * Build a Logger instance with an optional scope prefix.
 *
 * The emit function is loaded lazily on first log call. All log calls are
 * fire-and-forget (void Promise) — they never block the calling code and
 * never throw.
 */
export function buildLogger(prefixScope?: string): Logger {
    const emitOne = (level: LogLevel, args: unknown[]): void => {
        const ts = Date.now();
        void getEmit().then((e) => {
            if (!e) return;
            try {
                e({ level, args, scope: prefixScope, ts });
            } catch {
                // Silently drop — logging must never throw into user code
            }
        });
    };

    return {
        debug: (...args: unknown[]) => emitOne('debug', args),
        info: (...args: unknown[]) => emitOne('info', args),
        log: (...args: unknown[]) => emitOne('info', args),
        warn: (...args: unknown[]) => emitOne('warn', args),
        error: (...args: unknown[]) => emitOne('error', args),
        scope: (name: string) =>
            buildLogger(prefixScope ? `${prefixScope}.${name}` : name),
    };
}

/**
 * Default singleton logger. Import and use directly:
 *
 *   import { log } from '@harnessa-fe/log';
 *   log.info('User signed in', { userId });
 *   log.scope('checkout').warn('Cart total exceeds limit', { total });
 */
export const log: Logger = buildLogger();

/**
 * Exposed for testing: reset the cached emit reference so tests can inject
 * their own emit mock without module re-importing.
 * @internal
 */
export function _resetEmitCache(): void {
    cachedEmit = null;
}

/**
 * Exposed for testing: inject a custom emit function directly, bypassing
 * the dynamic import. Resets automatically when _resetEmitCache() is called.
 * @internal
 */
export function _setEmitForTest(fn: (evt: LogEvent) => void): void {
    cachedEmit = fn;
}
